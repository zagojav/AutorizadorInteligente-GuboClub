package br.gubo.autorizador;

import io.javalin.Javalin;
import io.javalin.http.Context;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Rotas publicas da API. Toda rota tem try/catch: o processo nunca cai.
 * Mesmos caminhos, mesmos campos de JSON e mesmas mensagens do backend Node.
 */
public final class Rotas {

  private static final int SINTETICAS_POR_CONVENIO = 5;

  /**
   * Validacao server-side dos parametros. O id da solicitacao so aceita o formato dos
   * identificadores do kit (DEMO-R* da fila original, DEMO-S* das sinteticas de carga);
   * o id de tarefa e inteiro. O front nao e a defesa.
   */
  private static final Pattern ID_SOLICITACAO = Pattern.compile("^DEMO-(R|S)[0-9]{1,4}$");
  private static final Pattern ID_TAREFA = Pattern.compile("^[0-9]{1,9}$");

  private final Banco banco;
  private final ApiSimulada apiSimulada;
  private final Motor motor;
  private final FilaPorConvenio filas;
  private final TempoReal tempoReal;

  public Rotas(Banco banco, ApiSimulada apiSimulada, Motor motor, FilaPorConvenio filas, TempoReal tempoReal) {
    this.banco = banco;
    this.apiSimulada = apiSimulada;
    this.motor = motor;
    this.filas = filas;
    this.tempoReal = tempoReal;
  }

  /**
   * Resposta de erro unica: mensagem estavel pro cliente, detalhe tecnico so no log do
   * servidor. So vaza o detalhe se DETALHAR_ERROS=1 estiver ligado (depuracao local).
   */
  private static void responderErro(Context contexto, int codigo, String mensagem, Exception erro) {
    System.err.println("[erro] " + mensagem + ": " + (erro == null ? "" : erro.getMessage()));
    Map<String, Object> corpo = Json.mapa("erro", mensagem);
    if ("1".equals(Config.texto("DETALHAR_ERROS")) && erro != null && erro.getMessage() != null) {
      corpo.put("detalhe", erro.getMessage());
    }
    contexto.status(codigo).json(corpo);
  }

  private static void requisicaoInvalida(Context contexto) {
    contexto.status(400).json(Json.mapa("erro", "requisição inválida"));
  }

  /**
   * Trocar modo nao emite nada por si: quem muda o modo chama isto, pro front atualizar os
   * botoes pelo SSE em vez de ficar consultando /api/saude.
   */
  private void publicarModo(String convenioId) {
    Map<String, Object> convenio =
        banco.consultarUm("SELECT id, disjuntor FROM convenios WHERE id = ?", convenioId);
    tempoReal.publicar("modo_mudou", Json.mapa(
        "convenio", convenioId,
        "modo", apiSimulada.obterModo(convenioId),
        "disjuntor", convenio == null ? null : convenio.get("disjuntor")));
  }

