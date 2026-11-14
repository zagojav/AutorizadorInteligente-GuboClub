// Camada de IA. Nenhum teste chama API externa: o provedor é simulado por um servidor
// local que fala o protocolo de streaming da Anthropic (ANTHROPIC_BASE_URL aponta pra ele).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco, seedBanco } from '../server/banco.js';
import { construirServidor } from '../server/app.js';
import { resetarLimites, lerAchadosDoDocumento, resumirDocumento } from '../server/ia.js';

process.env.MOCK_LATENCIA_MS = '5';
process.env.ESPERAS_RETENTATIVA_MS = '5,5,5';
process.env.IA_ATRASO_TEMPLATE_MS = '0';

let fastify;
let filas;
let db;
let base;

// Provedor falso. modo = 'ok' responde em streaming; 'demora' nunca responde (pra estourar
// o timeout); 'erro' devolve 500.
let modoDoProvedor = 'ok';
let chamadasAoProvedor = 0;
let corposRecebidos = [];
let provedorFalso;

function blocoSse(tipo, dados) {
  return `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
}

test.before(async () => {
  provedorFalso = createServer((requisicao, resposta) => {
    let corpo = '';
    requisicao.on('data', (pedaco) => { corpo += pedaco; });
    requisicao.on('end', () => {
      chamadasAoProvedor += 1;
      corposRecebidos.push({ corpo, autorizacao: requisicao.headers['x-api-key'] ?? null });

      if (modoDoProvedor === 'demora') return; // nunca responde: o cliente estoura o timeout
      if (modoDoProvedor === 'erro') {
        resposta.writeHead(500, { 'content-type': 'application/json' });
        resposta.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'falha simulada' } }));
        return;
      }

      resposta.writeHead(200, { 'content-type': 'text/event-stream' });
      resposta.write(blocoSse('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_simulado',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      }));
      resposta.write(blocoSse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
      for (const trecho of ['Texto ', 'vindo ', 'do ', 'provedor ', 'simulado.']) {
        resposta.write(blocoSse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: trecho } }));
      }
      resposta.write(blocoSse('content_block_stop', { type: 'content_block_stop', index: 0 }));
      resposta.write(blocoSse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }));
      resposta.write(blocoSse('message_stop', { type: 'message_stop' }));
      resposta.end();
    });
  });
  await new Promise((resolver) => provedorFalso.listen(0, '127.0.0.1', resolver));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${provedorFalso.address().port}`;

  db = abrirBanco(':memory:');
  seedBanco(db);
  const servidor = await construirServidor({ db });
  fastify = servidor.fastify;
  filas = servidor.filas;
  base = await fastify.listen({ port: 0, host: '127.0.0.1' });
  process.env.MOCK_URL = `${base}/mock`;
});

test.after(async () => {
  await filas.aguardarConclusao();
  await fastify.close();
  db.close();
  await new Promise((resolver) => provedorFalso.close(resolver));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.IA_TEMPO_LIMITE_MS;
});

test.beforeEach(async () => {
  seedBanco(db);
  resetarLimites();
  chamadasAoProvedor = 0;
  corposRecebidos = [];
  modoDoProvedor = 'ok';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.IA_TEMPO_LIMITE_MS;
  // Roda a fila pra existir a tarefa humana do DEMO-R3 (Jardim indisponivel).
  const resposta = await fetch(`${base}/api/fila/iniciar`, { method: 'POST' });
  assert.equal(resposta.status, 200);
});

function idDaTarefaDoJardim() {
  return db.prepare("SELECT id FROM tarefas_humanas WHERE solicitacao = 'DEMO-R3'").get().id;
}

// Le o SSE do texto da tarefa inteiro e devolve {origem, texto, eventos}.
async function lerStreamDeTexto(tarefaId) {
  const resposta = await fetch(`${base}/api/tarefas/${tarefaId}/texto-ia/stream`);
  if (resposta.status !== 200) return { status: resposta.status, corpo: await resposta.json() };
  const bruto = await resposta.text();
  const eventos = [];
  for (const bloco of bruto.split('\n\n')) {
    const tipo = bloco.split('\n').find((linha) => linha.startsWith('event: '))?.slice(7);
    const dados = bloco.split('\n').find((linha) => linha.startsWith('data: '))?.slice(6);
    if (tipo && dados) eventos.push({ tipo, dados: JSON.parse(dados) });
  }
  const fim = eventos.find((evento) => evento.tipo === 'fim');
  const trechos = eventos.filter((evento) => evento.tipo === 'trecho');
  // A origem que vale e a ultima anunciada: se a IA cair no meio, ela e corrigida.
  const origens = eventos.filter((evento) => evento.tipo === 'origem');
  return {
    status: 200,
    origem: origens.at(-1)?.dados.origem ?? null,
    origens: origens.map((evento) => evento.dados.origem),
    texto: fim?.dados.texto ?? '',
    trechos: trechos.map((evento) => evento.dados.texto),
    eventos,
  };
}

