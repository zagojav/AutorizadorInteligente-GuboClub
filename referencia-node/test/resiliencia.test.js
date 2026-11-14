// Retentativa com espera crescente e disjuntor por convênio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registrarRotasMockAutorizacao, resetarModos, definirModo } from '../server/apiSimulada.js';
import { abrirBanco, seedBanco, criarSolicitacoesSinteticas } from '../server/banco.js';
import { processarSolicitacao } from '../server/motor.js';

process.env.MOCK_LATENCIA_MS = '5';
process.env.ESPERAS_RETENTATIVA_MS = '5,5,5';
// Sem espera pra virar meio_aberto: o teste não vai ficar 15 s parado.
process.env.DISJUNTOR_ESPERA_MS = '0';

let fastifyMock;
let db;

test.before(async () => {
  fastifyMock = Fastify({ logger: false });
  registrarRotasMockAutorizacao(fastifyMock);
  const endereco = await fastifyMock.listen({ port: 0, host: '127.0.0.1' });
  process.env.MOCK_URL = `${endereco}/mock`;
});

test.after(async () => {
  await fastifyMock.close();
});

test.beforeEach(() => {
  db = abrirBanco(':memory:');
  seedBanco(db);
  resetarModos();
});

test.afterEach(() => {
  db.close();
});

function contarChamadas(convenio) {
  return db.prepare('SELECT COUNT(*) AS total FROM chamadas WHERE convenio = ?').get(convenio).total;
}

test('Retentativa - Jardim falha 3 vezes, grava tentativas e abre o disjuntor', async () => {
  await processarSolicitacao(db, 'DEMO-R3');

  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R3');
  assert.equal(solicitacao.tentativas, 3);
  assert.equal(solicitacao.status, 'tarefa_humana');
  assert.match(solicitacao.motivo, /ap[óo]s 3 tentativas \(HTTP 503\)/i);
  assert.equal(solicitacao.numero_autorizacao, null);
  assert.equal(contarChamadas('jardim'), 3);

  const tarefa = db.prepare('SELECT * FROM tarefas_humanas WHERE solicitacao = ?').get('DEMO-R3');
  assert.equal(tarefa.prioridade, 'alta');
  assert.ok(tarefa.prazo);

  const convenio = db.prepare("SELECT * FROM convenios WHERE id = 'jardim'").get();
  assert.equal(convenio.disjuntor, 'aberto');
  assert.equal(convenio.falhas_seguidas, 3);

  // A tentativa que falhou tem evento proprio na linha do tempo.
  const eventos = db.prepare('SELECT motivo FROM eventos WHERE solicitacao = ?').all('DEMO-R3');
  assert.ok(eventos.some((evento) => /tentativa 1 de 3 falhou/.test(evento.motivo ?? '')));
});

test('Disjuntor aberto - proxima solicitacao nao chega na API e vira tarefa humana', async () => {
  // Deixa o disjuntor do Jardim aberto, sem esperar o tempo de meio_aberto.
  process.env.DISJUNTOR_ESPERA_MS = '60000';
  try {
    await processarSolicitacao(db, 'DEMO-R3');
    assert.equal(db.prepare("SELECT disjuntor FROM convenios WHERE id = 'jardim'").get().disjuntor, 'aberto');

    const chamadasAntes = contarChamadas('jardim');
    const sinteticas = criarSolicitacoesSinteticas(db, 1);
    const doJardim = sinteticas.find((item) => item.convenio === 'jardim');
    await processarSolicitacao(db, doJardim.id);

    const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(doJardim.id);
    assert.equal(solicitacao.status, 'tarefa_humana');
    assert.match(solicitacao.motivo, /disjuntor aberto: Jardim Demo indispon[íi]vel/i);
    assert.equal(solicitacao.numero_autorizacao, null);
    // Prova de que o disjuntor bloqueou: nenhuma chamada nova foi registrada.
    assert.equal(contarChamadas('jardim'), chamadasAntes);
  } finally {
    process.env.DISJUNTOR_ESPERA_MS = '0';
  }
});

test('Disjuntor meio_aberto - chamada de teste com sucesso fecha de novo', async () => {
  definirModo('aurora', 'caos');
  await processarSolicitacao(db, 'DEMO-R1');
  assert.equal(db.prepare("SELECT disjuntor FROM convenios WHERE id = 'aurora'").get().disjuntor, 'aberto');

  // Convenio volta ao normal: com a espera zerada, a proxima vira chamada de teste.
  resetarModos();
  const sinteticas = criarSolicitacoesSinteticas(db, 1);
  const daAurora = sinteticas.find((item) => item.convenio === 'aurora');
  await processarSolicitacao(db, daAurora.id);

  const convenio = db.prepare("SELECT * FROM convenios WHERE id = 'aurora'").get();
  assert.equal(convenio.disjuntor, 'fechado');
  assert.equal(convenio.falhas_seguidas, 0);
  assert.equal(convenio.status_integracao, 'ok');

  const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(daAurora.id);
  assert.equal(solicitacao.status, 'autorizada');
  assert.equal(solicitacao.numero_autorizacao, 'DEMO-AUTH-1');
  // Chamada de teste e uma so: nao retenta no meio_aberto.
  assert.equal(solicitacao.tentativas, 1);
});

test('Fila isolada - Jardim caindo nao impede Aurora e Horizonte de responderem', async () => {
  const { GerenciadorDeFilas } = await import('../server/filas.js');
  const filas = new GerenciadorDeFilas(db);
  filas.enfileirar(['DEMO-R1', 'DEMO-R2', 'DEMO-R3']);
  await filas.aguardarConclusao();

  const porId = Object.fromEntries(
    db.prepare('SELECT id, status FROM solicitacoes').all().map((linha) => [linha.id, linha.status]),
  );
  assert.equal(porId['DEMO-R1'], 'autorizada');
  assert.equal(porId['DEMO-R2'], 'pendente_documento');
  assert.equal(porId['DEMO-R3'], 'tarefa_humana');
});
