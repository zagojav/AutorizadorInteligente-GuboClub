package br.gubo.autorizador;

import java.util.Map;

/**
 * Disjuntor por convenio: fechado -> aberto -> meio_aberto -> fechado.
 * Abre depois de 3 falhas seguidas. Aberto, bloqueia a chamada (nao chega na API simulada).
 * Depois da espera, vira meio_aberto e libera UMA chamada de teste: sucesso fecha, falha
 * reabre.
 */
public final class Disjuntor {

  public static final int FALHAS_PARA_ABRIR = 3;

  private final Banco banco;
  private final TempoReal tempoReal;

  public Disjuntor(Banco banco, TempoReal tempoReal) {
    this.banco = banco;
    this.tempoReal = tempoReal;
  }

  /** 15 s na demo. Os testes encurtam por DISJUNTOR_ESPERA_MS pra nao esperar de verdade. */
  public static long esperaParaMeioAbertoMs() {
    return Config.numero("DISJUNTOR_ESPERA_MS", 15000, 0);
  }

  /** Resultado da avaliacao antes da chamada. */
  public record Portao(boolean permitido, String estado, String motivo) {
  }

  private Map<String, Object> buscarConvenio(String convenioId) {
    return banco.consultarUm("SELECT * FROM convenios WHERE id = ?", convenioId);
  }

  private void anotarMudanca(Map<String, Object> convenio, String de, String para, String motivo) {
    String id = (String) convenio.get("id");
    Eventos.registrar(banco, "convenio:" + id, "disjuntor_" + de, "disjuntor_" + para,
        motivo, null, "sistema");
    tempoReal.publicar("disjuntor_mudou", Json.mapa(
        "convenio", id,
        "nome", convenio.get("nome"),
        "de", de,
        "para", para,
        "motivo", motivo));
  }

  /**
   * Decide se a chamada pode sair. Tambem e aqui que o 'aberto' vence o tempo e vira
   * 'meio_aberto'.
   */
  public Portao avaliarAntesDaChamada(String convenioId) {
    Map<String, Object> convenio = buscarConvenio(convenioId);
    if (convenio == null) {
      return new Portao(true, "fechado", null);
    }

    String estado = (String) convenio.get("disjuntor");
    if ("aberto".equals(estado)) {
      String abertoEm = (String) convenio.get("aberto_em");
      long tempoAberto = System.currentTimeMillis() - Tempo.paraMilissegundos(abertoEm);
      if (tempoAberto >= esperaParaMeioAbertoMs()) {
        banco.executar("UPDATE convenios SET disjuntor = 'meio_aberto' WHERE id = ?", convenioId);
        anotarMudanca(convenio, "aberto", "meio_aberto",
            convenio.get("nome") + ": espera cumprida, liberando 1 chamada de teste");
        return new Portao(true, "meio_aberto", null);
      }
      return new Portao(false, "aberto",
          "disjuntor aberto: " + convenio.get("nome") + " indisponível");
    }

    return new Portao(true, estado, null);
  }

  /** Sucesso: zera o contador, fecha o disjuntor e devolve o status padrao do kit. */
  public void registrarSucesso(String convenioId) {
    Map<String, Object> convenio = buscarConvenio(convenioId);
    if (convenio == null) {
      return;
    }
    banco.executar("""
        UPDATE convenios
        SET falhas_seguidas = 0, disjuntor = 'fechado', aberto_em = NULL, status_integracao = status_padrao
        WHERE id = ?
        """, convenioId);
    String estadoAnterior = (String) convenio.get("disjuntor");
    if (!"fechado".equals(estadoAnterior)) {
      anotarMudanca(convenio, estadoAnterior, "fechado",
          convenio.get("nome") + ": chamada de teste deu certo, disjuntor fechado");
    }
  }

  /** Resultado do registro de falha. */
  public record Falha(String estado, long falhas) {
  }

  /**
   * Falha: soma no contador e abre o disjuntor na 3a falha seguida (ou volta a abrir se a
   * chamada de teste do meio_aberto falhou).
   */
  public Falha registrarFalha(String convenioId) {
    Map<String, Object> convenio = buscarConvenio(convenioId);
    if (convenio == null) {
      return new Falha("fechado", 0);
    }

    String estadoAnterior = (String) convenio.get("disjuntor");
    long falhas = ((Number) convenio.get("falhas_seguidas")).longValue() + 1;
    boolean deveAbrir = "meio_aberto".equals(estadoAnterior) || falhas >= FALHAS_PARA_ABRIR;
    String estado = deveAbrir ? "aberto" : estadoAnterior;
    String statusIntegracao = deveAbrir || "fora".equals(convenio.get("status_padrao"))
        ? "fora"
        : "degradado";

    banco.executar("""
        UPDATE convenios
        SET falhas_seguidas = ?, disjuntor = ?, status_integracao = ?, aberto_em = ?
        WHERE id = ?
        """, falhas, estado, statusIntegracao,
        deveAbrir ? Tempo.agora() : convenio.get("aberto_em"), convenioId);

    if (deveAbrir && !"aberto".equals(estadoAnterior)) {
      String motivo = "meio_aberto".equals(estadoAnterior)
          ? convenio.get("nome") + ": chamada de teste falhou, disjuntor reaberto"
          : convenio.get("nome") + ": " + falhas + " falhas seguidas, disjuntor aberto";
      anotarMudanca(convenio, estadoAnterior, "aberto", motivo);
    }

    return new Falha(estado, falhas);
  }
}
