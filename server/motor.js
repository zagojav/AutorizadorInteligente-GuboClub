// Motor de decisão: regra fixa por convênio, chamada real por HTTP à API simulada,
// retentativa com espera crescente, disjuntor por convênio e trava de autorização.
import { registrarEvento } from './eventos.js';
import { reiniciarSolicitacao } from './banco.js';
import { avaliarAntesDaChamada, registrarFalha, registrarSucesso } from './disjuntor.js';
import { publicar } from './barramento.js';

// Colunas que uma transição pode escrever. Allowlist explícita: o UPDATE é montado só com
// nomes daqui, nunca com texto vindo de fora. Valores sempre por placeholder.
const COLUNAS_DE_TRANSICAO = new Set([
  'status',
  'motivo',
  'regra_usada',
  'numero_autorizacao',
  'latencia_ms',
  'respondido_em',
]);

const STATUS_FINAIS = new Set(['autorizada', 'pendente_documento', 'erro_integracao', 'tarefa_humana']);

// Espera crescente entre as tentativas. Os testes encurtam por variável de ambiente.
function esperasDeRetentativa() {
  const configurado = process.env.ESPERAS_RETENTATIVA_MS;
  const lista = (configurado ?? '200,400,800').split(',').map(Number).filter((valor) => Number.isFinite(valor) && valor >= 0);
  return lista.length > 0 ? lista : [200, 400, 800];
}

const MAXIMO_DE_TENTATIVAS = 3;

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function obterUrlMock() {
  if (process.env.MOCK_URL) return process.env.MOCK_URL;
  const porta = process.env.PORT || 3000;
  return `http://127.0.0.1:${porta}/mock`;
}

// Texto legível do erro, pro motivo da tarefa humana ("HTTP 503", "timeout"...).
function descreverErro(erro) {
  if (erro?.startsWith('http_')) return `HTTP ${erro.replace('http_', '')}`;
  if (erro === 'timeout') return 'timeout';
  return 'erro de rede';
}

