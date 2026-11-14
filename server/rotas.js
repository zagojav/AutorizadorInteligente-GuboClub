// Rotas publicas da API. Toda rota tem try/catch: o processo nunca cai.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarEvento, buscarLinhaDoTempo } from './eventos.js';
import { processarSolicitacao, processarFila, rodarCasosBasicos } from './motor.js';
import { abrirBanco, seedBanco, reiniciarSolicitacao } from './banco.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMINHO_DOCUMENTO_MOCK = join(__dirname, '..', 'kit', 'docs', 'documento_mock.txt');

export function registrarRotasPublicas(fastify, db) {
  fastify.get('/api/saude', async () => {
    return { status: 'ok', hora: new Date().toISOString() };
  });

  fastify.get('/api/fila', async (request, reply) => {
    try {
      return db.prepare('SELECT * FROM solicitacoes ORDER BY id').all();
    } catch (erro) {
      reply.code(500);
      return { erro: 'falha ao consultar a fila', detalhe: erro.message };
    }
  });

  fastify.post('/api/fila/iniciar', async (request, reply) => {
    try {
      const ids = db.prepare('SELECT id FROM solicitacoes').all().map((linha) => linha.id);
      ids.forEach((id) => reiniciarSolicitacao(db, id));
      await processarFila(db, ids);
      const fila = db.prepare('SELECT * FROM solicitacoes ORDER BY id').all();
      return { processadas: ids.length, fila };
    } catch (erro) {
      reply.code(500);
      return { erro: 'falha ao iniciar a fila', detalhe: erro.message };
    }
  });

  fastify.get('/api/solicitacoes/:id/linha-do-tempo', async (request, reply) => {
    try {
      const { id } = request.params;
      const solicitacao = db.prepare('SELECT id FROM solicitacoes WHERE id = ?').get(id);
      if (!solicitacao) {
        reply.code(404);
        return { erro: `solicitacao ${id} nao encontrada` };
      }
      return buscarLinhaDoTempo(db, id);
    } catch (erro) {
      reply.code(500);
      return { erro: 'falha ao consultar a linha do tempo', detalhe: erro.message };
    }
  });

  fastify.post('/api/solicitacoes/:id/documentos', async (request, reply) => {
    try {
      const { id } = request.params;
      const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id);
      if (!solicitacao) {
        reply.code(404);
        return { erro: `solicitacao ${id} nao encontrada` };
      }

      const conteudo = readFileSync(CAMINHO_DOCUMENTO_MOCK, 'utf8');
      db.prepare(`
        INSERT INTO documentos (solicitacao, tipo, conteudo, recebido_em)
        VALUES (?, 'documento_mock', ?, ?)
      `).run(id, conteudo, new Date().toISOString());

      registrarEvento(db, {
        solicitacao: id,
        statusDe: solicitacao.status,
        statusPara: solicitacao.status,
        motivo: 'documento anexado pelo atendimento',
        regraUsada: solicitacao.regra_usada,
        ator: 'humano',
      });

      await processarSolicitacao(db, id);
      return db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id);
    } catch (erro) {
      reply.code(500);
      return { erro: 'falha ao anexar documento', detalhe: erro.message };
    }
  });

  fastify.get('/api/tarefas', async (request, reply) => {
    try {
      return db.prepare('SELECT * FROM tarefas_humanas ORDER BY id').all();
    } catch (erro) {
      reply.code(500);
      return { erro: 'falha ao consultar as tarefas', detalhe: erro.message };
    }
  });

  fastify.post('/api/testes/rodar', async (request, reply) => {
    let dbTeste;
    try {
      dbTeste = abrirBanco(':memory:');
      seedBanco(dbTeste);
      return await rodarCasosBasicos(dbTeste);
    } catch (erro) {
      reply.code(500);
      return { erro: 'falha ao rodar os testes', detalhe: erro.message };
    } finally {
      dbTeste?.close();
    }
  });
}