test('IA - sem chave usa template e marca a origem como template', async () => {
  const tarefaId = idDaTarefaDoJardim();
  const resultado = await lerStreamDeTexto(tarefaId);

  assert.equal(resultado.status, 200);
  assert.equal(resultado.origem, 'template');
  assert.equal(chamadasAoProvedor, 0, 'sem chave nao pode chamar provedor nenhum');
  // Texto chega aos poucos: mais de um trecho.
  assert.ok(resultado.trechos.length > 5);
  // Conteudo do template cita motivo, regra e convenio.
  assert.match(resultado.texto, /DEMO-R3/);
  assert.match(resultado.texto, /Jardim Demo/);
  assert.match(resultado.texto, /REGRAS-DEMO-v1/);
  assert.ok(resultado.texto.split('\n').length <= 5);

  const tarefa = db.prepare('SELECT * FROM tarefas_humanas WHERE id = ?').get(tarefaId);
  assert.equal(tarefa.origem_texto, 'template');
  assert.equal(tarefa.texto_ia, resultado.texto);
});

test('IA - provedor simulado responde e a origem fica ia', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste-nao-real';
  const tarefaId = idDaTarefaDoJardim();
  const resultado = await lerStreamDeTexto(tarefaId);

  assert.equal(resultado.origem, 'ia');
  assert.equal(chamadasAoProvedor, 1);
  assert.equal(resultado.texto, 'Texto vindo do provedor simulado.');
  assert.ok(resultado.trechos.length > 1, 'texto tem que chegar em varios trechos');

  const tarefa = db.prepare('SELECT * FROM tarefas_humanas WHERE id = ?').get(tarefaId);
  assert.equal(tarefa.origem_texto, 'ia');

  // So os campos necessarios vao pro provedor: nada de tabela inteira.
  const { corpo } = corposRecebidos[0];
  assert.match(corpo, /DEMO-R3/);
  assert.equal(corpo.includes('DEMO-P010'), false, 'nao pode enviar paciente de outra solicitacao');
  assert.equal(corpo.includes('carteirinha'), false, 'nao pode enviar cadastro do paciente');
  assert.equal(corpo.includes('example.invalid'), false, 'nao pode enviar e-mail de paciente');
  const corpoJson = JSON.parse(corpo);
  assert.equal(corpoJson.max_tokens, 300);
  assert.equal(corpoJson.model, 'claude-haiku-4-5');
});

test('IA - provedor com timeout cai no template', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste-nao-real';
  process.env.IA_TEMPO_LIMITE_MS = '150';
  modoDoProvedor = 'demora';

  const tarefaId = idDaTarefaDoJardim();
  const resultado = await lerStreamDeTexto(tarefaId);

  assert.equal(chamadasAoProvedor, 1, 'tentou o provedor');
  assert.equal(resultado.origem, 'template', 'depois do timeout a origem e template');
  assert.match(resultado.texto, /DEMO-R3/);
  assert.equal(db.prepare('SELECT origem_texto FROM tarefas_humanas WHERE id = ?').get(tarefaId).origem_texto, 'template');
  // Timeout antes do primeiro token: o cliente nunca ve o rotulo 'ia'.
  assert.deepEqual(resultado.origens, ['template']);
  assert.equal(resultado.eventos.some((evento) => evento.tipo === 'fim' && evento.dados.origem === 'template'), true);
});

test('IA - provedor com erro cai no template', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste-nao-real';
  modoDoProvedor = 'erro';

  const resultado = await lerStreamDeTexto(idDaTarefaDoJardim());
  assert.equal(chamadasAoProvedor, 1);
  assert.equal(resultado.origem, 'template');
  assert.match(resultado.texto, /Jardim Demo/);
});

test('IA - nunca altera o status de nenhuma solicitacao', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste-nao-real';
  const antes = db.prepare('SELECT id, status, numero_autorizacao, motivo FROM solicitacoes ORDER BY id').all();
  const tarefasAntes = db.prepare('SELECT COUNT(*) AS total FROM tarefas_humanas').get().total;

  // Gera texto para TODAS as tarefas abertas.
  for (const tarefa of db.prepare('SELECT id FROM tarefas_humanas').all()) {
    resetarLimites();
    await lerStreamDeTexto(tarefa.id);
  }

  const depois = db.prepare('SELECT id, status, numero_autorizacao, motivo FROM solicitacoes ORDER BY id').all();
  assert.deepEqual(depois, antes, 'a IA nao pode mexer em status, numero nem motivo');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM tarefas_humanas').get().total, tarefasAntes);
  // Nenhuma autorizacao apareceu do nada.
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM solicitacoes WHERE status = 'autorizada' AND COALESCE(numero_autorizacao,'') = ''").get().total, 0);
});

