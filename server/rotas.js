// Rotas públicas da API. Toda rota tem try/catch: o processo nunca cai.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarEvento, buscarLinhaDoTempo } from './eventos.js';
import { processarSolicitacao, processarFila, rodarCasosBasicos } from './motor.js';
import { abrirBanco, seedBanco, reiniciarSolicitacao } from './banco.js';
import { definirModo, obterModo, MODOS_VALIDOS, CONVENIOS_CONHECIDOS } from './apiSimulada.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Caminho fixo, dentro de ./kit. Nunca é montado com valor vindo do usuário (sem path traversal).
const CAMINHO_DOCUMENTO_MOCK = join(__dirname, '..', 'kit', 'docs', 'documento_mock.txt');

// Schema de params: o id da solicitação só aceita o formato dos identificadores do kit.
// Validação server-side acontece antes do handler; o front não é a defesa.
const SCHEMA_ID_SOLICITACAO = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', pattern: '^DEMO-R[0-9]{1,4}$' },
    },
  },
};

const SCHEMA_MODO_CONVENIO = {
  params: {
    type: 'object',
    required: ['convenio'],
    properties: {
      convenio: { type: 'string', enum: [...CONVENIOS_CONHECIDOS] },
    },
  },
  body: {
    type: 'object',
    required: ['modo'],
    additionalProperties: false,
    properties: {
      modo: { type: 'string', enum: [...MODOS_VALIDOS] },
    },
  },
};

// Resposta de erro única: mensagem estável pro cliente, detalhe técnico só no log do servidor.
// Só vaza o detalhe se DETALHAR_ERROS=1 estiver ligado explicitamente (uso local de depuração).
function responderErro(reply, codigo, mensagem, erro) {
  console.error(`[erro] ${mensagem}:`, erro?.message ?? erro);
  reply.code(codigo);
  const corpo = { erro: mensagem };
  if (process.env.DETALHAR_ERROS === '1' && erro?.message) corpo.detalhe = erro.message;
  return corpo;
}

export function registrarRotasPublicas(fastify, db) {
  // Dados de usuário nunca vão pra cache de CDN/edge, e nada de sniffing de content-type.
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
  });

  fastify.get('/api/saude', async (request, reply) => {
    try {
      const convenios = db.prepare('SELECT id, nome, status_integracao, disjuntor, falhas_seguidas FROM convenios ORDER BY id').all();
      return { status: 'ok', hora: new Date().toISOString(), convenios };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar a saúde', erro);
    }
  });

  fastify.get('/api/fila', async (request, reply) => {
    try {
      return db.prepare('SELECT * FROM solicitacoes ORDER BY id').all();
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar a fila', erro);
    }
  });

  // Reseta todas as solicitações para 'recebida' e processa a fila em paralelo por convênio.
  fastify.post('/api/fila/iniciar', async (request, reply) => {
    try {
      const ids = db.prepare('SELECT id FROM solicitacoes').all().map((linha) => linha.id);
      ids.forEach((id) => reiniciarSolicitacao(db, id));
      await processarFila(db, ids);
      const fila = db.prepare('SELECT * FROM solicitacoes ORDER BY id').all();
      return { processadas: ids.length, fila };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao iniciar a fila', erro);
    }
  });

  fastify.get('/api/solicitacoes/:id/linha-do-tempo', { schema: SCHEMA_ID_SOLICITACAO }, async (request, reply) => {
    try {
      const { id } = request.params;
      const solicitacao = db.prepare('SELECT id FROM solicitacoes WHERE id = ?').get(id);
      if (!solicitacao) {
        reply.code(404);
        return { erro: 'solicitação não encontrada' };
      }
      return buscarLinhaDoTempo(db, id);
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar a linha do tempo', erro);
    }
  });

  // Anexa o documento fictício do kit (caminho fixo no servidor) e reprocessa a solicitação.
  fastify.post('/api/solicitacoes/:id/documentos', { schema: SCHEMA_ID_SOLICITACAO }, async (request, reply) => {
    try {
      const { id } = request.params;
      const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id);
      if (!solicitacao) {
        reply.code(404);
        return { erro: 'solicitação não encontrada' };
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
      return responderErro(reply, 500, 'falha ao anexar documento', erro);
    }
  });

  fastify.get('/api/tarefas', async (request, reply) => {
    try {
      return db.prepare('SELECT * FROM tarefas_humanas ORDER BY id').all();
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar as tarefas', erro);
    }
  });

  // Troca o modo da API simulada de um convênio: é o botão "derrubar Jardim" da demo.
  // Convênio e modo validados por enum; nada além dos valores conhecidos entra aqui.
  fastify.post('/api/convenios/:convenio/modo', { schema: SCHEMA_MODO_CONVENIO }, async (request, reply) => {
    try {
      const { convenio } = request.params;
      const { modo } = request.body;
      definirModo(convenio, modo);
      return { convenio, modo: obterModo(convenio) };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao trocar o modo do convênio', erro);
    }
  });

  // Roda os 4 casos do kit num banco em memória: não encosta no banco da demo.
  fastify.post('/api/testes/rodar', async (request, reply) => {
    let dbTeste;
    try {
      dbTeste = abrirBanco(':memory:');
      seedBanco(dbTeste);
      return await rodarCasosBasicos(dbTeste);
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao rodar os testes', erro);
    } finally {
      dbTeste?.close();
    }
  });
}