// Chamada real por HTTP, com timeout por AbortController e medição de latência.
async function chamarApiSimulada(convenioId, { solicitacaoId, procedimento, temDocumento, modoSimulado }, tempoLimiteMs) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tempoLimiteMs);
  const inicio = Date.now();
  try {
    const resposta = await fetch(`${obterUrlMock()}/${convenioId}/autorizar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        solicitacao: solicitacaoId,
        procedimento,
        tem_documento: temDocumento,
        ...(modoSimulado ? { modo_simulado: modoSimulado } : {}),
      }),
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

// Uma linha por chamada à API simulada: é daqui que saem p50 e p95 das métricas.
function registrarChamada(db, { convenio, solicitacao, latenciaMs, sucesso }) {
  db.prepare(`
    INSERT INTO chamadas (convenio, solicitacao, latencia_ms, sucesso, horario)
    VALUES (?, ?, ?, ?, ?)
  `).run(convenio, solicitacao, latenciaMs, sucesso ? 1 : 0, new Date().toISOString());
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

// Texto de encaminhamento montado por template local (não é chamada de LLM) e prazo de 2 h,
// pra quem pega a tarefa saber o que fazer sem abrir a linha do tempo.
function criarTarefaHumana(db, solicitacaoId, motivo, prioridade = 'normal') {
  const prazo = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const textoSugerido = `Solicitação ${solicitacaoId}: ${motivo}. Conferir no portal do convênio e responder manualmente. Não emitir autorização sem número devolvido pelo convênio.`;
  const resultado = db.prepare(`
    INSERT INTO tarefas_humanas (solicitacao, motivo, texto_ia, prioridade, responsavel, prazo, status)
    VALUES (?, ?, ?, ?, NULL, ?, 'aberta')
  `).run(solicitacaoId, motivo, textoSugerido, prioridade, prazo);

  publicar('tarefa_criada', {
    id: resultado.lastInsertRowid,
    solicitacao: solicitacaoId,
    motivo,
    prioridade,
    prazo,
  });
}

// Muda o status, grava os campos e registra o evento correspondente. Muta o objeto local
// de solicitação para manter o status_de correto entre chamadas sequenciais.
function transicionar(db, solicitacao, novoStatus, { motivo, regraUsada, numeroAutorizacao, latenciaMs } = {}) {
  const statusAnterior = solicitacao.status;
  const campos = { status: novoStatus };
  if (motivo !== undefined) campos.motivo = motivo;
  if (regraUsada !== undefined) campos.regra_usada = regraUsada;
  if (numeroAutorizacao !== undefined) campos.numero_autorizacao = numeroAutorizacao;
  if (latenciaMs !== undefined) campos.latencia_ms = latenciaMs;
  if (STATUS_FINAIS.has(novoStatus)) campos.respondido_em = new Date().toISOString();

  const colunas = Object.keys(campos).filter((coluna) => COLUNAS_DE_TRANSICAO.has(coluna));
  const atribuicoes = colunas.map((coluna) => `${coluna} = ?`).join(', ');
  db.prepare(`UPDATE solicitacoes SET ${atribuicoes} WHERE id = ?`)
    .run(...colunas.map((coluna) => campos[coluna]), solicitacao.id);

  registrarEvento(db, {
    solicitacao: solicitacao.id,
    statusDe: statusAnterior,
    statusPara: novoStatus,
    motivo: campos.motivo,
    regraUsada: campos.regra_usada,
    ator: 'sistema',
  });

  Object.assign(solicitacao, campos);

  publicar('solicitacao_atualizada', {
    id: solicitacao.id,
    convenio: solicitacao.convenio,
    status: novoStatus,
    status_de: statusAnterior,
    motivo: campos.motivo ?? null,
    regra_usada: campos.regra_usada ?? null,
    numero_autorizacao: solicitacao.numero_autorizacao ?? null,
    latencia_ms: campos.latencia_ms ?? null,
  });
}

// Anota a tentativa que falhou sem mudar o status: a solicitação continua em análise.
function anotarTentativa(db, solicitacao, motivo) {
  registrarEvento(db, {
    solicitacao: solicitacao.id,
    statusDe: solicitacao.status,
    statusPara: solicitacao.status,
    motivo,
    regraUsada: solicitacao.regra_usada ?? null,
    ator: 'sistema',
  });
  publicar('solicitacao_atualizada', {
    id: solicitacao.id,
    convenio: solicitacao.convenio,
    status: solicitacao.status,
    status_de: solicitacao.status,
    motivo,
    regra_usada: solicitacao.regra_usada ?? null,
    numero_autorizacao: null,
    latencia_ms: null,
  });
}

// Chama a API simulada com retentativa e espera crescente (200, 400, 800 ms).
// No meio_aberto é uma única chamada de teste, sem retentativa.
async function chamarComRetentativa(db, solicitacao, convenioInfo, { temDocumento, estadoDisjuntor, modoSimulado }) {
  const esperas = esperasDeRetentativa();
  const maximo = estadoDisjuntor === 'meio_aberto' ? 1 : MAXIMO_DE_TENTATIVAS;
  let ultimoResultado = null;

  for (let tentativa = 1; tentativa <= maximo; tentativa += 1) {
    db.prepare('UPDATE solicitacoes SET tentativas = ? WHERE id = ?').run(tentativa, solicitacao.id);

    const resultado = await chamarApiSimulada(
      convenioInfo.id,
      { solicitacaoId: solicitacao.id, procedimento: solicitacao.procedimento, temDocumento, modoSimulado },
      convenioInfo.tempo_limite_ms,
    );
    registrarChamada(db, {
      convenio: convenioInfo.id,
      solicitacao: solicitacao.id,
      latenciaMs: resultado.latenciaMs,
      sucesso: !resultado.falhaIntegracao,
    });
    ultimoResultado = { ...resultado, tentativas: tentativa };

    if (!resultado.falhaIntegracao) {
      registrarSucesso(db, convenioInfo.id);
      return ultimoResultado;
    }

    const { estado } = registrarFalha(db, convenioInfo.id);
    const erroLegivel = descreverErro(resultado.erro);
    const espera = esperas[tentativa - 1] ?? esperas[esperas.length - 1];
    const aindaTentaDeNovo = tentativa < maximo && estado !== 'aberto';

    anotarTentativa(db, solicitacao, aindaTentaDeNovo
      ? `tentativa ${tentativa} de ${maximo} falhou (${erroLegivel}), nova tentativa em ${espera} ms`
      : `tentativa ${tentativa} de ${maximo} falhou (${erroLegivel})`);

    // Se o disjuntor abriu no meio da sequência, para de insistir: é exatamente o papel dele.
    if (!aindaTentaDeNovo) break;
    await aguardar(espera);
  }

  return ultimoResultado;
}

// Processa uma solicitação: decide pela regra do convênio e chama a API simulada de verdade.
export async function processarSolicitacao(db, solicitacaoId, { modoSimulado } = {}) {
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(solicitacaoId);
  if (!solicitacao) return;

  const convenioInfo = buscarConvenio(db, solicitacao.convenio);

  // Convênio sem entrada na base: regra fora_da_base manda direto pra equipe humana.
  if (!convenioInfo) {
    const regraForaDaBase = buscarRegra(db, 'fora_da_base');
    const fonte = regraForaDaBase?.fonte ?? 'REGRAS-DEMO-v1';
    const motivo = `fora da base: convênio "${solicitacao.convenio}" não cadastrado (regra fora_da_base, ${fonte}), encaminhado para humano`;
    transicionar(db, solicitacao, 'em_analise', { motivo: 'convênio não cadastrado na base', regraUsada: fonte });
    transicionar(db, solicitacao, 'tarefa_humana', { motivo, regraUsada: fonte });
    criarTarefaHumana(db, solicitacao.id, motivo, 'alta');
    return;
  }

  const regra = buscarRegra(db, convenioInfo.id);
  const fonte = regra.fonte;

  // A decisão é sempre a da regra do CONVÊNIO. Procedimento diferente do da regra só vira
  // observação no motivo (o auditor trata depois), nunca muda a decisão.
  const procedimentoDivergente = regra.procedimento !== 'qualquer'
    && Boolean(solicitacao.procedimento)
    && regra.procedimento !== solicitacao.procedimento;
  const sufixo = procedimentoDivergente ? ', atenção: procedimento fora da regra explícita' : '';

  transicionar(db, solicitacao, 'em_analise', {
    motivo: `enviando para API simulada de ${convenioInfo.nome} (${fonte})${sufixo}`,
    regraUsada: fonte,
  });

  // Disjuntor aberto: nem chama a API. Vai direto pra tarefa humana.
  const portao = avaliarAntesDaChamada(db, convenioInfo.id);
  if (!portao.permitido) {
    const motivo = `${portao.motivo}, encaminhado para humano sem chamar a API${sufixo}`;
    transicionar(db, solicitacao, 'tarefa_humana', { motivo, regraUsada: fonte });
    criarTarefaHumana(db, solicitacao.id, motivo, 'alta');
    return;
  }

  const temDocumento = regra.acao === 'pedir_documento' ? temDocumentoAnexado(db, solicitacao.id) : false;

  const resultado = await chamarComRetentativa(db, solicitacao, convenioInfo, {
    temDocumento,
    estadoDisjuntor: portao.estado,
    modoSimulado,
  });

  // Falha de integração depois de esgotar as tentativas: erro_integracao e tarefa humana.
  // Nunca inventa autorização.
  if (resultado.falhaIntegracao) {
    const erroLegivel = descreverErro(resultado.erro);
    transicionar(db, solicitacao, 'erro_integracao', {
      motivo: `falha de integração com ${convenioInfo.nome}: ${erroLegivel}${sufixo}`,
      regraUsada: fonte,
      latenciaMs: resultado.latenciaMs,
    });
    const motivoHumano = `${convenioInfo.nome} fora do ar após ${resultado.tentativas} tentativas (${erroLegivel}), sem inventar autorização`;
    transicionar(db, solicitacao, 'tarefa_humana', { motivo: motivoHumano, regraUsada: fonte });
    criarTarefaHumana(db, solicitacao.id, motivoHumano, 'alta');
    return;
  }

  const corpo = resultado.corpo ?? {};

  if (corpo.status === 'autorizado') {
    const numero = String(corpo.numero_autorizacao ?? '').trim();
    // TRAVA: só vira autorizada com número preenchido. Sem número, vai pra humano.
    if (numero) {
      transicionar(db, solicitacao, 'autorizada', {
        motivo: `autorizado por ${convenioInfo.nome} conforme ${fonte}${sufixo}`,
        regraUsada: fonte,
        numeroAutorizacao: numero,
        latenciaMs: resultado.latenciaMs,
      });
      return;
    }
    const motivoSemNumero = 'resposta sem número de autorização';
    transicionar(db, solicitacao, 'tarefa_humana', {
      motivo: motivoSemNumero,
      regraUsada: fonte,
      latenciaMs: resultado.latenciaMs,
    });
    criarTarefaHumana(db, solicitacao.id, motivoSemNumero, 'alta');
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
  transicionar(db, solicitacao, 'tarefa_humana', {
    motivo: motivoInesperado,
    regraUsada: fonte,
    latenciaMs: resultado.latenciaMs,
  });
  criarTarefaHumana(db, solicitacao.id, motivoInesperado, 'alta');
}

// Processa várias solicitações em paralelo (uma fila presa num convênio não trava as outras).
// A fila isolada por convênio está em filas.js; esta função serve os casos e os testes.
export function processarFila(db, ids) {
  return Promise.allSettled(ids.map((id) => processarSolicitacao(db, id)));
}

// Cada caso abaixo corresponde a uma linha de kit/scenarios/03-casos.md.
// Retornam {passou, solicitacao} pra servir tanto o node:test quanto o /api/testes/rodar.

// Os casos forcam o modo da propria chamada ('normal' / 'sem_numero'), em vez de mexer no
// modo global do convenio: rodar os casos nao muda o comportamento da demo ao vivo.
export async function casoAuroraAutoriza(db) {
  await processarSolicitacao(db, 'DEMO-R1', { modoSimulado: 'normal' });
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R1');
  return { passou: solicitacao.status === 'autorizada' && solicitacao.numero_autorizacao === 'DEMO-AUTH-1', solicitacao };
}

export async function casoHorizonteSemDocumentoFicaPendente(db) {
  await processarSolicitacao(db, 'DEMO-R2', { modoSimulado: 'normal' });
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R2');
  return { passou: solicitacao.status === 'pendente_documento', solicitacao };
}

export async function casoJardimIndisponivelCriaTarefa(db) {
  await processarSolicitacao(db, 'DEMO-R3', { modoSimulado: 'normal' });
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R3');
  const tarefa = db.prepare('SELECT 1 FROM tarefas_humanas WHERE solicitacao = ?').get('DEMO-R3');
  return { passou: solicitacao.status === 'tarefa_humana' && Boolean(tarefa), solicitacao };
}

export async function casoSemNumeroNaoAutoriza(db) {
  reiniciarSolicitacao(db, 'DEMO-R1');
  await processarSolicitacao(db, 'DEMO-R1', { modoSimulado: 'sem_numero' });
  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R1');
  const tarefa = db.prepare('SELECT 1 FROM tarefas_humanas WHERE solicitacao = ?').get('DEMO-R1');
  const naoInventouNumero = !solicitacao.numero_autorizacao;
  return {
    passou: solicitacao.status === 'tarefa_humana' && Boolean(tarefa) && naoInventouNumero,
    solicitacao,
  };
}

// Roda os 4 casos do kit num banco já seedado. Usado por POST /api/testes/rodar.
// Hermético: cada caso força o modo da sua própria chamada, então rodar os testes no meio
// da demo não mexe no que o apresentador configurou (Jardim derrubado continua derrubado).
export async function rodarCasosBasicos(db) {
  const casos = [
    ['Aurora Demo: retorna autorização DEMO', casoAuroraAutoriza],
    ['Horizonte Demo sem documento: mantém pendência', casoHorizonteSemDocumentoFicaPendente],
    ['Jardim Demo indisponível: cria tarefa humana', casoJardimIndisponivelCriaTarefa],
    ['Resposta sem número de autorização: não marca autorizado', casoSemNumeroNaoAutoriza],
  ];
  const detalhes = [];
  for (const [nome, executar] of casos) {
    const resultado = await executar(db);
    detalhes.push({ caso: nome, passou: resultado.passou, status: resultado.solicitacao?.status ?? null });
  }
  const passaram = detalhes.filter((detalhe) => detalhe.passou).length;
  return { passaram, total: detalhes.length, detalhes };
}
