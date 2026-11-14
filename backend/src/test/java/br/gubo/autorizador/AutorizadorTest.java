package br.gubo.autorizador;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * Testes do autorizador. Sobe o servidor inteiro numa porta efemera e aponta o motor pra
 * propria API simulada, como em producao: a chamada sai por HTTP de verdade.
 */
@TestMethodOrder(MethodOrderer.DisplayName.class)
class AutorizadorTest {

  private static Aplicacao.Servidor servidor;
  private static Banco banco;
  private static String base;
  private static final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(2))
      .build();

  @BeforeAll
  static void subirServidor() {
    // Latencia fixa e esperas curtas: o teste nao espera os 200/400/800 ms reais.
    System.setProperty("MOCK_LATENCIA_MS", "5");
    System.setProperty("ESPERAS_RETENTATIVA_MS", "5,5,5");
    System.setProperty("IA_ATRASO_TEMPLATE_MS", "0");
    System.setProperty("DISJUNTOR_ESPERA_MS", "60000");

    banco = Banco.abrir(":memory:");
    banco.seed();
    servidor = Aplicacao.construir(banco);
    servidor.javalin().start(0);
    int porta = servidor.javalin().port();
    base = "http://127.0.0.1:" + porta;
    System.setProperty("MOCK_URL", base + "/mock");
  }

  @AfterAll
  static void derrubarServidor() {
    if (servidor != null) {
      servidor.encerrar();
    }
  }

  @BeforeEach
  void limparEstado() {
    banco.seed();
    banco.restaurarTodosOsConvenios();
    servidor.apiSimulada().resetarModos();
    Ia.resetarLimites();
    System.setProperty("DISJUNTOR_ESPERA_MS", "60000");
  }

  // --- utilitarios ---------------------------------------------------------------------

  private record Resposta(int codigo, String corpo, Map<String, List<String>> cabecalhos) {
    Map<String, Object> mapa() {
      return Json.lerMapa(corpo);
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> lista() {
      try {
        return Json.mapeador().readValue(corpo, List.class);
      } catch (Exception erro) {
        throw new IllegalStateException("resposta nao e lista: " + corpo, erro);
      }
    }
  }

  private static Resposta chamar(String metodo, String caminho, String corpoEnviado, String... cabecalhos) {
    try {
      HttpRequest.Builder construtor = HttpRequest.newBuilder()
          .uri(URI.create(base + caminho))
          .timeout(Duration.ofSeconds(60));
      for (int indice = 0; indice < cabecalhos.length; indice += 2) {
        construtor.header(cabecalhos[indice], cabecalhos[indice + 1]);
      }
      if ("POST".equals(metodo)) {
        construtor.POST(corpoEnviado == null
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofString(corpoEnviado));
        if (corpoEnviado != null) {
          construtor.header("content-type", "application/json");
        }
      } else {
        construtor.GET();
      }
      HttpResponse<byte[]> resposta = http.send(construtor.build(), HttpResponse.BodyHandlers.ofByteArray());
      String texto = resposta.headers().firstValue("content-encoding").orElse("").contains("gzip")
          ? descomprimir(resposta.body())
          : new String(resposta.body(), StandardCharsets.UTF_8);
      return new Resposta(resposta.statusCode(), texto, resposta.headers().map());
    } catch (Exception erro) {
      throw new IllegalStateException("falha ao chamar " + caminho + ": " + erro.getMessage(), erro);
    }
  }

  private static String descomprimir(byte[] bytes) throws IOException {
    try (GZIPInputStream fluxo = new GZIPInputStream(new java.io.ByteArrayInputStream(bytes))) {
      return new String(fluxo.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  private Map<String, Object> solicitacao(String id) {
    return banco.consultarUm("SELECT * FROM solicitacoes WHERE id = ?", id);
  }

  private long contarChamadas(String convenio) {
    return banco.contar("SELECT COUNT(*) AS total FROM chamadas WHERE convenio = ?", convenio);
  }

  // --- os 4 casos do kit ---------------------------------------------------------------

  @Test
  @DisplayName("01 - Caso 1: Aurora Demo retorna autorizacao DEMO")
  void caso1AuroraAutoriza() {
    Motor.ResultadoDeCaso resultado = servidor.motor().casoAuroraAutoriza();
    assertTrue(resultado.passou(), "Aurora deveria autorizar");
    assertEquals("autorizada", resultado.solicitacao().get("status"));
    assertEquals("DEMO-AUTH-1", resultado.solicitacao().get("numero_autorizacao"));
    assertEquals("REGRAS-DEMO-v1", resultado.solicitacao().get("regra_usada"));
    assertNotNull(resultado.solicitacao().get("motivo"));
  }

  @Test
  @DisplayName("02 - Caso 2: Horizonte sem documento mantem pendencia")
  void caso2HorizontePendente() {
    Motor.ResultadoDeCaso resultado = servidor.motor().casoHorizonteSemDocumentoFicaPendente();
    assertTrue(resultado.passou());
    assertEquals("pendente_documento", resultado.solicitacao().get("status"));
    assertNull(resultado.solicitacao().get("numero_autorizacao"));
  }

  @Test
  @DisplayName("03 - Caso 3: Jardim indisponivel cria tarefa humana")
  void caso3JardimTarefaHumana() {
    Motor.ResultadoDeCaso resultado = servidor.motor().casoJardimIndisponivelCriaTarefa();
    assertTrue(resultado.passou());
    assertEquals("tarefa_humana", resultado.solicitacao().get("status"));
    assertNull(resultado.solicitacao().get("numero_autorizacao"));

    Map<String, Object> tarefa =
        banco.consultarUm("SELECT * FROM tarefas_humanas WHERE solicitacao = ?", "DEMO-R3");
    assertNotNull(tarefa);
    assertEquals("alta", tarefa.get("prioridade"));
    assertNotNull(tarefa.get("prazo"));
    // Retentativa: 3 tentativas gravadas e 3 chamadas registradas.
    assertEquals(3L, ((Number) resultado.solicitacao().get("tentativas")).longValue());
    assertEquals(3L, contarChamadas("jardim"));
    assertTrue(String.valueOf(resultado.solicitacao().get("motivo")).contains("após 3 tentativas"));
  }

  @Test
  @DisplayName("04 - Caso 4 (TRAVA): resposta sem numero nunca autoriza")
  void caso4TravaSemNumero() {
    Motor.ResultadoDeCaso resultado = servidor.motor().casoSemNumeroNaoAutoriza();
    assertTrue(resultado.passou());
    assertEquals("tarefa_humana", resultado.solicitacao().get("status"));
    assertNull(resultado.solicitacao().get("numero_autorizacao"),
        "nunca pode inventar numero de autorizacao");
    assertEquals("resposta sem número de autorização", resultado.solicitacao().get("motivo"));

    // Nenhuma solicitacao no banco pode estar autorizada sem numero.
    assertEquals(0L, banco.contar("""
        SELECT COUNT(*) AS total FROM solicitacoes
        WHERE status = 'autorizada' AND TRIM(COALESCE(numero_autorizacao, '')) = ''
        """));
  }

  @Test
  @DisplayName("05 - Os 4 casos juntos dao 4/4 em /api/testes/rodar")
  void quatroCasosPelaRota() {
    Resposta resposta = chamar("POST", "/api/testes/rodar", null);
    assertEquals(200, resposta.codigo());
    Map<String, Object> corpo = resposta.mapa();
    assertEquals(4, ((Number) corpo.get("passaram")).intValue());
    assertEquals(4, ((Number) corpo.get("total")).intValue());
  }

  // --- documento -----------------------------------------------------------------------

  @Test
  @DisplayName("06 - Anexar documento no DEMO-R2 resolve para autorizada com sugestao")
  @SuppressWarnings("unchecked")
  void anexarDocumentoNoR2() {
    servidor.motor().processarSolicitacao("DEMO-R2", "normal");
    assertEquals("pendente_documento", solicitacao("DEMO-R2").get("status"));

    Resposta resposta = chamar("POST", "/api/solicitacoes/DEMO-R2/documentos", null);
    assertEquals(200, resposta.codigo());
    Map<String, Object> corpo = resposta.mapa();

    assertEquals("autorizada", corpo.get("status"));
    assertEquals("DEMO-AUTH-2-SIMULADO", corpo.get("numero_autorizacao"));

    Map<String, Object> sugestao = (Map<String, Object>) corpo.get("sugestao_ia");
    assertNotNull(sugestao, "a resposta tem que trazer sugestao_ia");
    assertEquals("template", sugestao.get("origem"));
    Map<String, Object> achados = (Map<String, Object>) sugestao.get("achados");
    assertEquals("Paciente Exemplo 1", achados.get("nome"));
    assertEquals("DEMO-SEM-VALIDADE-1", achados.get("identificador"));
    assertEquals(true, achados.get("tem_marca_demo"));
  }

  // --- disjuntor -----------------------------------------------------------------------

  @Test
  @DisplayName("07 - Disjuntor abre depois de 3 falhas seguidas")
  void disjuntorAbre() {
    servidor.motor().processarSolicitacao("DEMO-R3", "normal");

    Map<String, Object> convenio = banco.consultarUm("SELECT * FROM convenios WHERE id = 'jardim'");
    assertEquals("aberto", convenio.get("disjuntor"));
    assertEquals(3L, ((Number) convenio.get("falhas_seguidas")).longValue());
    assertEquals("fora", convenio.get("status_integracao"));

    // A mudanca do disjuntor fica no log de auditoria.
    assertTrue(banco.contar("SELECT COUNT(*) AS total FROM eventos WHERE solicitacao = ?",
        "convenio:jardim") > 0);
  }

  @Test
  @DisplayName("08 - Disjuntor aberto bloqueia sem chamar a API")
  void disjuntorBloqueia() {
    servidor.motor().processarSolicitacao("DEMO-R3", "normal");
    assertEquals("aberto",
        banco.consultarUm("SELECT disjuntor FROM convenios WHERE id = 'jardim'").get("disjuntor"));

    long chamadasAntes = contarChamadas("jardim");
    List<Banco.Sintetica> sinteticas = banco.criarSolicitacoesSinteticas(1);
    String doJardim = sinteticas.stream()
        .filter(item -> "jardim".equals(item.convenio()))
        .findFirst().orElseThrow().id();

    servidor.motor().processarSolicitacao(doJardim);

    Map<String, Object> bloqueada = solicitacao(doJardim);
    assertEquals("tarefa_humana", bloqueada.get("status"));
    assertTrue(String.valueOf(bloqueada.get("motivo"))
        .startsWith("disjuntor aberto: Jardim Demo indisponível"));
    assertNull(bloqueada.get("numero_autorizacao"));
    // Prova de que bloqueou: nenhuma chamada nova foi registrada.
    assertEquals(chamadasAntes, contarChamadas("jardim"));
  }

  @Test
  @DisplayName("09 - Disjuntor meio_aberto fecha quando a chamada de teste da certo")
  void disjuntorMeioAbertoFecha() {
    servidor.apiSimulada().definirModo("aurora", "caos");
    servidor.motor().processarSolicitacao("DEMO-R1");
    assertEquals("aberto",
        banco.consultarUm("SELECT disjuntor FROM convenios WHERE id = 'aurora'").get("disjuntor"));

    // Convenio volta ao normal e a espera zera: a proxima vira chamada de teste.
    servidor.apiSimulada().resetarModos();
    System.setProperty("DISJUNTOR_ESPERA_MS", "0");

    List<Banco.Sintetica> sinteticas = banco.criarSolicitacoesSinteticas(1);
    String daAurora = sinteticas.stream()
        .filter(item -> "aurora".equals(item.convenio()))
        .findFirst().orElseThrow().id();
    servidor.motor().processarSolicitacao(daAurora);

    Map<String, Object> convenio = banco.consultarUm("SELECT * FROM convenios WHERE id = 'aurora'");
    assertEquals("fechado", convenio.get("disjuntor"));
    assertEquals(0L, ((Number) convenio.get("falhas_seguidas")).longValue());
    assertEquals("ok", convenio.get("status_integracao"));

    Map<String, Object> testada = solicitacao(daAurora);
    assertEquals("autorizada", testada.get("status"));
    // Chamada de teste e uma so: nao retenta no meio_aberto.
    assertEquals(1L, ((Number) testada.get("tentativas")).longValue());
  }

  @Test
  @DisplayName("10 - Fila isolada: Jardim caindo nao impede Aurora e Horizonte")
  void filaIsolada() {
    Resposta resposta = chamar("POST", "/api/fila/iniciar", null);
    assertEquals(200, resposta.codigo());

    assertEquals("autorizada", solicitacao("DEMO-R1").get("status"));
    assertEquals("pendente_documento", solicitacao("DEMO-R2").get("status"));
    assertEquals("tarefa_humana", solicitacao("DEMO-R3").get("status"));
  }

  // --- auditor -------------------------------------------------------------------------

  @Test
  @DisplayName("11 - Auditor acha os 8 alertas obrigatorios do kit")
  void auditorAchaOsAlertasObrigatorios() {
    List<Map<String, Object>> alertas = Auditor.auditarConsistencia(banco);

    assertTrue(temAlerta(alertas, "convenio_divergente", "DEMO-R1", "DEMO-P001", "Horizonte Demo", "Aurora Demo"));
    assertTrue(temAlerta(alertas, "convenio_divergente", "DEMO-R2", "DEMO-P002", "Jardim Demo", "Horizonte Demo"));
    assertTrue(temAlerta(alertas, "convenio_divergente", "DEMO-R3", "DEMO-P003", "Aurora Demo", "Jardim Demo"));
    assertTrue(temAlerta(alertas, "procedimento_fora_da_regra", "DEMO-R1", "DEMO-2", "aurora", "DEMO-1"));
    assertTrue(temAlerta(alertas, "procedimento_fora_da_regra", "DEMO-R2", "DEMO-3", "horizonte", "DEMO-2"));
    assertTrue(temAlerta(alertas, "guia_conflitante", "DEMO-OS003", "DEMO-AUTH-3", "servico_indisponivel"));
    assertTrue(temAlerta(alertas, "cadastro_irregular", "DEMO-P001", "divergente"));
    assertTrue(temAlerta(alertas, "cadastro_irregular", "DEMO-P002", "incompleto"));
    assertTrue(temAlerta(alertas, "sem_consentimento", "DEMO-P004"));
    assertTrue(temAlerta(alertas, "sem_consentimento", "DEMO-P008"));

    // Jardim cobre 'qualquer' procedimento: DEMO-R3 nao pode gerar esse alerta.
    assertFalse(alertas.stream().anyMatch(alerta ->
        "procedimento_fora_da_regra".equals(alerta.get("tipo"))
            && String.valueOf(alerta.get("referencia")).contains("DEMO-R3")));

    // Nenhum alerta muda resultado, e todos citam a fonte no kit.
    for (Map<String, Object> alerta : alertas) {
      assertEquals(false, alerta.get("muda_resultado"));
      assertTrue(String.valueOf(alerta.get("fonte")).startsWith("kit/"));
    }
    assertTrue(alertas.size() >= 11, "esperava pelo menos 11 alertas, veio " + alertas.size());
  }

  private static boolean temAlerta(List<Map<String, Object>> alertas, String tipo, String referencia,
      String... termos) {
    return alertas.stream().anyMatch(alerta -> {
      if (!tipo.equals(alerta.get("tipo"))
          || !String.valueOf(alerta.get("referencia")).contains(referencia)) {
        return false;
      }
      String descricao = String.valueOf(alerta.get("descricao")).toLowerCase();
      for (String termo : termos) {
        if (!descricao.contains(termo.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }

  @Test
  @DisplayName("12 - Auditoria pela rota ignora as sinteticas")
  void auditoriaIgnoraSinteticas() {
    long antes = ((Number) chamar("GET", "/api/auditoria", null).mapa().get("total")).longValue();
    banco.criarSolicitacoesSinteticas(5);
    long depois = ((Number) chamar("GET", "/api/auditoria", null).mapa().get("total")).longValue();
    assertEquals(antes, depois, "sintetica de carga nao pode gerar alerta");
  }

  // --- metricas ------------------------------------------------------------------------

  @Test
  @DisplayName("13 - Metricas: p50, p95, 3/3 e simulado true")
  void metricas() {
    chamar("POST", "/api/fila/iniciar", null);
    Map<String, Object> metricas = chamar("GET", "/api/metricas", null).mapa();

    assertEquals(true, metricas.get("simulado"));
    assertEquals("3/3", metricas.get("encaminhamentos_corretos"));
    assertTrue(((Number) metricas.get("chamadas")).longValue() > 0);
    assertNotNull(metricas.get("latencia_p50_ms"));
    assertNotNull(metricas.get("latencia_p95_ms"));
    assertTrue(((Number) metricas.get("latencia_p95_ms")).longValue()
        >= ((Number) metricas.get("latencia_p50_ms")).longValue());

    // p50 conferido na mao contra a tabela chamadas.
    List<Map<String, Object>> linhas =
        banco.consultar("SELECT latencia_ms FROM chamadas ORDER BY latencia_ms ASC");
    List<Long> latencias = linhas.stream().map(linha -> ((Number) linha.get("latencia_ms")).longValue()).toList();
    assertEquals(Metricas.percentil(latencias, 50),
        ((Number) metricas.get("latencia_p50_ms")).longValue());
  }

  // --- compressao ----------------------------------------------------------------------

  @Test
  @DisplayName("14 - gzip no JSON e NUNCA no SSE")
  void gzipForaDoSse() throws Exception {
    chamar("POST", "/api/fila/iniciar", null);

    Resposta fila = chamar("GET", "/api/fila", null, "accept-encoding", "gzip");
    assertEquals(200, fila.codigo());
    assertTrue(fila.cabecalhos().getOrDefault("content-encoding", List.of()).contains("gzip"),
        "esperava gzip no /api/fila, cabecalhos: " + fila.cabecalhos());
    assertEquals(3, fila.lista().size());

    // SSE: abre, confere os cabecalhos e o inicio do corpo, e fecha.
    HttpRequest requisicao = HttpRequest.newBuilder()
        .uri(URI.create(base + "/api/stream"))
        .timeout(Duration.ofSeconds(10))
        .header("accept-encoding", "gzip, deflate")
        .header("accept", "text/event-stream")
        .GET()
        .build();
    HttpResponse<java.io.InputStream> resposta =
        http.send(requisicao, HttpResponse.BodyHandlers.ofInputStream());
    try {
      assertEquals(200, resposta.statusCode());
      assertTrue(resposta.headers().firstValue("content-type").orElse("").contains("text/event-stream"));
      assertTrue(resposta.headers().firstValue("content-encoding").isEmpty(),
          "o SSE nunca pode vir comprimido: " + resposta.headers().map());

      byte[] pedaco = new byte[200];
      int lidos = resposta.body().read(pedaco);
      String inicio = new String(pedaco, 0, Math.max(lidos, 0), StandardCharsets.UTF_8);
      assertTrue(inicio.startsWith("retry: 2000"), "esperava retry no inicio do SSE, veio: " + inicio);
    } finally {
      resposta.body().close();
    }
  }

  // --- SSE e modo_mudou ----------------------------------------------------------------

  @Test
  @DisplayName("15 - SSE recebe modo_mudou ao derrubar o convenio")
  void sseRecebeModoMudou() throws Exception {
    HttpRequest requisicao = HttpRequest.newBuilder()
        .uri(URI.create(base + "/api/stream"))
        .timeout(Duration.ofSeconds(20))
        .GET()
        .build();
    HttpResponse<java.io.InputStream> resposta =
        http.send(requisicao, HttpResponse.BodyHandlers.ofInputStream());
    try {
      byte[] conexao = new byte[200];
      resposta.body().read(conexao);

      chamar("POST", "/api/convenios/jardim/derrubar", null);

      StringBuilder acumulado = new StringBuilder();
      byte[] pedaco = new byte[1024];
      long prazo = System.currentTimeMillis() + 10000;
      while (!acumulado.toString().contains("event: modo_mudou") && System.currentTimeMillis() < prazo) {
        int lidos = resposta.body().read(pedaco);
        if (lidos < 0) {
          break;
        }
        acumulado.append(new String(pedaco, 0, lidos, StandardCharsets.UTF_8));
      }
      assertTrue(acumulado.toString().contains("event: modo_mudou"),
          "esperava modo_mudou no stream, veio: " + acumulado);
      assertTrue(acumulado.toString().contains("\"modo\":\"caos\""));
      assertTrue(acumulado.toString().contains("\"convenio\":\"jardim\""));
    } finally {
      resposta.body().close();
    }
  }

  // --- IA ------------------------------------------------------------------------------

  @Test
  @DisplayName("16 - Texto da tarefa vem por SSE, com origem template, e a IA nao muda status")
  void textoDaTarefaPorSse() {
    chamar("POST", "/api/fila/iniciar", null);
    long tarefaId = banco.contar("SELECT id FROM tarefas_humanas WHERE solicitacao = 'DEMO-R3'");
    assertTrue(tarefaId > 0, "esperava tarefa humana do DEMO-R3");

    List<Map<String, Object>> antes =
        banco.consultar("SELECT id, status, numero_autorizacao, motivo FROM solicitacoes ORDER BY id");

    Resposta resposta = chamar("GET", "/api/tarefas/" + tarefaId + "/texto-ia/stream", null);
    assertEquals(200, resposta.codigo());
    String corpo = resposta.corpo();

    assertTrue(corpo.startsWith("retry: 2000"));
    assertTrue(corpo.contains("event: origem"));
    assertTrue(corpo.contains("\"origem\":\"template\""), "origem tem que ser template: " + corpo);
    // Texto chega aos poucos: mais de um trecho.
    assertTrue(corpo.split("event: trecho", -1).length - 1 > 5, "esperava varios trechos");
    assertTrue(corpo.contains("event: fim"));

    Map<String, Object> tarefa = banco.consultarUm("SELECT * FROM tarefas_humanas WHERE id = ?", tarefaId);
    assertEquals("template", tarefa.get("origem_texto"));
    String texto = String.valueOf(tarefa.get("texto_ia"));
    assertTrue(texto.contains("DEMO-R3"));
    assertTrue(texto.contains("Jardim Demo"));
    assertTrue(texto.contains("REGRAS-DEMO-v1"));
    assertTrue(texto.split("\n").length <= 5, "no maximo 5 linhas");

    // A IA nao pode mexer em status, numero nem motivo de nenhuma solicitacao.
    List<Map<String, Object>> depois =
        banco.consultar("SELECT id, status, numero_autorizacao, motivo FROM solicitacoes ORDER BY id");
    assertEquals(antes, depois);
  }

  // --- validacao -----------------------------------------------------------------------

  @Test
  @DisplayName("17 - Validacao: id, convenio e modo fora do padrao tomam 400")
  void validacaoDeParametros() {
    assertEquals(400, chamar("GET", "/api/solicitacoes/DEMO-X1/linha-do-tempo", null).codigo());
    assertEquals(400, chamar("GET", "/api/solicitacoes/..%2F..%2Fetc%2Fpasswd/linha-do-tempo", null).codigo());
    assertEquals(404, chamar("GET", "/api/solicitacoes/DEMO-R99/linha-do-tempo", null).codigo());
    assertEquals(400, chamar("POST", "/api/convenios/outro/derrubar", null).codigo());
    assertEquals(400, chamar("POST", "/api/convenios/aurora/modo", "{\"modo\":\"invadir\"}").codigo());
    assertEquals(400, chamar("GET", "/api/tarefas/abc/texto-ia/stream", null).codigo());
    assertEquals(404, chamar("GET", "/api/tarefas/999999/texto-ia/stream", null).codigo());

    // A resposta de erro e curta: nada de stack trace.
    Map<String, Object> erro = chamar("POST", "/api/convenios/outro/derrubar", null).mapa();
    assertEquals("requisição inválida", erro.get("erro"));
    assertEquals(1, erro.size());
  }

  @Test
  @DisplayName("17b - CORS libera o Vite local e nenhuma outra origem")
  void corsSoParaOVite() {
    Resposta doVite = chamar("GET", "/api/saude", null, "origin", "http://localhost:5173");
    assertEquals(200, doVite.codigo());
    assertTrue(doVite.cabecalhos().getOrDefault("access-control-allow-origin", List.of())
            .contains("http://localhost:5173"),
        "esperava CORS pro Vite, cabecalhos: " + doVite.cabecalhos());

    Resposta deOutraOrigem = chamar("GET", "/api/saude", null, "origin", "http://site-de-fora.invalid");
    assertTrue(deOutraOrigem.cabecalhos().getOrDefault("access-control-allow-origin", List.of()).isEmpty(),
        "nenhuma outra origem pode ser liberada: " + deOutraOrigem.cabecalhos());
  }

  @Test
  @DisplayName("18 - Carga sintetica cria 5 por convenio e respeita o limite")
  void cargaSintetica() {
    Map<String, Object> corpo = chamar("POST", "/api/simulacao/carga", null).mapa();
    assertEquals(15, ((Number) corpo.get("criadas")).intValue());
    assertEquals(50, ((Number) corpo.get("limite")).intValue());
    assertTrue(((Number) corpo.get("sinteticas_no_banco")).longValue() <= 50);
    servidor.filas().aguardarConclusao(60000);
  }

  @Test
  @DisplayName("19 - Estaticos: asset com hash tem cache longo, index.html no-cache, SPA cai no index")
  void estaticosDoFront() throws Exception {
    java.nio.file.Path dist = Caminhos.pastaDoFront();
    org.junit.jupiter.api.Assumptions.assumeTrue(
        java.nio.file.Files.isRegularFile(dist.resolve("index.html")),
        "web/dist nao existe: rode npm run build em ./web");

    // index.html: sempre revalidado.
    Resposta raiz = chamar("GET", "/", null);
    assertEquals(200, raiz.codigo());
    assertTrue(raiz.cabecalhos().get("content-type").get(0).startsWith("text/html"));
    assertEquals(List.of("no-cache"), raiz.cabecalhos().get("cache-control"));

    // Rota da SPA que nao e arquivo: devolve o index, nunca 404.
    Resposta spa = chamar("GET", "/painel", null);
    assertEquals(200, spa.codigo());
    assertTrue(spa.corpo().contains("<div id=\"raiz\">"), "esperava o index.html, veio: " + spa.corpo());

    // Primeiro asset JS com hash: content-type de script e cache de um ano.
    try (java.util.stream.Stream<java.nio.file.Path> arquivos = java.nio.file.Files.list(dist.resolve("assets"))) {
      java.nio.file.Path js = arquivos
          .filter(arquivo -> arquivo.getFileName().toString().endsWith(".js"))
          .findFirst()
          .orElseThrow();
      Resposta asset = chamar("GET", "/assets/" + js.getFileName(), null, "accept-encoding", "gzip");
      assertEquals(200, asset.codigo());
      assertTrue(asset.cabecalhos().get("content-type").get(0).startsWith("text/javascript"),
          "content-type errado: " + asset.cabecalhos());
      assertEquals(List.of("public, max-age=31536000, immutable"), asset.cabecalhos().get("cache-control"));
      assertTrue(asset.cabecalhos().getOrDefault("content-encoding", List.of()).contains("gzip"),
          "esperava gzip no asset: " + asset.cabecalhos());
      assertFalse(asset.corpo().contains("<div id=\"raiz\">"), "o asset veio como HTML");
    }

    // Path traversal nao sai da pasta: cai no index (200) ou 404, nunca o arquivo de fora.
    Resposta traversal = chamar("GET", "/assets/../../../pom.xml", null);
    assertFalse(traversal.corpo().contains("<project"), "path traversal vazou um arquivo de fora de web/dist");

    // /api desconhecido continua 404 em JSON, sem cair no index.
    Resposta api = chamar("GET", "/api/nao-existe", null);
    assertEquals(404, api.codigo());
    assertEquals("rota não encontrada", api.mapa().get("erro"));
  }
}
