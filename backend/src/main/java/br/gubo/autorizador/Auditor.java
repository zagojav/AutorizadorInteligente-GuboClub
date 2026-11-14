package br.gubo.autorizador;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Auditor de consistencia: cruza fila, cadastro, guias e regras procurando contradicao nos
 * dados do kit. Tudo sai de consulta ao banco (nada de id fixo no codigo), e nenhum alerta
 * muda a decisao do motor: muda_resultado e sempre false, e material pra equipe ver.
 */
public final class Auditor {

  private static final String FONTE_FILA = "kit/data/fila_autorizacao_mock.csv";
  private static final String FONTE_PACIENTES = "kit/data/pacientes_sinteticos.csv";
  private static final String FONTE_GUIAS = "kit/data/os_guias_mock.csv";
  private static final String FONTE_REGRAS = "kit/docs/regras_convenios_demo.md (REGRAS-DEMO-v1)";

  private Auditor() {
  }

  private static Map<String, Object> alerta(String tipo, String referencia, String descricao, String fonte) {
    return Json.mapa(
        "tipo", tipo,
        "referencia", referencia,
        "descricao", descricao,
        "fonte", fonte,
        "muda_resultado", false);
  }

  /** Convenio do cadastro do paciente diferente do convenio com que a solicitacao entrou. */
  private static List<Map<String, Object>> acharConvenioDivergente(Banco banco) {
    List<Map<String, Object>> linhas = banco.consultar("""
        SELECT s.id, s.paciente, s.convenio AS convenio_fila, p.convenio AS convenio_cadastro,
               COALESCE(c.nome, s.convenio) AS nome_convenio_fila
        FROM solicitacoes s
        JOIN pacientes p ON p.patient_id = s.paciente
        LEFT JOIN convenios c ON c.id = s.convenio
        WHERE s.sintetica = 0
        ORDER BY s.id
        """);

    List<Map<String, Object>> alertas = new ArrayList<>();
    for (Map<String, Object> linha : linhas) {
      String cadastro = Banco.normalizarConvenio((String) linha.get("convenio_cadastro"));
      String fila = Banco.normalizarConvenio((String) linha.get("convenio_fila"));
      if (!cadastro.equals(fila)) {
        alertas.add(alerta("convenio_divergente",
            (String) linha.get("id"),
            "paciente " + linha.get("paciente") + " é " + linha.get("convenio_cadastro")
                + " no cadastro e " + linha.get("nome_convenio_fila") + " na fila",
            FONTE_PACIENTES + " x " + FONTE_FILA));
      }
    }
    return alertas;
  }

  /** Procedimento da solicitacao fora do que a regra daquele convenio cobre. */
  private static List<Map<String, Object>> acharProcedimentoForaDaRegra(Banco banco) {
    List<Map<String, Object>> linhas = banco.consultar("""
        SELECT s.id, s.convenio, s.procedimento, r.procedimento AS procedimento_da_regra, r.fonte
        FROM solicitacoes s
        JOIN regras r ON r.convenio = s.convenio
        WHERE s.sintetica = 0
          AND r.procedimento <> 'qualquer'
          AND s.procedimento IS NOT NULL
          AND s.procedimento <> r.procedimento
        ORDER BY s.id
        """);

    List<Map<String, Object>> alertas = new ArrayList<>();
    for (Map<String, Object> linha : linhas) {
      alertas.add(alerta("procedimento_fora_da_regra",
          (String) linha.get("id"),
          "procedimento " + linha.get("procedimento") + ", mas a regra do convênio "
              + linha.get("convenio") + " só cobre " + linha.get("procedimento_da_regra"),
          FONTE_REGRAS));
    }
    return alertas;
  }

