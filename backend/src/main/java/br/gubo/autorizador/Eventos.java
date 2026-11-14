package br.gubo.autorizador;

import java.util.List;
import java.util.Map;

/**
 * Log de auditoria: so aceita inclusao. Nao existe update nem delete aqui de proposito.
 */
public final class Eventos {

  private Eventos() {
  }

  public static void registrar(Banco banco, String solicitacao, String statusDe, String statusPara,
      String motivo, String regraUsada, String ator) {
    banco.executar("""
        INSERT INTO eventos (solicitacao, status_de, status_para, motivo, regra_usada, ator, horario)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, solicitacao, statusDe, statusPara, motivo, regraUsada, ator, Tempo.agora());
  }

  public static List<Map<String, Object>> linhaDoTempo(Banco banco, String solicitacaoId) {
    return banco.consultar("SELECT id, solicitacao, status_de, status_para, motivo, regra_usada, ator, horario FROM eventos WHERE solicitacao = ? ORDER BY id ASC", solicitacaoId);
  }
}
