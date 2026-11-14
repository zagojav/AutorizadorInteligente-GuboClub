// Entrada do processo: abre o banco, sobe o servidor e aquece o resultado dos casos do kit.
import { abrirBanco, seedBanco } from './banco.js';
import { construirServidor } from './app.js';
import { rodarCasosBasicos } from './motor.js';
import { guardarResultadoDosCasos } from './metricas.js';

const porta = Number(process.env.PORT) || 3000;
// Loopback por padrão: a demo pública vai por túnel no localhost.
const host = process.env.HOST || '127.0.0.1';
const caminhoBanco = process.env.BANCO_ARQUIVO || 'gubo_autorizador.db';

const db = abrirBanco(caminhoBanco);
seedBanco(db);

const { fastify, filas } = await construirServidor({ db });

// Erro assíncrono solto não derruba o processo no meio da demo.
process.on('unhandledRejection', (motivo) => {
  console.error('[erro] promessa rejeitada sem tratamento:', motivo);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, async () => {
    await fastify.close();
    // Os workers podem estar no meio de uma retentativa: espera esvaziar antes de
    // fechar o banco, senão a última escrita bate em conexão fechada.
    await filas.aguardarConclusao();
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

// Roda os 4 casos do kit uma vez, em banco em memória, só pra /api/metricas já ter o
// casos_kit preenchido quando a banca abrir o painel. Falhar aqui não derruba o servidor.
try {
  const dbCasos = abrirBanco(':memory:');
  seedBanco(dbCasos);
  guardarResultadoDosCasos(await rodarCasosBasicos(dbCasos));
  dbCasos.close();
} catch (erro) {
  console.error('[erro] falha ao aquecer os casos do kit:', erro.message);
}