  /**
   * Guia pronta com numero de autorizacao enquanto a solicitacao do mesmo paciente nao tem
   * autorizacao nenhuma (nem a efetiva nem a que o kit esperava).
   */
  private static List<Map<String, Object>> acharGuiaConflitante(Banco banco) {
    List<Map<String, Object>> linhas = banco.consultar("""
        SELECT g.os_id, g.patient_id, g.autorizacao, g.status AS status_guia,
               s.id AS solicitacao, s.status AS status_solicitacao, s.status_esperado_kit, s.numero_autorizacao
        FROM guias g
        JOIN solicitacoes s ON s.paciente = g.patient_id
        WHERE s.sintetica = 0
          AND TRIM(COALESCE(g.autorizacao, '')) <> ''
          AND TRIM(COALESCE(s.numero_autorizacao, '')) = ''
          AND COALESCE(s.status_esperado_kit, '') <> 'autorizado'
        ORDER BY g.os_id
        """);

    List<Map<String, Object>> alertas = new ArrayList<>();
    for (Map<String, Object> linha : linhas) {
      alertas.add(alerta("guia_conflitante",
          linha.get("solicitacao") + "/" + linha.get("os_id"),
          "guia " + linha.get("os_id") + " está " + linha.get("status_guia") + " com "
              + linha.get("autorizacao") + ", mas a fila diz " + linha.get("status_esperado_kit")
              + " para " + linha.get("solicitacao"),
          FONTE_GUIAS + " x " + FONTE_FILA));
    }
    return alertas;
  }

  /** Cadastro que nao esta 'correto' no kit (divergente, incompleto...). */
  private static List<Map<String, Object>> acharCadastroIrregular(Banco banco) {
    List<Map<String, Object>> linhas = banco.consultar("""
        SELECT patient_id, status_cadastro
        FROM pacientes
        WHERE COALESCE(status_cadastro, '') <> 'correto'
        ORDER BY patient_id
        """);

    List<Map<String, Object>> alertas = new ArrayList<>();
    for (Map<String, Object> linha : linhas) {
      alertas.add(alerta("cadastro_irregular",
          (String) linha.get("patient_id"),
          "cadastro " + linha.get("status_cadastro"),
          FONTE_PACIENTES));
    }
    return alertas;
  }

  /** Paciente sem consentimento de contato simulado: nao entra em follow-up automatico. */
  private static List<Map<String, Object>> acharSemConsentimento(Banco banco) {
    List<Map<String, Object>> linhas = banco.consultar("""
        SELECT patient_id
        FROM pacientes
        WHERE consentimento_contato_simulado = 0
        ORDER BY patient_id
        """);

    List<Map<String, Object>> alertas = new ArrayList<>();
    for (Map<String, Object> linha : linhas) {
      alertas.add(alerta("sem_consentimento",
          (String) linha.get("patient_id"),
          "sem consentimento de contato simulado: não entra em contato automático",
          FONTE_PACIENTES));
    }
    return alertas;
  }

  public static List<Map<String, Object>> auditarConsistencia(Banco banco) {
    List<Map<String, Object>> alertas = new ArrayList<>();
    alertas.addAll(acharConvenioDivergente(banco));
    alertas.addAll(acharProcedimentoForaDaRegra(banco));
    alertas.addAll(acharGuiaConflitante(banco));
    alertas.addAll(acharCadastroIrregular(banco));
    alertas.addAll(acharSemConsentimento(banco));
    return alertas;
  }

  public static Map<String, Object> resumir(Banco banco) {
    List<Map<String, Object>> alertas = auditarConsistencia(banco);
    Map<String, Object> porTipo = new LinkedHashMap<>();
    for (Map<String, Object> item : alertas) {
      String tipo = (String) item.get("tipo");
      porTipo.merge(tipo, 1L, (anterior, incremento) ->
          ((Number) anterior).longValue() + ((Number) incremento).longValue());
    }
    return Json.mapa(
        "simulado", true,
        "total", (long) alertas.size(),
        "por_tipo", porTipo,
        "alertas", alertas);
  }
}
