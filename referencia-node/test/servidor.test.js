// Servidor completo: compressão gzip no JSON, SSE sem compressão, auditoria e métricas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, seedBanco } from '../server/banco.js';
import { construirServidor } from '../server/app.js';

process.env.MOCK_LATENCIA_MS = '5';
process.env.ESPERAS_RETENTATIVA_MS = '5,5,5';

let fastify;
let filas;
let db;
let base;

test.before(async () => {
  db = abrirBanco(':memory:');
  seedBanco(db);
  const servidor = await construirServidor({ db });
  fastify = servidor.fastify;
  filas = servidor.filas;
  base = await fastify.listen({ port: 0, host: '127.0.0.1' });
  // O motor chama a API simulada do proprio servidor por HTTP, como em producao.
  process.env.MOCK_URL = `${base}/mock`;
  const resposta = await fetch(`${base}/api/fila/iniciar`, { method: 'POST' });
  assert.equal(resposta.status, 200);
});

test.after(async () => {
  // Espera os workers esvaziarem antes de fechar o banco: a carga sintetica roda em
  // segundo plano e escreveria num banco fechado.
  await filas.aguardarConclusao();
  await fastify.close();
  db.close();
});

test('Compressao - /api/fila responde gzip quando o cliente aceita', async () => {
  const resposta = await fetch(`${base}/api/fila`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('content-encoding'), 'gzip');
  const fila = await resposta.json();
  assert.equal(fila.length, 3);
});

test('Compressao - /api/stream NAO e comprimido e vem como text/event-stream', async () => {
  const controlador = new AbortController();
  try {
    const resposta = await fetch(`${base}/api/stream`, {
      headers: { 'accept-encoding': 'gzip, deflate, br', accept: 'text/event-stream' },
      signal: controlador.signal,
    });
    assert.equal(resposta.status, 200);
    assert.match(resposta.headers.get('content-type'), /text\/event-stream/);
    assert.equal(resposta.headers.get('content-encoding'), null);

    // Primeiro bloco traz o retry e o evento de conexao.
    const leitor = resposta.body.getReader();
    const { value } = await leitor.read();
    const texto = new TextDecoder().decode(value);
    assert.match(texto, /retry: 2000/);
  } finally {
    controlador.abort();
  }
});

test('SSE - evento chega no cliente quando a fila processa', async () => {
  const controlador = new AbortController();
  try {
    const resposta = await fetch(`${base}/api/stream`, { signal: controlador.signal });
    const leitor = resposta.body.getReader();
    await leitor.read(); // descarta o bloco de conexao

    await fetch(`${base}/api/solicitacoes/DEMO-R2/documentos`, { method: 'POST' });

    const decodificador = new TextDecoder();
    let acumulado = '';
    while (!acumulado.includes('event: solicitacao_atualizada')) {
      const { value, done } = await leitor.read();
      if (done) break;
      acumulado += decodificador.decode(value);
    }
    assert.match(acumulado, /event: solicitacao_atualizada/);
    assert.match(acumulado, /DEMO-R2/);
  } finally {
    controlador.abort();
  }
});