  public void registrar(Javalin servidor) {
    // Dados de usuario nunca vao pra cache de CDN/edge, e nada de sniffing de content-type.
    // O SSE fica de fora: a resposta dele ja foi enviada no proprio handler.
    servidor.after(contexto -> {
      if (ehStream(contexto.path())) {
        return;
      }
      contexto.header("cache-control", "private, no-store");
      contexto.header("x-content-type-options", "nosniff");
      contexto.header("x-frame-options", "DENY");
      contexto.header("referrer-policy", "no-referrer");
    });

    servidor.get("/api/saude", contexto -> {
      try {
        List<Map<String, Object>> convenios = banco.consultar("""
            SELECT id, nome, status_integracao, disjuntor, falhas_seguidas, aberto_em, tempo_limite_ms
            FROM convenios ORDER BY id
            """);
        contexto.json(Json.mapa(
            "status", "ok",
            "simulado", true,
            "hora", Tempo.agora(),
            "convenios", convenios,
            "modos", apiSimulada.listarModos(),
            "filas", filas.situacao(),
            "ia", Ia.situacaoDoProvedor()));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao consultar a saúde", erro);
      }
    });

    servidor.get("/api/fila", contexto -> {
      try {
        contexto.json(banco.consultar("SELECT * FROM solicitacoes ORDER BY sintetica, id"));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao consultar a fila", erro);
      }
    });

    // Rodada previsivel: fecha todos os disjuntores, zera falhas, volta os modos pro padrao
    // do kit, reseta as solicitacoes e processa tudo pelas filas por convenio.
    servidor.post("/api/fila/iniciar", contexto -> {
      try {
        banco.restaurarTodosOsConvenios();
        apiSimulada.resetarModos();
        // A rodada tambem zera modo e disjuntor de todos: o front precisa saber de cada um.
        ApiSimulada.CONVENIOS_CONHECIDOS.forEach(this::publicarModo);

        List<String> ids = new ArrayList<>();
        for (Map<String, Object> linha : banco.consultar("SELECT id FROM solicitacoes ORDER BY sintetica, id")) {
          ids.add((String) linha.get("id"));
        }
        ids.forEach(banco::reiniciarSolicitacao);
        filas.enfileirar(ids);
        filas.aguardarConclusao();

        contexto.json(Json.mapa(
            "processadas", (long) ids.size(),
            "fila", banco.consultar("SELECT * FROM solicitacoes ORDER BY sintetica, id")));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao iniciar a fila", erro);
      }
    });

    servidor.get("/api/solicitacoes/{id}/linha-do-tempo", contexto -> {
      try {
        String id = contexto.pathParam("id");
        if (!ID_SOLICITACAO.matcher(id).matches()) {
          requisicaoInvalida(contexto);
          return;
        }
        if (banco.consultarUm("SELECT id FROM solicitacoes WHERE id = ?", id) == null) {
          contexto.status(404).json(Json.mapa("erro", "solicitação não encontrada"));
          return;
        }
        contexto.json(Eventos.linhaDoTempo(banco, id));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao consultar a linha do tempo", erro);
      }
    });

    // Reprocessa UMA solicitacao sem tocar em modo nem em disjuntor.
    servidor.post("/api/solicitacoes/{id}/reprocessar", contexto -> {
      try {
        String id = contexto.pathParam("id");
        if (!ID_SOLICITACAO.matcher(id).matches()) {
          requisicaoInvalida(contexto);
          return;
        }
        if (banco.consultarUm("SELECT id FROM solicitacoes WHERE id = ?", id) == null) {
          contexto.status(404).json(Json.mapa("erro", "solicitação não encontrada"));
          return;
        }
        banco.reiniciarSolicitacao(id);
        motor.processarSolicitacao(id);
        contexto.json(banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", id));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao reprocessar a solicitação", erro);
      }
    });

    // Anexa o documento ficticio do kit (caminho fixo no servidor) e reprocessa.
    servidor.post("/api/solicitacoes/{id}/documentos", contexto -> {
      try {
        String id = contexto.pathParam("id");
        if (!ID_SOLICITACAO.matcher(id).matches()) {
          requisicaoInvalida(contexto);
          return;
        }
        Map<String, Object> solicitacao = banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", id);
        if (solicitacao == null) {
          contexto.status(404).json(Json.mapa("erro", "solicitação não encontrada"));
          return;
        }

        String conteudo = Files.readString(Caminhos.documentoMock(), StandardCharsets.UTF_8);
        banco.executar("""
            INSERT INTO documentos (solicitacao, tipo, conteudo, recebido_em)
            VALUES (?, 'documento_mock', ?, ?)
            """, id, conteudo, Tempo.agora());

        // A IA le o documento e sugere o que encontrou. E sugestao: nao muda status nem
        // decide nada. Quem decide a seguir e a regra, no processarSolicitacao abaixo.
        Map<String, Object> sugestao = Ia.resumirDocumento(conteudo);

        Eventos.registrar(banco, id, (String) solicitacao.get("status"), (String) solicitacao.get("status"),
            "documento anexado pelo atendimento; sugestao (" + sugestao.get("origem") + "): "
                + String.valueOf(sugestao.get("texto")).replace("\n", " "),
            (String) solicitacao.get("regra_usada"), "humano");

        motor.processarSolicitacao(id);
        Map<String, Object> atualizada = banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", id);
        atualizada.put("sugestao_ia", sugestao);
        contexto.json(atualizada);
      } catch (IOException | RuntimeException erro) {
        responderErro(contexto, 500, "falha ao anexar documento",
            erro instanceof Exception excecao ? excecao : null);
      }
    });

    servidor.get("/api/tarefas", contexto -> {
      try {
        contexto.json(banco.consultar("SELECT * FROM tarefas_humanas ORDER BY id"));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao consultar as tarefas", erro);
      }
    });

    servidor.get("/api/tarefas/{id}/texto-ia/stream", this::transmitirTextoDaTarefa);

    // Troca o modo da API simulada de um convenio.
    servidor.post("/api/convenios/{convenio}/modo", contexto -> {
      try {
        String convenio = contexto.pathParam("convenio");
        Map<String, Object> corpo = Json.lerMapa(contexto.body());
        Object modo = corpo.get("modo");
        if (!ApiSimulada.CONVENIOS_CONHECIDOS.contains(convenio)
            || !(modo instanceof String texto)
            || !ApiSimulada.MODOS_VALIDOS.contains(texto)
            || corpo.size() != 1) {
          requisicaoInvalida(contexto);
          return;
        }
        apiSimulada.definirModo(convenio, (String) modo);
        publicarModo(convenio);
        contexto.json(Json.mapa("convenio", convenio, "modo", apiSimulada.obterModo(convenio)));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao trocar o modo do convênio", erro);
      }
    });

    // Botao "derrubar Jardim": joga o convenio no modo caos.
    servidor.post("/api/convenios/{convenio}/derrubar", contexto -> {
      try {
        String convenio = contexto.pathParam("convenio");
        if (!ApiSimulada.CONVENIOS_CONHECIDOS.contains(convenio)) {
          requisicaoInvalida(contexto);
          return;
        }
        apiSimulada.definirModo(convenio, "caos");
        publicarModo(convenio);
        contexto.json(Json.mapa(
            "convenio", convenio,
            "modo", apiSimulada.obterModo(convenio),
            "derrubado", true));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao derrubar o convênio", erro);
      }
    });

    // Volta um convenio ao estado do kit: modo padrao, disjuntor fechado e falhas zeradas.
    servidor.post("/api/convenios/{convenio}/restaurar", contexto -> {
      try {
        String convenio = contexto.pathParam("convenio");
        if (!ApiSimulada.CONVENIOS_CONHECIDOS.contains(convenio)) {
          requisicaoInvalida(contexto);
          return;
        }
        apiSimulada.restaurarModoPadrao(convenio);
        banco.restaurarConvenio(convenio);
        publicarModo(convenio);
        Map<String, Object> estado = banco.consultarUm(
            "SELECT id, status_integracao, disjuntor, falhas_seguidas FROM convenios WHERE id = ?", convenio);
        estado.put("modo", apiSimulada.obterModo(convenio));
        estado.put("restaurado", true);
        contexto.json(estado);
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao restaurar o convênio", erro);
      }
    });

    // Carga sintetica: 5 solicitacoes por convenio entram nas filas. Nao espera o fim de
    // proposito, pra demo mostrar o fluxo acontecendo ao vivo no SSE.
    servidor.post("/api/simulacao/carga", contexto -> {
      try {
        List<Banco.Sintetica> criadas = banco.criarSolicitacoesSinteticas(SINTETICAS_POR_CONVENIO);
        List<String> ids = criadas.stream().map(Banco.Sintetica::id).toList();
        filas.enfileirar(ids);
        long totalSinteticas = banco.contar("SELECT COUNT(*) AS total FROM solicitacoes WHERE sintetica = 1");
        contexto.json(Json.mapa(
            "simulado", true,
            "criadas", (long) criadas.size(),
            "ids", ids,
            "sinteticas_no_banco", totalSinteticas,
            "limite", (long) Banco.LIMITE_SINTETICAS));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao gerar carga sintética", erro);
      }
    });

    servidor.get("/api/auditoria", contexto -> {
      try {
        contexto.json(Auditor.resumir(banco));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao rodar a auditoria", erro);
      }
    });

    servidor.get("/api/metricas", contexto -> {
      try {
        contexto.json(Metricas.calcular(banco));
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao calcular as métricas", erro);
      }
    });

    // Roda os 4 casos do kit num banco em memoria: nao encosta no banco da demo.
    servidor.post("/api/testes/rodar", contexto -> {
      Banco bancoDeTeste = null;
      try {
        bancoDeTeste = Banco.abrir(":memory:");
        bancoDeTeste.seed();
        // Barramento silencioso: a rodada hermetica nao polui o SSE da demo.
        TempoReal silencioso = new TempoReal(true);
        Motor motorDeTeste = new Motor(bancoDeTeste, new Disjuntor(bancoDeTeste, silencioso), silencioso);
        Map<String, Object> resultado = motorDeTeste.rodarCasosBasicos();
        Metricas.guardarResultadoDosCasos(resultado);
        contexto.json(resultado);
      } catch (RuntimeException erro) {
        responderErro(contexto, 500, "falha ao rodar os testes", erro);
      } finally {
        if (bancoDeTeste != null) {
          bancoDeTeste.close();
        }
      }
    });

    registrarStream(servidor);
    registrarFrontEnd(servidor);
  }

