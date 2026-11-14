// Os 4 casos do kit (scenarios/03-casos.md), um teste por caso, + 1 extra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registrarRotasMockAutorizacao, resetarModos } from '../server/apiSimulada.js';
import { abrirBanco, seedBanco } from '../server/banco.js';
import {
  processarSolicitacao,
  casoAuroraAutoriza,
  casoHorizonteSemDocumentoFicaPendente,
  casoJardimIndisponivelCriaTarefa,
  casoSemNumeroNaoAutoriza,
} from '../server/motor.js';

process.env.MOCK_LATENCIA_MS = '20';

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

test('Caso 1 - Aurora Demo: retorna autorizacao DEMO', async () => {
  const resultado = await casoAuroraAutoriza(db);
  assert.equal(resultado.passou, true);
  assert.equal(resultado.solicitacao.numero_autorizacao, 'DEMO-AUTH-1');
});

test('Caso 2 - Horizonte Demo sem documento: mantem pendencia', async () => {
  const resultado = await casoHorizonteSemDocumentoFicaPendente(db);
  assert.equal(resultado.passou, true);
  assert.equal(resultado.solicitacao.status, 'pendente_documento');
});

test('Caso 3 - Jardim Demo indisponivel: cria tarefa humana', async () => {
  const resultado = await casoJardimIndisponivelCriaTarefa(db);
  assert.equal(resultado.passou, true);
  assert.equal(resultado.solicitacao.status, 'tarefa_humana');
});

test('Caso 4 - resposta sem numero de autorizacao: nao marca autorizado', async () => {
  const resultado = await casoSemNumeroNaoAutoriza(db);
  assert.equal(resultado.passou, true);
  assert.notEqual(resultado.solicitacao.status, 'autorizada');
});

test('Extra - anexar documento no DEMO-R2 resolve para autorizada', async () => {
  await processarSolicitacao(db, 'DEMO-R2');
  let r2 = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R2');
  assert.equal(r2.status, 'pendente_documento');

  db.prepare(`
    INSERT INTO documentos (solicitacao, tipo, conteudo, recebido_em)
    VALUES ('DEMO-R2', 'documento_mock', 'conteudo fictício', ?)
  `).run(new Date().toISOString());

  await processarSolicitacao(db, 'DEMO-R2');
  r2 = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get('DEMO-R2');
  assert.equal(r2.status, 'autorizada');
  assert.equal(r2.numero_autorizacao, 'DEMO-AUTH-2-SIMULADO');
});