test('SSE - modo_mudou chega ao trocar modo, derrubar e restaurar', async () => {
  const controlador = new AbortController();
  try {
    const resposta = await fetch(`${base}/api/stream`, { signal: controlador.signal });
    const leitor = resposta.body.getReader();
    await leitor.read(); // descarta o bloco de conexao

    const decodificador = new TextDecoder();
    // Le do stream ate achar um modo_mudou com o modo esperado para o convenio.
    async function esperarModo(convenio, modoEsperado) {
      let acumulado = '';
      for (let leituras = 0; leituras < 40; leituras += 1) {
        const { value, done } = await leitor.read();
        if (done) break;
        acumulado += decodificador.decode(value);
        for (const bloco of acumulado.split('\n\n')) {
          if (!bloco.includes('event: modo_mudou')) continue;
          const linhaDados = bloco.split('\n').find((linha) => linha.startsWith('data: '));
          if (!linhaDados) continue;
          const dados = JSON.parse(linhaDados.slice(6));
          if (dados.convenio === convenio && dados.modo === modoEsperado) return dados;
        }
      }
      return null;
    }

    const trocaDeModo = fetch(`${base}/api/convenios/aurora/modo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modo: 'sem_numero' }),
    });
    const eventoModo = await esperarModo('aurora', 'sem_numero');
    await trocaDeModo;
    assert.ok(eventoModo, 'esperava modo_mudou da aurora com sem_numero');
    assert.equal(eventoModo.disjuntor, 'fechado');

    const derrubada = fetch(`${base}/api/convenios/jardim/derrubar`, { method: 'POST' });
    const eventoCaos = await esperarModo('jardim', 'caos');
    await derrubada;
    assert.ok(eventoCaos, 'esperava modo_mudou do jardim com caos');
    assert.ok(['fechado', 'aberto', 'meio_aberto'].includes(eventoCaos.disjuntor));

    const restauracao = fetch(`${base}/api/convenios/jardim/restaurar`, { method: 'POST' });
    const eventoNormal = await esperarModo('jardim', 'normal');
    await restauracao;
    assert.ok(eventoNormal, 'esperava modo_mudou do jardim com normal');
    assert.equal(eventoNormal.disjuntor, 'fechado');

    // A rodada restaura todos os convenios, entao a aurora volta pra normal tambem.
    const rodada = fetch(`${base}/api/fila/iniciar`, { method: 'POST' });
    const eventoDaRodada = await esperarModo('aurora', 'normal');
    await rodada;
    assert.ok(eventoDaRodada, 'esperava modo_mudou da aurora no fila/iniciar');
  } finally {
    controlador.abort();
  }
});

test('Auditoria - rota devolve os alertas com fonte do kit', async () => {
  const resposta = await fetch(`${base}/api/auditoria`);
  const corpo = await resposta.json();
  assert.equal(corpo.simulado, true);
  assert.ok(corpo.total >= 11);
  assert.ok(corpo.alertas.every((alerta) => alerta.muda_resultado === false));
  assert.ok(corpo.por_tipo.convenio_divergente >= 3);
});

test('Metricas - p50, p95 e encaminhamentos saem dos dados reais', async () => {
  // Reinicia a rodada: o teste do SSE anexou documento no DEMO-R2 e mudou o estado dele.
  await fetch(`${base}/api/fila/iniciar`, { method: 'POST' });
  const resposta = await fetch(`${base}/api/metricas`);
  const metricas = await resposta.json();

  assert.equal(metricas.simulado, true);
  assert.ok(metricas.chamadas > 0);
  assert.equal(typeof metricas.latencia_p50_ms, 'number');
  assert.equal(typeof metricas.latencia_p95_ms, 'number');
  assert.ok(metricas.latencia_p95_ms >= metricas.latencia_p50_ms);
  assert.equal(metricas.encaminhamentos_corretos, '3/3');
  assert.ok(metricas.falhas_detectadas >= 1);
  assert.ok(metricas.por_convenio.jardim.falhas >= 1);

  // Confere o p50 contra o calculo feito na mao sobre a tabela chamadas.
  const latencias = db.prepare('SELECT latencia_ms FROM chamadas ORDER BY latencia_ms ASC').all().map((l) => l.latencia_ms);
  const esperado = latencias[Math.ceil(0.5 * latencias.length) - 1];
  assert.equal(metricas.latencia_p50_ms, esperado);
});

test('Carga - cria 5 sinteticas por convenio e respeita o limite do banco', async () => {
  const resposta = await fetch(`${base}/api/simulacao/carga`, { method: 'POST' });
  const corpo = await resposta.json();
  assert.equal(corpo.criadas, 15);
  assert.ok(corpo.sinteticas_no_banco <= corpo.limite);
  assert.ok(corpo.ids.every((id) => /^DEMO-S[0-9]{3}$/.test(id)));
});

test('Validacao - id fora do padrao e modo invalido tomam 400', async () => {
  const idInvalido = await fetch(`${base}/api/solicitacoes/DEMO-X1/linha-do-tempo`);
  assert.equal(idInvalido.status, 400);

  const modoInvalido = await fetch(`${base}/api/convenios/aurora/modo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modo: 'invadir' }),
  });
  assert.equal(modoInvalido.status, 400);

  const convenioInvalido = await fetch(`${base}/api/convenios/outro/derrubar`, { method: 'POST' });
  assert.equal(convenioInvalido.status, 400);
});