  private static boolean ehStream(String caminho) {
    return caminho != null && (caminho.equals("/api/stream") || caminho.endsWith("/texto-ia/stream"));
  }

  // --- SSE -----------------------------------------------------------------------------

  /**
   * Abre a resposta SSE escrevendo direto no socket, com os mesmos bytes do backend Node
   * (retry primeiro, depois blocos "event:/data:"). Escrever no stream cru tambem mantem o
   * SSE fora da compressao.
   */
  private static OutputStream abrirSse(Context contexto) throws IOException {
    contexto.res().setStatus(200);
    contexto.res().setContentType("text/event-stream; charset=utf-8");
    contexto.res().setHeader("cache-control", "no-store");
    contexto.res().setHeader("connection", "keep-alive");
    contexto.res().setHeader("x-accel-buffering", "no");
    OutputStream saida = contexto.res().getOutputStream();
    saida.write("retry: 2000\n\n".getBytes(StandardCharsets.UTF_8));
    saida.flush();
    return saida;
  }

  private static void escreverSse(OutputStream saida, String tipo, Object dados) throws IOException {
    saida.write(TempoReal.blocoSse(tipo, dados).getBytes(StandardCharsets.UTF_8));
    saida.flush();
  }

  private void registrarStream(Javalin servidor) {
    servidor.get("/api/stream", contexto -> {
      OutputStream saida;
      try {
        saida = abrirSse(contexto);
        escreverSse(saida, "conectado", Json.mapa("simulado", true, "horario", Tempo.agora()));
      } catch (IOException erro) {
        System.err.println("[erro] falha ao abrir o stream SSE: " + erro.getMessage());
        return;
      }

      TempoReal.Cliente cliente = tempoReal.conectar(saida);
      try {
        // A linha fica viva mandando heartbeat; os eventos vao pelo barramento. Quando o
        // cliente desconecta, a escrita falha e o cliente sai da lista (sem vazar).
        while (!cliente.encerrado()) {
          Thread.sleep(TempoReal.INTERVALO_HEARTBEAT_MS);
          if (cliente.encerrado()) {
            break;
          }
          saida.write(": heartbeat\n\n".getBytes(StandardCharsets.UTF_8));
          saida.flush();
        }
      } catch (IOException | InterruptedException erro) {
        if (erro instanceof InterruptedException) {
          Thread.currentThread().interrupt();
        }
      } finally {
        tempoReal.desconectar(cliente);
      }
    });
  }

