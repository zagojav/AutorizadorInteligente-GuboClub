package br.gubo.autorizador;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Metricas da simulacao. Todo numero sai do banco (tabela chamadas e estado das
 * solicitacoes): nao existe valor fixo aqui. 'simulado: true' vai junto de proposito, pra
 * ninguem confundir isso com resultado de atendimento real.
 */
public final class Metricas {

  /**
   * Resultado dos 4 casos do kit, guardado por quem rodou (boot ou POST /api/testes/rodar).
   * Rodar os casos e caro, entao as metricas leem o ultimo resultado em vez de rodar de novo.
   */
  private static volatile Map<String, Object> ultimoResultadoDosCasos;

  private Metricas() {
  }

  public static void guardarResultadoDosCasos(Map<String, Object> resultado) {
    if (resultado == null || !(resultado.get("total") instanceof Number)) {
      return;
    }
    ultimoResultadoDosCasos = Json.mapa(
        "passaram", resultado.get("passaram"),
        "total", resultado.get("total"),
        "horario", Tempo.agora());
  }

  public static Map<String, Object> obterResultadoDosCasos() {
    return ultimoResultadoDosCasos;
  }

  static void esquecerResultadoDosCasos() {
    ultimoResultadoDosCasos = null;
  }

  /** Percentil por posicao (nearest-rank), sobre a lista ja ordenada. */
  static Long percentil(List<Long> ordenadas, int porcentagem) {
    if (ordenadas.isEmpty()) {
      return null;
    }
    int posicao = (int) Math.ceil((porcentagem / 100.0) * ordenadas.size()) - 1;
    int indice = Math.min(Math.max(posicao, 0), ordenadas.size() - 1);
    return ordenadas.get(indice);
  }

  private static List<Long> latenciasDe(Banco banco, String convenio) {
    List<Map<String, Object>> linhas = convenio == null
        ? banco.consultar("SELECT latencia_ms FROM chamadas ORDER BY latencia_ms ASC")
        : banco.consultar("SELECT latencia_ms FROM chamadas WHERE convenio = ? ORDER BY latencia_ms ASC", convenio);
    List<Long> latencias = new ArrayList<>();
    for (Map<String, Object> linha : linhas) {
      latencias.add(((Number) linha.get("latencia_ms")).longValue());
    }
    return latencias;
  }

  /**
   * O kit diz qual era o resultado esperado de cada solicitacao; aqui e a traducao daquele
   * vocabulario para os estados do motor.
   */
  private static String estadoEsperado(String statusDoKit) {
    return switch (statusDoKit == null ? "" : statusDoKit) {
      case "autorizado" -> "autorizada";
      case "pendente_documento" -> "pendente_documento";
      case "servico_indisponivel" -> "tarefa_humana";
      default -> null;
    };
  }

  private record Encaminhamentos(long corretos, long total, List<Map<String, Object>> detalhe) {
  }

  private static Encaminhamentos contarEncaminhamentosCorretos(Banco banco) {
    List<Map<String, Object>> linhas = banco.consultar("""
        SELECT id, status, status_esperado_kit
        FROM solicitacoes
        WHERE sintetica = 0 AND status_esperado_kit IS NOT NULL
        ORDER BY id
        """);

    List<Map<String, Object>> detalhe = new ArrayList<>();
    long corretos = 0;
    for (Map<String, Object> linha : linhas) {
      String esperado = estadoEsperado((String) linha.get("status_esperado_kit"));
      String obtido = (String) linha.get("status");
      boolean correto = esperado != null && esperado.equals(obtido);
      if (correto) {
        corretos += 1;
      }
      detalhe.add(Json.mapa("id", linha.get("id"), "esperado", esperado, "obtido", obtido, "correto", correto));
    }
    return new Encaminhamentos(corretos, linhas.size(), detalhe);
  }

  public static Map<String, Object> calcular(Banco banco) {
    List<Long> latencias = latenciasDe(banco, null);
    long totalDeChamadas = latencias.size();
    long falhasDeChamada = banco.contar("SELECT COUNT(*) AS total FROM chamadas WHERE sucesso = 0");
    // Solicitacoes que o disjuntor barrou antes de chamar a API tambem sao falha detectada.
    long bloqueiosDeDisjuntor = banco.contar(
        "SELECT COUNT(*) AS total FROM solicitacoes WHERE motivo LIKE 'disjuntor aberto:%'");

    List<Map<String, Object>> convenios = banco.consultar("""
        SELECT id, nome, status_integracao, disjuntor, falhas_seguidas
        FROM convenios ORDER BY id
        """);

    Map<String, Object> porConvenio = new LinkedHashMap<>();
    for (Map<String, Object> convenio : convenios) {
      String id = (String) convenio.get("id");
      List<Long> suas = latenciasDe(banco, id);
      long falhas = banco.contar(
          "SELECT COUNT(*) AS total FROM chamadas WHERE convenio = ? AND sucesso = 0", id);
      long tarefas = banco.contar("""
          SELECT COUNT(*) AS total FROM tarefas_humanas t
          JOIN solicitacoes s ON s.id = t.solicitacao
          WHERE s.convenio = ? AND t.status = 'aberta'
          """, id);

      porConvenio.put(id, Json.mapa(
          "nome", convenio.get("nome"),
          "status_integracao", convenio.get("status_integracao"),
          "disjuntor", convenio.get("disjuntor"),
          "falhas_seguidas", convenio.get("falhas_seguidas"),
          "chamadas", (long) suas.size(),
          "falhas", falhas,
          "latencia_p50_ms", percentil(suas, 50),
          "latencia_p95_ms", percentil(suas, 95),
          "tarefas_abertas", tarefas));
    }

    Encaminhamentos encaminhamentos = contarEncaminhamentosCorretos(banco);
    Map<String, Object> casos = obterResultadoDosCasos();
    long tarefasAbertas = banco.contar(
        "SELECT COUNT(*) AS total FROM tarefas_humanas WHERE status = 'aberta'");

    return Json.mapa(
        "simulado", true,
        "falhas_detectadas", falhasDeChamada + bloqueiosDeDisjuntor,
        "chamadas", totalDeChamadas,
        "latencia_p50_ms", percentil(latencias, 50),
        "latencia_p95_ms", percentil(latencias, 95),
        "por_convenio", porConvenio,
        "encaminhamentos_corretos", encaminhamentos.corretos() + "/" + encaminhamentos.total(),
        "encaminhamentos_detalhe", encaminhamentos.detalhe(),
        "casos_kit", casos == null ? "pendente" : casos.get("passaram") + "/" + casos.get("total"),
        "tarefas_abertas", tarefasAbertas);
  }
}
