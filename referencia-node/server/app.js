// Monta o Fastify com plugins, API simulada, rotas públicas e as filas por convênio.
// Fica separado do index.js pra que os testes possam subir o servidor inteiro na porta 0.
import Fastify from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarRotasMockAutorizacao } from './apiSimulada.js';
import { registrarRotasPublicas } from './rotas.js';
import { GerenciadorDeFilas } from './filas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PASTA_DO_FRONT = join(__dirname, '..', '..', 'web', 'dist');

// Origens liberadas em desenvolvimento: só o Vite local. Sem credenciais e sem '*'.
const ORIGENS_DE_DESENVOLVIMENTO = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export async function construirServidor({ db, logger = false } = {}) {
  // bodyLimit apertado: nenhuma rota recebe payload grande, então não aceita.
  const fastify = Fastify({ logger, bodyLimit: 64 * 1024 });

  // gzip nas respostas JSON. text/event-stream fica fora: a lista padrão de tipos
  // compressíveis do plugin já exclui, e o /api/stream escreve direto no socket
  // (reply.hijack), então nem passa pelo onSend da compressão.
  await fastify.register(fastifyCompress, {
    global: true,
    encodings: ['gzip'],
    threshold: 512,
  });

  if (process.env.NODE_ENV !== 'production') {
    await fastify.register(fastifyCors, {
      origin: ORIGENS_DE_DESENVOLVIMENTO,
      methods: ['GET', 'POST'],
      credentials: false,
    });
  }

  // O front do passo 3 entra aqui quando a pasta existir; sem ela, a API sobe sozinha.
  if (existsSync(PASTA_DO_FRONT)) {
    await fastify.register(fastifyStatic, { root: PASTA_DO_FRONT, prefix: '/' });
  }

  // Handler global: qualquer erro não tratado (JSON malformado, schema inválido) responde
  // mensagem curta, sem stack trace, e o processo segue de pé.
  fastify.setErrorHandler((erro, request, reply) => {
    console.error(`[erro] ${request.method} ${request.url}:`, erro.message);
    const codigo = erro.statusCode && erro.statusCode >= 400 ? erro.statusCode : 500;
    reply.code(codigo).send({ erro: codigo === 500 ? 'erro interno' : 'requisição inválida' });
  });

  registrarRotasMockAutorizacao(fastify);
  const filas = new GerenciadorDeFilas(db);
  registrarRotasPublicas(fastify, db, filas);

  return { fastify, filas };
}
