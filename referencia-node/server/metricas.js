// Métricas da simulação. Todo número sai do banco (tabela chamadas e estado das
// solicitações): não existe valor fixo aqui. 'simulado: true' vai junto de propósito, pra
// ninguém confundir isso com resultado de atendimento real.

// Resultado dos 4 casos do kit, guardado por quem rodou (boot do servidor ou
// POST /api/testes/rodar). Rodar os casos é caro (sobe banco e bate na API), então as
// métricas leem o último resultado em vez de rodar de novo a cada consulta.
let ultimoResultadoDosCasos = null;

export function guardarResultadoDosCasos(resultado) {
  if (!resultado || typeof resultado.total !== 'number') return;
  ultimoResultadoDosCasos = { passaram: resultado.passaram, total: resultado.total, horario: new Date().toISOString() };
}

export function obterResultadoDosCasos() {
  return ultimoResultadoDosCasos;
}

// Percentil por posição (nearest-rank), sobre a lista já ordenada.
function percentil(ordenadas, porcentagem) {
  if (ordenadas.length === 0) return null;
  const posicao = Math.ceil((porcentagem / 100) * ordenadas.length) - 1;
  const indice = Math.min(Math.max(posicao, 0), ordenadas.length - 1);
  return ordenadas[indice];
}

function latenciasDe(db, convenio) {
  const linhas = convenio
    ? db.prepare('SELECT latencia_ms FROM chamadas WHERE convenio = ? ORDER BY latencia_ms ASC').all(convenio)
    : db.prepare('SELECT latencia_ms FROM chamadas ORDER BY latencia_ms ASC').all();
  return linhas.map((linha) => linha.latencia_ms);
}

// O kit diz qual era o resultado esperado de cada solicitação; aqui é a tradução daquele
// vocabulário para os estados do motor.
const STATUS_DO_KIT_PARA_ESTADO = Object.freeze({
  autorizado: 'autorizada',
  pendente_documento: 'pendente_documento',
  servico_indisponivel: 'tarefa_humana',
});

function contarEncaminhamentosCorretos(db) {
  const linhas = db.prepare(`
    SELECT id, status, status_esperado_kit
    FROM solicitacoes
    WHERE sintetica = 0 AND status_esperado_kit IS NOT NULL
    ORDER BY id
  `).all();

  const detalhe = linhas.map((linha) => ({
    id: linha.id,
    esperado: STATUS_DO_KIT_PARA_ESTADO[linha.status_esperado_kit] ?? null,
    obtido: linha.status,
    correto: STATUS_DO_KIT_PARA_ESTADO[linha.status_esperado_kit] === linha.status,
  }));

  return { corretos: detalhe.filter((item) => item.correto).length, total: detalhe.length, detalhe };
}

export function calcularMetricas(db) {
  const latencias = latenciasDe(db);
  const totalDeChamadas = latencias.length;
  const falhasDeChamada = db.prepare('SELECT COUNT(*) AS total FROM chamadas WHERE sucesso = 0').get().total;
  // Solicitações que o disjuntor barrou antes de chamar a API também são falha detectada.
  const bloqueiosDeDisjuntor = db.prepare(`
    SELECT COUNT(*) AS total FROM solicitacoes WHERE motivo LIKE 'disjuntor aberto:%'
  `).get().total;

  const convenios = db.prepare(`
    SELECT id, nome, status_integracao, disjuntor, falhas_seguidas
    FROM convenios ORDER BY id
  `).all();

  const porConvenio = {};
  for (const convenio of convenios) {
    const suas = latenciasDe(db, convenio.id);
    const falhas = db.prepare('SELECT COUNT(*) AS total FROM chamadas WHERE convenio = ? AND sucesso = 0').get(convenio.id).total;
    const tarefas = db.prepare(`
      SELECT COUNT(*) AS total FROM tarefas_humanas t
      JOIN solicitacoes s ON s.id = t.solicitacao
      WHERE s.convenio = ? AND t.status = 'aberta'
    `).get(convenio.id).total;

    porConvenio[convenio.id] = {
      nome: convenio.nome,
      status_integracao: convenio.status_integracao,
      disjuntor: convenio.disjuntor,
      falhas_seguidas: convenio.falhas_seguidas,
      chamadas: suas.length,
      falhas,
      latencia_p50_ms: percentil(suas, 50),
      latencia_p95_ms: percentil(suas, 95),
      tarefas_abertas: tarefas,
    };
  }

  const encaminhamentos = contarEncaminhamentosCorretos(db);
  const casos = obterResultadoDosCasos();
  const tarefasAbertas = db.prepare("SELECT COUNT(*) AS total FROM tarefas_humanas WHERE status = 'aberta'").get().total;

  return {
    simulado: true,
    falhas_detectadas: falhasDeChamada + bloqueiosDeDisjuntor,
    chamadas: totalDeChamadas,
    latencia_p50_ms: percentil(latencias, 50),
    latencia_p95_ms: percentil(latencias, 95),
    por_convenio: porConvenio,
    encaminhamentos_corretos: `${encaminhamentos.corretos}/${encaminhamentos.total}`,
    encaminhamentos_detalhe: encaminhamentos.detalhe,
    casos_kit: casos ? `${casos.passaram}/${casos.total}` : 'pendente',
    tarefas_abertas: tarefasAbertas,
  };
}
