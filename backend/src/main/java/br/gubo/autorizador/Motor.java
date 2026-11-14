package br.gubo.autorizador;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Motor de decisao: regra fixa por convenio, chamada real por HTTP a API simulada,
 * retentativa com espera crescente, disjuntor por convenio e trava de autorizacao.
 */
public final class Motor {

  /**
   * Colunas que uma transicao pode escrever. Allowlist explicita: o UPDATE e montado so com
   * nomes daqui, nunca com texto vindo de fora. Valores sempre por placeholder.
   */
  private static final List<String> COLUNAS_DE_TRANSICAO = List.of(
      "status", "motivo", "regra_usada", "numero_autorizacao", "latencia_ms", "respondido_em");

  private static final Set<String> STATUS_FINAIS =
      Set.of("autorizada", "pendente_documento", "erro_integracao", "tarefa_humana");

  private static final int MAXIMO_DE_TENTATIVAS = 3;

  private final Banco banco;
  private final Disjuntor disjuntor;
  private final TempoReal tempoReal;
  private final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(2))
      .build();

  public Motor(Banco banco, Disjuntor disjuntor, TempoReal tempoReal) {
    this.banco = banco;
    this.disjuntor = disjuntor;
    this.tempoReal = tempoReal;
  }

  /** Espera crescente entre as tentativas. Os testes encurtam por variavel de ambiente. */
  static List<Long> esperasDeRetentativa() {
    String configurado = Config.texto("ESPERAS_RETENTATIVA_MS");
    List<Long> lista = new ArrayList<>();
    if (configurado != null && !configurado.isBlank()) {
      for (String parte : configurado.split(",")) {
        try {
          long valor = Long.parseLong(parte.strip());
          if (valor >= 0) {
            lista.add(valor);
          }
        } catch (NumberFormatException ignorado) {
          // parte invalida: ignora
        }
      }
    }
    return lista.isEmpty() ? List.of(200L, 400L, 800L) : lista;
  }

  static String urlDoMock() {
    String configurado = Config.texto("MOCK_URL");
    if (configurado != null) {
      return configurado;
    }
    return "http://127.0.0.1:" + Config.texto("PORT", "3000") + "/mock";
  }

  /** Texto legivel do erro, pro motivo da tarefa humana ("HTTP 503", "timeout"...). */
  static String descreverErro(String erro) {
    if (erro != null && erro.startsWith("http_")) {
      return "HTTP " + erro.replace("http_", "");
    }
    if ("timeout".equals(erro)) {
      return "timeout";
    }
    return "erro de rede";
  }

  private record Resultado(boolean falhaIntegracao, long latenciaMs, String erro,
      Map<String, Object> corpo, int tentativas) {
  }

  /** Chamada real por HTTP, com timeout por requisicao e medicao de latencia. */
  private Resultado chamarApiSimulada(String convenioId, String solicitacaoId, Object procedimento,
      boolean temDocumento, String modoSimulado, long tempoLimiteMs) {
    Map<String, Object> corpoEnviado = new LinkedHashMap<>();
    corpoEnviado.put("solicitacao", solicitacaoId);
    corpoEnviado.put("procedimento", procedimento);
    corpoEnviado.put("tem_documento", temDocumento);
    if (modoSimulado != null) {
      corpoEnviado.put("modo_simulado", modoSimulado);
    }

    long inicio = System.currentTimeMillis();
    try {
      HttpRequest requisicao = HttpRequest.newBuilder()
          .uri(URI.create(urlDoMock() + "/" + convenioId + "/autorizar"))
          .timeout(Duration.ofMillis(tempoLimiteMs))
          .header("content-type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(Json.paraTexto(corpoEnviado)))
          .build();

      HttpResponse<String> resposta = http.send(requisicao, HttpResponse.BodyHandlers.ofString());
      long latenciaMs = System.currentTimeMillis() - inicio;
      if (resposta.statusCode() < 200 || resposta.statusCode() >= 300) {
        return new Resultado(true, latenciaMs, "http_" + resposta.statusCode(), null, 0);
      }
      return new Resultado(false, latenciaMs, null, Json.lerMapa(resposta.body()), 0);
    } catch (HttpTimeoutException erro) {
      return new Resultado(true, System.currentTimeMillis() - inicio, "timeout", null, 0);
    } catch (Exception erro) {
      if (erro instanceof InterruptedException) {
        Thread.currentThread().interrupt();
      }
      return new Resultado(true, System.currentTimeMillis() - inicio, "erro_de_rede", null, 0);
    }
  }

  /** Uma linha por chamada a API simulada: e daqui que saem p50 e p95 das metricas. */
  private void registrarChamada(String convenio, String solicitacao, long latenciaMs, boolean sucesso) {
    banco.executar("""
        INSERT INTO chamadas (convenio, solicitacao, latencia_ms, sucesso, horario)
        VALUES (?, ?, ?, ?, ?)
        """, convenio, solicitacao, latenciaMs, sucesso ? 1 : 0, Tempo.agora());
  }

  private Map<String, Object> buscarConvenio(String convenioId) {
    return banco.consultarUm("SELECT * FROM convenios WHERE id = ?", convenioId);
  }

  private Map<String, Object> buscarRegra(String convenioId) {
    return banco.consultarUm("SELECT * FROM regras WHERE convenio = ?", convenioId);
  }

  private boolean temDocumentoAnexado(String solicitacaoId) {
    return banco.consultarUm("SELECT 1 FROM documentos WHERE solicitacao = ? LIMIT 1", solicitacaoId) != null;
  }

  /**
   * Cria a tarefa com prazo de 2 h. O texto de encaminhamento (texto_ia) nasce vazio e e
   * escrito sob demanda pela camada de IA. O motor nunca depende desse texto.
   */
  private void criarTarefaHumana(String solicitacaoId, String motivo, String prioridade) {
    String prazo = Tempo.daquiA(2 * 60 * 60 * 1000L);
    long id = banco.inserir("""
        INSERT INTO tarefas_humanas (solicitacao, motivo, texto_ia, origem_texto, prioridade, responsavel, prazo, status)
        VALUES (?, ?, NULL, NULL, ?, NULL, ?, 'aberta')
        """, solicitacaoId, motivo, prioridade, prazo);

    tempoReal.publicar("tarefa_criada", Json.mapa(
        "id", id,
        "solicitacao", solicitacaoId,
        "motivo", motivo,
        "prioridade", prioridade,
        "prazo", prazo));
  }

  /**
   * Muda o status, grava os campos e registra o evento correspondente. Muta o mapa local da
   * solicitacao para manter o status_de correto entre chamadas sequenciais.
   */
  private void transicionar(Map<String, Object> solicitacao, String novoStatus,
      String motivo, String regraUsada, String numeroAutorizacao, Long latenciaMs) {
    String statusAnterior = (String) solicitacao.get("status");
    Map<String, Object> campos = new LinkedHashMap<>();
    campos.put("status", novoStatus);
    if (motivo != null) {
      campos.put("motivo", motivo);
    }
    if (regraUsada != null) {
      campos.put("regra_usada", regraUsada);
    }
    if (numeroAutorizacao != null) {
      campos.put("numero_autorizacao", numeroAutorizacao);
    }
    if (latenciaMs != null) {
      campos.put("latencia_ms", latenciaMs);
    }
    if (STATUS_FINAIS.contains(novoStatus)) {
      campos.put("respondido_em", Tempo.agora());
    }

    List<String> colunas = new ArrayList<>();
    List<Object> valores = new ArrayList<>();
    for (String coluna : COLUNAS_DE_TRANSICAO) {
      if (campos.containsKey(coluna)) {
        colunas.add(coluna);
        valores.add(campos.get(coluna));
      }
    }
    valores.add(solicitacao.get("id"));
    String atribuicoes = String.join(", ", colunas.stream().map(coluna -> coluna + " = ?").toList());
    banco.executar("UPDATE solicitacoes SET " + atribuicoes + " WHERE id = ?", valores.toArray());

    Eventos.registrar(banco, (String) solicitacao.get("id"), statusAnterior, novoStatus,
        (String) campos.get("motivo"), (String) campos.get("regra_usada"), "sistema");

    solicitacao.putAll(campos);

    tempoReal.publicar("solicitacao_atualizada", Json.mapa(
        "id", solicitacao.get("id"),
        "convenio", solicitacao.get("convenio"),
        "status", novoStatus,
        "status_de", statusAnterior,
        "motivo", campos.get("motivo"),
        "regra_usada", campos.get("regra_usada"),
        "numero_autorizacao", solicitacao.get("numero_autorizacao"),
        "latencia_ms", campos.get("latencia_ms")));
  }

  /** Anota a tentativa que falhou sem mudar o status: a solicitacao continua em analise. */
  private void anotarTentativa(Map<String, Object> solicitacao, String motivo) {
    String status = (String) solicitacao.get("status");
    Eventos.registrar(banco, (String) solicitacao.get("id"), status, status, motivo,
        (String) solicitacao.get("regra_usada"), "sistema");
    tempoReal.publicar("solicitacao_atualizada", Json.mapa(
        "id", solicitacao.get("id"),
        "convenio", solicitacao.get("convenio"),
        "status", status,
        "status_de", status,
        "motivo", motivo,
        "regra_usada", solicitacao.get("regra_usada"),
        "numero_autorizacao", null,
        "latencia_ms", null));
  }

  private static void aguardar(long milissegundos) {
    try {
      Thread.sleep(milissegundos);
    } catch (InterruptedException erro) {
      Thread.currentThread().interrupt();
    }
  }

  /**
   * Chama a API simulada com retentativa e espera crescente (200, 400, 800 ms).
   * No meio_aberto e uma unica chamada de teste, sem retentativa.
   */
  private Resultado chamarComRetentativa(Map<String, Object> solicitacao, Map<String, Object> convenioInfo,
      boolean temDocumento, String estadoDisjuntor, String modoSimulado) {
    List<Long> esperas = esperasDeRetentativa();
    int maximo = "meio_aberto".equals(estadoDisjuntor) ? 1 : MAXIMO_DE_TENTATIVAS;
    String convenioId = (String) convenioInfo.get("id");
    long tempoLimite = ((Number) convenioInfo.get("tempo_limite_ms")).longValue();
    Resultado ultimoResultado = null;

    for (int tentativa = 1; tentativa <= maximo; tentativa += 1) {
      banco.executar("UPDATE solicitacoes SET tentativas = ? WHERE id = ?",
          (long) tentativa, solicitacao.get("id"));

      Resultado resultado = chamarApiSimulada(convenioId, (String) solicitacao.get("id"),
          solicitacao.get("procedimento"), temDocumento, modoSimulado, tempoLimite);
      registrarChamada(convenioId, (String) solicitacao.get("id"), resultado.latenciaMs(),
          !resultado.falhaIntegracao());
      ultimoResultado = new Resultado(resultado.falhaIntegracao(), resultado.latenciaMs(),
          resultado.erro(), resultado.corpo(), tentativa);

      if (!resultado.falhaIntegracao()) {
        disjuntor.registrarSucesso(convenioId);
        return ultimoResultado;
      }

      Disjuntor.Falha falha = disjuntor.registrarFalha(convenioId);
      String erroLegivel = descreverErro(resultado.erro());
      long espera = esperas.get(Math.min(tentativa - 1, esperas.size() - 1));
      boolean aindaTentaDeNovo = tentativa < maximo && !"aberto".equals(falha.estado());

      anotarTentativa(solicitacao, aindaTentaDeNovo
          ? "tentativa " + tentativa + " de " + maximo + " falhou (" + erroLegivel
              + "), nova tentativa em " + espera + " ms"
          : "tentativa " + tentativa + " de " + maximo + " falhou (" + erroLegivel + ")");

      // Se o disjuntor abriu no meio da sequencia, para de insistir: e o papel dele.
      if (!aindaTentaDeNovo) {
        break;
      }
      aguardar(espera);
    }

    return ultimoResultado;
  }

  public void processarSolicitacao(String solicitacaoId) {
    processarSolicitacao(solicitacaoId, null);
  }

  /** Processa uma solicitacao: decide pela regra do convenio e chama a API de verdade. */
  public void processarSolicitacao(String solicitacaoId, String modoSimulado) {
    Map<String, Object> solicitacao =
        banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", solicitacaoId);
    if (solicitacao == null) {
      return;
    }

    String convenioId = (String) solicitacao.get("convenio");
    Map<String, Object> convenioInfo = buscarConvenio(convenioId);

    // Convenio sem entrada na base: regra fora_da_base manda direto pra equipe humana.
    if (convenioInfo == null) {
      Map<String, Object> regraForaDaBase = buscarRegra("fora_da_base");
      String fonte = regraForaDaBase == null ? "REGRAS-DEMO-v1" : (String) regraForaDaBase.get("fonte");
      String motivo = "fora da base: convênio \"" + convenioId
          + "\" não cadastrado (regra fora_da_base, " + fonte + "), encaminhado para humano";
      transicionar(solicitacao, "em_analise", "convênio não cadastrado na base", fonte, null, null);
      transicionar(solicitacao, "tarefa_humana", motivo, fonte, null, null);
      criarTarefaHumana(solicitacaoId, motivo, "alta");
      return;
    }

    Map<String, Object> regra = buscarRegra(convenioId);
    String fonte = (String) regra.get("fonte");
    String nomeDoConvenio = (String) convenioInfo.get("nome");

    // A decisao e sempre a da regra do CONVENIO. Procedimento diferente do da regra so vira
    // observacao no motivo (o auditor trata depois), nunca muda a decisao.
    String procedimentoDaRegra = (String) regra.get("procedimento");
    String procedimento = (String) solicitacao.get("procedimento");
    boolean procedimentoDivergente = !"qualquer".equals(procedimentoDaRegra)
        && procedimento != null && !procedimento.isBlank()
        && !procedimentoDaRegra.equals(procedimento);
    String sufixo = procedimentoDivergente ? ", atenção: procedimento fora da regra explícita" : "";

    transicionar(solicitacao, "em_analise",
        "enviando para API simulada de " + nomeDoConvenio + " (" + fonte + ")" + sufixo,
        fonte, null, null);

    // Disjuntor aberto: nem chama a API. Vai direto pra tarefa humana.
    Disjuntor.Portao portao = disjuntor.avaliarAntesDaChamada(convenioId);
    if (!portao.permitido()) {
      String motivo = portao.motivo() + ", encaminhado para humano sem chamar a API" + sufixo;
      transicionar(solicitacao, "tarefa_humana", motivo, fonte, null, null);
      criarTarefaHumana(solicitacaoId, motivo, "alta");
      return;
    }

    boolean temDocumento = "pedir_documento".equals(regra.get("acao")) && temDocumentoAnexado(solicitacaoId);

    Resultado resultado = chamarComRetentativa(solicitacao, convenioInfo, temDocumento,
        portao.estado(), modoSimulado);

    // Falha de integracao depois de esgotar as tentativas: erro_integracao e tarefa humana.
    // Nunca inventa autorizacao.
    if (resultado.falhaIntegracao()) {
      String erroLegivel = descreverErro(resultado.erro());
      transicionar(solicitacao, "erro_integracao",
          "falha de integração com " + nomeDoConvenio + ": " + erroLegivel + sufixo,
          fonte, null, resultado.latenciaMs());
      String motivoHumano = nomeDoConvenio + " fora do ar após " + resultado.tentativas()
          + " tentativas (" + erroLegivel + "), sem inventar autorização";
      transicionar(solicitacao, "tarefa_humana", motivoHumano, fonte, null, null);
      criarTarefaHumana(solicitacaoId, motivoHumano, "alta");
      return;
    }

    Map<String, Object> corpo = resultado.corpo() == null ? Map.of() : resultado.corpo();
    Object statusDaResposta = corpo.get("status");

    if ("autorizado".equals(statusDaResposta)) {
      Object numeroBruto = corpo.get("numero_autorizacao");
      String numero = numeroBruto == null ? "" : String.valueOf(numeroBruto).strip();
      // TRAVA: so vira autorizada com numero preenchido. Sem numero, vai pra humano.
      if (!numero.isEmpty()) {
        transicionar(solicitacao, "autorizada",
            "autorizado por " + nomeDoConvenio + " conforme " + fonte + sufixo,
            fonte, numero, resultado.latenciaMs());
        return;
      }
      String motivoSemNumero = "resposta sem número de autorização";
      transicionar(solicitacao, "tarefa_humana", motivoSemNumero, fonte, null, resultado.latenciaMs());
      criarTarefaHumana(solicitacaoId, motivoSemNumero, "alta");
      return;
    }

    if ("pendente_documento".equals(statusDaResposta)) {
      transicionar(solicitacao, "pendente_documento",
          "pendente: " + nomeDoConvenio + " exige documento, " + fonte + sufixo,
          fonte, null, resultado.latenciaMs());
      return;
    }

    String motivoInesperado = "resposta inesperada de " + nomeDoConvenio + ": \"" + statusDaResposta + "\"";
    transicionar(solicitacao, "tarefa_humana", motivoInesperado, fonte, null, resultado.latenciaMs());
    criarTarefaHumana(solicitacaoId, motivoInesperado, "alta");
  }

  // --- casos do kit --------------------------------------------------------------------
  // Cada caso corresponde a uma linha de kit/scenarios/03-casos.md. Os casos forcam o modo
  // da propria chamada, em vez de mexer no modo global: rodar os casos nao muda o
  // comportamento da demo ao vivo.

  public record ResultadoDeCaso(boolean passou, Map<String, Object> solicitacao) {
  }

  public ResultadoDeCaso casoAuroraAutoriza() {
    processarSolicitacao("DEMO-R1", "normal");
    Map<String, Object> solicitacao = banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", "DEMO-R1");
    boolean passou = "autorizada".equals(solicitacao.get("status"))
        && "DEMO-AUTH-1".equals(solicitacao.get("numero_autorizacao"));
    return new ResultadoDeCaso(passou, solicitacao);
  }

  public ResultadoDeCaso casoHorizonteSemDocumentoFicaPendente() {
    processarSolicitacao("DEMO-R2", "normal");
    Map<String, Object> solicitacao = banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", "DEMO-R2");
    return new ResultadoDeCaso("pendente_documento".equals(solicitacao.get("status")), solicitacao);
  }

  public ResultadoDeCaso casoJardimIndisponivelCriaTarefa() {
    processarSolicitacao("DEMO-R3", "normal");
    Map<String, Object> solicitacao = banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", "DEMO-R3");
    boolean temTarefa = banco.consultarUm("SELECT 1 FROM tarefas_humanas WHERE solicitacao = ?", "DEMO-R3") != null;
    return new ResultadoDeCaso("tarefa_humana".equals(solicitacao.get("status")) && temTarefa, solicitacao);
  }

  public ResultadoDeCaso casoSemNumeroNaoAutoriza() {
    banco.reiniciarSolicitacao("DEMO-R1");
    processarSolicitacao("DEMO-R1", "sem_numero");
    Map<String, Object> solicitacao = banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", "DEMO-R1");
    boolean temTarefa = banco.consultarUm("SELECT 1 FROM tarefas_humanas WHERE solicitacao = ?", "DEMO-R1") != null;
    Object numero = solicitacao.get("numero_autorizacao");
    boolean naoInventouNumero = numero == null || String.valueOf(numero).isEmpty();
    return new ResultadoDeCaso(
        "tarefa_humana".equals(solicitacao.get("status")) && temTarefa && naoInventouNumero,
        solicitacao);
  }

  /** Roda os 4 casos do kit num banco ja seedado. Usado por POST /api/testes/rodar. */
  public Map<String, Object> rodarCasosBasicos() {
    List<Map<String, Object>> detalhes = new ArrayList<>();
    List<Object[]> casos = List.of(
        new Object[] {"Aurora Demo: retorna autorização DEMO", (Executor) this::casoAuroraAutoriza},
        new Object[] {"Horizonte Demo sem documento: mantém pendência",
            (Executor) this::casoHorizonteSemDocumentoFicaPendente},
        new Object[] {"Jardim Demo indisponível: cria tarefa humana",
            (Executor) this::casoJardimIndisponivelCriaTarefa},
        new Object[] {"Resposta sem número de autorização: não marca autorizado",
            (Executor) this::casoSemNumeroNaoAutoriza});

    long passaram = 0;
    for (Object[] caso : casos) {
      ResultadoDeCaso resultado = ((Executor) caso[1]).executar();
      if (resultado.passou()) {
        passaram += 1;
      }
      detalhes.add(Json.mapa(
          "caso", caso[0],
          "passou", resultado.passou(),
          "status", resultado.solicitacao() == null ? null : resultado.solicitacao().get("status")));
    }

    return Json.mapa("passaram", passaram, "total", (long) casos.size(), "detalhes", detalhes);
  }

  @FunctionalInterface
  private interface Executor {
    ResultadoDeCaso executar();
  }
}