test('IA - texto salvo e retransmitido sem chamar o provedor de novo', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste-nao-real';
  const tarefaId = idDaTarefaDoJardim();

  const primeira = await lerStreamDeTexto(tarefaId);
  assert.equal(primeira.origem, 'ia');
  assert.equal(chamadasAoProvedor, 1);

  resetarLimites();
  const segunda = await lerStreamDeTexto(tarefaId);
  assert.equal(chamadasAoProvedor, 1, 'nao pode gerar de novo o que ja esta salvo');
  assert.equal(segunda.origem, 'ia');
  assert.equal(segunda.texto, primeira.texto);
  assert.equal(segunda.eventos.find((evento) => evento.tipo === 'origem')?.dados.salvo, true);
});

test('IA - limite de 10 geracoes por minuto responde 429', async () => {
  const tarefas = [];
  // Cria tarefas extras suficientes pra passar do limite.
  for (let indice = 0; indice < 12; indice += 1) {
    const resultado = db.prepare(`
      INSERT INTO tarefas_humanas (solicitacao, motivo, prioridade, status)
      VALUES ('DEMO-R3', 'motivo de teste', 'normal', 'aberta')
    `).run();
    tarefas.push(Number(resultado.lastInsertRowid));
  }

  let bloqueadas = 0;
  for (const tarefaId of tarefas) {
    const resultado = await lerStreamDeTexto(tarefaId);
    if (resultado.status === 429) bloqueadas += 1;
  }
  assert.ok(bloqueadas >= 2, `esperava bloqueio por limite, bloqueadas=${bloqueadas}`);
});

test('IA - tarefa inexistente da 404 e id invalido da 400', async () => {
  const inexistente = await fetch(`${base}/api/tarefas/999999/texto-ia/stream`);
  assert.equal(inexistente.status, 404);

  const invalido = await fetch(`${base}/api/tarefas/abc/texto-ia/stream`);
  assert.equal(invalido.status, 400);
});

test('Documento - achados sao lidos do arquivo, nao do modelo', async () => {
  const achados = lerAchadosDoDocumento('DOCUMENTO FICTÍCIO — SEM VALIDADE\nNome: Paciente Exemplo 1\nIdentificador: DEMO-SEM-VALIDADE-1\n');
  assert.equal(achados.nome, 'Paciente Exemplo 1');
  assert.equal(achados.identificador, 'DEMO-SEM-VALIDADE-1');
  assert.equal(achados.tem_marca_demo, true);

  const semDemo = lerAchadosDoDocumento('Nome: Outro\nIdentificador: X-1\n');
  assert.equal(semDemo.tem_marca_demo, false);

  // Mesmo com provedor respondendo, os achados continuam vindo da leitura do arquivo.
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste-nao-real';
  const resumo = await resumirDocumento('Nome: Paciente Exemplo 1\nIdentificador: DEMO-SEM-VALIDADE-1\n');
  assert.equal(resumo.origem, 'ia');
  assert.equal(resumo.achados.identificador, 'DEMO-SEM-VALIDADE-1');
});

test('Documento - anexo no DEMO-R2 devolve sugestao_ia com origem', async () => {
  const resposta = await fetch(`${base}/api/solicitacoes/DEMO-R2/documentos`, { method: 'POST' });
  const corpo = await resposta.json();

  assert.equal(corpo.status, 'autorizada', 'a regra decide: documento anexado autoriza');
  assert.ok(corpo.sugestao_ia, 'esperava sugestao_ia na resposta');
  assert.equal(corpo.sugestao_ia.origem, 'template');
  assert.equal(corpo.sugestao_ia.achados.nome, 'Paciente Exemplo 1');
  assert.equal(corpo.sugestao_ia.achados.identificador, 'DEMO-SEM-VALIDADE-1');
  assert.equal(corpo.sugestao_ia.achados.tem_marca_demo, true);

  // A sugestao tambem fica no evento de anexo, com a origem.
  const linhaDoTempo = await (await fetch(`${base}/api/solicitacoes/DEMO-R2/linha-do-tempo`)).json();
  const eventoDoAnexo = linhaDoTempo.find((evento) => evento.ator === 'humano');
  assert.ok(eventoDoAnexo);
  assert.match(eventoDoAnexo.motivo, /sugestao \(template\)/);
  assert.match(eventoDoAnexo.motivo, /DEMO-SEM-VALIDADE-1/);
});

test('Saude - nunca expoe a chave do provedor', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste-nao-real';
  const resposta = await fetch(`${base}/api/saude`);
  const bruto = await resposta.text();

  assert.equal(bruto.includes('chave-de-teste-nao-real'), false, 'a chave nao pode sair na resposta');
  const corpo = JSON.parse(bruto);
  assert.equal(corpo.ia.provedor, 'anthropic');
  assert.equal(corpo.ia.modelo, 'claude-haiku-4-5');
  assert.equal('chave' in corpo.ia, false);
});
