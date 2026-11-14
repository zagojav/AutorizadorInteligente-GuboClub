// Sobe o Fastify: um processo so, na porta PORT, servindo /mock (API fictícia) e /api (publica).
import Fastify from 'fastify';
import { abrirBanco, seedBanco } from './banco.js';
import { registrarRotasMockAutorizacao } from './apiSimulada.js';
import { registrarRotasPublicas } from './rotas.js';

const porta = Number(process.env.PORT) || 3000;
const caminhoBanco = process.env.BANCO_ARQUIVO || 'gubo_autorizador.db';

const db = abrirBanco(caminhoBanco);
seedBanco(db);

const fastify = Fastify({ logger: false });
registrarRotasMockAutorizacao(fastify);
registrarRotasPublicas(fastify, db);

try {
  const endereco = await fastify.listen({ port: porta, host: '0.0.0.0' });
  console.log(`Autorizador Inteligente rodando em ${endereco}`);
} catch (erro) {
  fastify.log.error(erro);
  process.exit(1);
}
