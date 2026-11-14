// Motor de decisao: regra fixa por convenio, chamada real por HTTP a API simulada, trava de autorizacao.
import { registrarEvento } from './eventos.js';
import { definirModo, resetarModos } from './apiSimulada.js';
import { reiniciarSolicitacao } from './banco.js';

function obterUrlMock() {
  if (process.env.MOCK_URL) return process.env.MOCK_URL;
  const porta = process.env.PORT || 3000;
  return `http://127.0.0.1:${porta}/mock`;
}

// Chamada real por HTTP, com timeout por AbortController e medicao de latencia.
async function chamarApiSimulada(convenioId, { solicitacaoId, procedimento, temDocumento }, tempoLimiteMs) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tempoLimiteMs);
  const inicio = Date.now();
  try {
    const resposta = await fetch(`${obterUrlMock()}/${convenioId}/autorizar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ solicitacao: solicitacaoId, procedimento, tem_documento: temDocumento }),
      signal: controlador.signal,
    });
    const latenciaMs = Date.now() - inicio;
    if (!resposta.ok) {
      return { falhaIntegracao: true, latenciaMs, erro: `http_${resposta.status}` };
    }
    const corpo = await resposta.json();
    return { falhaIntegracao: false, latenciaMs, corpo };
  } catch (erro) {
    const latenciaMs = Date.now() - inicio;
    const motivo = erro.name === 'AbortError' ? 'timeout' : 'erro_de_rede';
    return { falhaIntegracao: true, latenciaMs, erro: motivo };
  } finally {
    clearTimeout(temporizador);
  }
}

function buscarConvenio(db, convenioId) {
  return db.prepare('SELECT * FROM convenios WHERE id = ?').get(convenioId);
}

function buscarRegra(db, convenioId) {
  return db.prepare('SELECT * FROM regras WHERE convenio = ?').get(convenioId);
}

function temDocumentoAnexado(db, solicitacaoId) {
  return Boolean(db.prepare('SELECT 1 FROM documentos WHERE solicitacao = ? LIMIT 1').get(solicitacaoId));
}

function criarTarefaHumana(db, solicitacaoId, motivo) {
  db.prepare(`
    INSERT INTO tarefas_humanas (solicitacao, motivo, texto_ia, prioridade, responsavel, prazo, status)
    VALUES (?, ?, NULL, 'normal', NULL, NULL, 'aberta')
  `).run(solicitacaoId, motivo);
}

// Muda o status, grava os campos e registra o evento correspondente. Muta o objeto local
// de solicitacao para manter o status_de correto entre chamadas sequenciais.
function transicionar(db, solicitacao, novoStatus, { motivo, regraUsada, numeroAutorizacao, latenciaMs } = {}) {
  const statusAnterior = solicitacao.status;
  const campos = { status: novoStatus };
  if (motivo !== undefined) campos.motivo = motivo;
  if (regraUsada !== undefined) campos.regra_usada = regraUsada;
  if (numeroAutorizacao !== undefined) campos.numero_autorizacao = numeroAutorizacao;
  if (latenciaMs !== undefined) campos.latencia_ms = latenciaMs;
  if (['autorizada', 'pendente_documento', 'erro_integracao', 'tarefa_humana'].includes(novoStatus)) {
    campos.respondido_em = new Date().toISOString();
  }

  const colunas = Object.keys(campos);
  const atribuicoes = colunas.map((coluna) => `${coluna} = ?`).join(', ');
  db.prepare(`UPDATE solicitacoes SET ${atribuicoes} WHERE id = ?`).run(...colunas.map((c) => campos[c]), solicitacao.id);

  registrarEvento(db, {
    solicitacao: solicitacao.id,
    statusDe: statusAnterior,
    statusPara: novoStatus,
    motivo: campos.motivo ?? motivo,
    regraUsada: campos.regra_usada ?? regraUsada,
    ator: 'sistema',
  });

  Object.assign(solicitacao, campos);
}

// Processa uma solicitacao: decide pela regra do convenio e chama a API simulada de verdade.
export async function processarSolicitacao(db, solicitacaoId) {
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(solicitacaoId);
  if (!solicitacao) return;

  const convenioInfo = buscarConvenio(db, solicitacao.convenio);

  if (!convenioInfo) {
    const regraForaDaBase = buscarRegra(db, 'fora_da_base');
    const fonte = regraForaDaBase ? `${regraForaDaBase.fonte}-v${regraForaDaBase.versao}` : 'REGRAS-DEMO-v1';
    const motivo = `fora da base: convenio "${solicitacao.convenio}" nao cadastrado (regra fora_da_base, ${fonte}), encaminhado para humano`;
    transicionar(db, solicitacao, 'em_analise', { motivo: 'convenio nao cadastrado na base', regraUsada: fonte });
    transicionar(db, solicitacao, 'tarefa_humana', { motivo, regraUsada: fonte });
    criarTarefaHumana(db, solicitacao.id, motivo);
    return;
  }

  const regra = buscarRegra(db, convenioInfo.id);
  const fonte = `${regra.fonte}-v${regra.versao}`;
  const procedimentoDivergente = regra.procedimento !== 'qualquer'
    && solicitacao.procedimento
    && regra.procedimento !== solicitacao.procedimento;
  const sufixo = procedimentoDivergente ? ' atencao: procedimento fora da regra explicita' : '';

  transicionar(db, solicitacao, 'em_analise', {
    motivo: `enviando para API simulada de ${convenioInfo.nome} (${fonte})${sufixo}`,
    regraUsada: fonte,
  });

  const temDocumento = regra.acao === 'pedir_documento' ? temDocumentoAnexado(db, solicitacao.id) : false;
  db.prepare('UPDATE solicitacoes SET tentativas = tentativas + 1 WHERE id = ?').run(solicitacao.id);

  const resultado = await chamarApiSimulada(
    convenioInfo.id,
    { solicitacaoId: solicitacao.id, procedimento: solicitacao.procedimento, temDocumento },
    convenioInfo.tempo_limite_ms,
  );

  if (resultado.falhaIntegracao) {
    transicionar(db, solicitacao, 'erro_integracao', {
      motivo: `falha de integracao com ${convenioInfo.nome}: ${resultado.erro}${sufixo}`,
      regraUsada: fonte,
      latenciaMs: resultado.latenciaMs,
    });
    const motivoHumano = `encaminhado para humano: ${convenioInfo.nome} indisponivel (${resultado.erro}), sem inventar autorizacao`;
    transicionar(db, solicitacao, 'tarefa_humana', { motivo: motivoHumano, regraUsada: fonte });
    criarTarefaHumana(db, solicitacao.id, motivoHumano);
    return;
  }

  const corpo = resultado.corpo ?? {};

  if (corpo.status === 'autorizado') {
    const numero = (corpo.numero_autorizacao ?? '').trim();
    if (numero) {
      transicionar(db, solicitacao, 'autorizada', {
        motivo: `autorizado por ${convenioInfo.nome} conforme ${fonte}${sufixo}`,
        regraUsada: fonte,
        numeroAutorizacao: numero,
        latenciaMs: resultado.latenciaMs,
      });
      return;
    }
    const motivoSemNumero = 'resposta sem numero de autorizacao';
    transicionar(db, solicitacao, 'tarefa_humana', { motivo: motivoSemNumero, regraUsada: fonte, latenciaMs: resultado.latenciaMs });
    criarTarefaHumana(db, solicitacao.id, motivoSemNumero);
    return;
  }

  if (corpo.status === 'pendente_documento') {
    transicionar(db, solicitacao, 'pendente_documento', {
      motivo: `pendente: ${convenioInfo.nome} exige documento, ${fonte}${sufixo}`,
      regraUsada: fonte,
      latenciaMs: resultado.latenciaMs,
    });
    return;
  }

  const motivoInesperado = `resposta inesperada de ${convenioInfo.nome}: "${corpo.status}"`;
  transicionar(db, solicitacao, 'tarefa_humana', { motivo: motivoInesperado, regraUsada: fonte, latenciaMs: resultado.latenciaMs });
  criarTarefaHumana(db, solicitacao.id, motivoInesperado);
}

// Processa varias solicitacoes em paralelo (uma fila presa num convenio nao trava as outras).
export function processarFila(db, ids) {
  return Promise.allSettled(ids.map((id) => processarSolicitacao(db, id)));
}

// Cada caso abaixo corresponde a uma linha de kit/scenarios/03-casos.md.
// Retornam {passou, solicitacao} pra servir tanto o node:test quanto o /api/testes/rodar.

export async function casoAuroraAutoriza(db) {
  await processarSolicitacao(db, 'DEMO-R1');
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R1');
  return { passou: solicitacao.status === 'autorizada' && solicitacao.numero_autorizacao === 'DEMO-AUTH-1', solicitacao };
}

export async function casoHorizonteSemDocumentoFicaPendente(db) {
  await processarSolicitacao(db, 'DEMO-R2');
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R2');
  return { passou: solicitacao.status === 'pendente_documento', solicitacao };
}

export async function casoJardimIndisponivelCriaTarefa(db) {
  await processarSolicitacao(db, 'DEMO-R3');
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R3');
  const tarefa = db.prepare('SELECT 1 FROM tarefas_humanas WHERE solicitacao = ?').get('DEMO-R3');
  return { passou: solicitacao.status === 'tarefa_humana' && Boolean(tarefa), solicitacao };
}

export async function casoSemNumeroNaoAutoriza(db) {
  reiniciarSolicitacao(db, 'DEMO-R1');
  definirModo('aurora', 'sem_numero');
  await processarSolicitacao(db, 'DEMO-R1');
  definirModo('aurora', 'normal');
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R1');
  const tarefa = db.prepare('SELECT 1 FROM tarefas_humanas WHERE solicitacao = ?').get('DEMO-R1');
  return { passou: solicitacao.status === 'tarefa_humana' && Boolean(tarefa), solicitacao };
}

// Roda os 4 casos do kit num banco ja seedado. Usado por POST /api/testes/rodar.
export async function rodarCasosBasicos(db) {
  resetarModos();
  const casos = [
    ['Aurora Demo: retorna autorizacao DEMO', casoAuroraAutoriza],
    ['Horizonte Demo sem documento: mantem pendencia', casoHorizonteSemDocumentoFicaPendente],
    ['Jardim Demo indisponivel: cria tarefa humana', casoJardimIndisponivelCriaTarefa],
    ['Resposta sem numero de autorizacao: nao marca autorizado', casoSemNumeroNaoAutoriza],
  ];
  const detalhes = [];
  for (const [nome, executar] of casos) {
    const resultado = await executar(db);
    detalhes.push({ caso: nome, passou: resultado.passou });
  }
  const passaram = detalhes.filter((d) => d.passou).length;
  return { passaram, total: detalhes.length, detalhes };
}
