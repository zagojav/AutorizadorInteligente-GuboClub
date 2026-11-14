// Log de auditoria: so aceita inclusao. Nao existe funcao de update/delete aqui de proposito.

export function registrarEvento(db, { solicitacao, statusDe, statusPara, motivo, regraUsada, ator }) {
  db.prepare(`
    INSERT INTO eventos (solicitacao, status_de, status_para, motivo, regra_usada, ator, horario)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(solicitacao, statusDe ?? null, statusPara, motivo ?? null, regraUsada ?? null, ator, new Date().toISOString());
}

export function buscarLinhaDoTempo(db, solicitacaoId) {
  return db.prepare('SELECT * FROM eventos WHERE solicitacao = ? ORDER BY id ASC').all(solicitacaoId);
}