  /**
   * Texto de encaminhamento da tarefa, transmitido aos poucos.
   * A IA so escreve texto: esta rota nao toca em solicitacoes nem em status.
   */
  private void transmitirTextoDaTarefa(Context contexto) {
    String idBruto = contexto.pathParam("id");
    if (!ID_TAREFA.matcher(idBruto).matches()) {
      requisicaoInvalida(contexto);
      return;
    }
    long tarefaId = Long.parseLong(idBruto);
    Map<String, Object> tarefa = banco.consultarUm("SELECT * FROM tarefas_humanas WHERE id = ?", tarefaId);
    if (tarefa == null) {
      contexto.status(404).json(Json.mapa("erro", "tarefa não encontrada"));
      return;
    }

    try {
      // Ja gerado antes: transmite o texto salvo, com a origem que ficou registrada.
      Object textoSalvo = tarefa.get("texto_ia");
      if (textoSalvo != null && !String.valueOf(textoSalvo).isBlank()) {
        String origem = tarefa.get("origem_texto") == null ? "template" : (String) tarefa.get("origem_texto");
        OutputStream saida = abrirSse(contexto);
        escreverSse(saida, "origem", Json.mapa("tarefa", tarefaId, "origem", origem, "salvo", true));
        escreverSse(saida, "trecho", Json.mapa("texto", textoSalvo));
        escreverSse(saida, "fim", Json.mapa(
            "tarefa", tarefaId, "origem", origem, "texto", textoSalvo, "salvo", true));
        saida.close();
        return;
      }

      Ia.Vaga vaga = Ia.reservarGeracao("tarefa:" + tarefaId);
      if (!vaga.ok()) {
        contexto.status(vaga.codigo()).json(Json.mapa("erro", vaga.motivo()));
        return;
      }

      Map<String, Object> contextoDaIa = Ia.montarContextoDaTarefa(banco, tarefa);
      OutputStream saida = abrirSse(contexto);
      String origem = "template";
      try {
        escreverSse(saida, "origem", Json.mapa("tarefa", tarefaId, "origem", origem));
        StringBuilder acumulado = new StringBuilder();
        Ia.gerarTextoDaTarefa(contextoDaIa, trecho -> {
          acumulado.append(trecho);
          try {
            escreverSse(saida, "trecho", Json.mapa("texto", trecho));
          } catch (IOException erro) {
            throw new RuntimeException(erro);
          }
        });

        String texto = acumulado.toString().strip();
        // So grava texto e origem na tarefa. Nenhuma outra tabela e tocada aqui.
        if (!texto.isEmpty()) {
          banco.executar("UPDATE tarefas_humanas SET texto_ia = ?, origem_texto = ? WHERE id = ?",
              texto, origem, tarefaId);
        }
        escreverSse(saida, "fim", Json.mapa(
            "tarefa", tarefaId, "origem", origem, "texto", texto, "salvo", !texto.isEmpty()));
      } catch (RuntimeException erro) {
        System.err.println("[erro] falha ao gerar o texto da tarefa: " + erro.getMessage());
        escreverSse(saida, "falha", Json.mapa("tarefa", tarefaId, "erro", "não foi possível gerar o texto"));
      } finally {
        Ia.liberarGeracao("tarefa:" + tarefaId);
        saida.close();
      }
    } catch (IOException erro) {
      System.err.println("[erro] cliente do texto-ia desconectou: " + erro.getMessage());
      Ia.liberarGeracao("tarefa:" + tarefaId);
    }
  }

  // --- front -----------------------------------------------------------------------------

  /**
   * Serve ./web/dist quando a pasta existir, com fallback pro index.html em rotas que nao
   * sejam /api nem /mock (o front e uma SPA). Sem a pasta, a API sobe sozinha.
   */
  private void registrarFrontEnd(Javalin servidor) {
    servidor.get("/*", contexto -> {
      String caminho = contexto.path();
      if (caminho.startsWith("/api") || caminho.startsWith("/mock")) {
        contexto.status(404).json(Json.mapa("erro", "rota não encontrada"));
        return;
      }
      Path indice = Caminhos.pastaDoFront().resolve("index.html");
      if (!Files.isRegularFile(indice)) {
        contexto.status(404).json(Json.mapa("erro", "front não publicado em web/dist"));
        return;
      }
      contexto.contentType("text/html; charset=utf-8");
      contexto.result(Files.readString(indice, StandardCharsets.UTF_8));
    });
  }
}
