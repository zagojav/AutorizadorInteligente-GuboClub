// Sobe o Fastify: um processo só, na porta PORT, servindo /mock (API fictícia) e /api (pública).
import Fastify from 'fastify';
import { abrirBanco, seedBanco } from './banco.js';
import { registrarRotasMockAutorizacao } from './apiSimulada.js';
import { registrarRotasPublicas } from './rotas.js';

const porta = Number(process.env.PORT) || 3000;
// Loopback por padrão: a demo roda local. Expor na rede só se pedirem (HOST=0.0.0.0).
const host = process.env.HOST || '127.0.0.1';
const caminhoBanco = process.env.BANCO_ARQUIVO || 'gubo_autorizador.db';

const db = abrirBanco(caminhoBanco);
seedBanco(db);

// bodyLimit apertado: nenhuma rota recebe payload grande, então não aceita.
const fastify = Fastify({ logger: false, bodyLimit: 64 * 1024 });

// Handler global: qualquer erro não tratado (JSON malformado, schema inválido) responde
// mensagem curta, sem stack trace, e o processo segue de pé.
fastify.setErrorHandler((erro, request, reply) => {
  console.error(`[erro] ${request.method} ${request.url}:`, erro.message);
  const codigo = erro.statusCode && erro.statusCode >= 400 ? erro.statusCode : 500;
  reply.code(codigo).send({ erro: codigo === 500 ? 'erro interno' : 'requisição inválida' });
});

registrarRotasMockAutorizacao(fastify);
registrarRotasPublicas(fastify, db);

// Erro assíncrono solto não derruba o processo no meio da demo.
process.on('unhandledRejection', (motivo) => {
  console.error('[erro] promessa rejeitada sem tratamento:', motivo);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, async () => {
    await fastify.close();
    db.close();
    process.exit(0);
  });
}

try {
  const endereco = await fastify.listen({ port: porta, host });
  console.log(`Autorizador Inteligente rodando em ${endereco}`);
} catch (erro) {
  console.error('[erro] falha ao subir o servidor:', erro.message);
  process.exit(1);
}
