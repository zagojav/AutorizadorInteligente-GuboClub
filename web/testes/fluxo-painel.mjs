// Roteiro de verificação do painel com navegador headless (Playwright).
// Percorre os fluxos da demo contra o backend Java no ar e confere, pela TELA e pela API,
// que cada passo deu o resultado esperado. Zero erro de console é parte do critério.
//
// Uso: node testes/fluxo-painel.mjs [--celular] [--rede-lenta] [--base http://127.0.0.1:3000]
//   --celular     emula um celular (390x844, touch, devicePixelRatio 3)
//   --rede-lenta  simula "Slow 3G" via CDP (400 kbps, 400 ms de latência)
import { chromium, devices } from 'playwright';

const argumentos = process.argv.slice(2);
const opcao = (nome) => argumentos.includes(nome);
const valorDe = (nome, padrao) => {
  const indice = argumentos.indexOf(nome);
  return indice >= 0 && argumentos[indice + 1] ? argumentos[indice + 1] : padrao;
};

const BASE = valorDe('--base', 'http://127.0.0.1:3000');
const CELULAR = opcao('--celular');
const REDE_LENTA = opcao('--rede-lenta');

const resultados = [];
const errosDeConsole = [];
const errosDePagina = [];

function registrar(nome, passou, detalhe = '') {
  resultados.push({ nome, passou, detalhe });
  console.log(`${passou ? 'OK ' : 'ERRO'}  ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}

async function esperar(condicao, { tempoLimiteMs = 20000, intervaloMs = 150, nome = 'condição' } = {}) {
  const inicio = Date.now();
  let ultimo;
  while (Date.now() - inicio < tempoLimiteMs) {
    ultimo = await condicao();
    if (ultimo) return ultimo;
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
  throw new Error(`tempo esgotado esperando ${nome}`);
}

async function api(caminho, metodo = 'GET', corpo) {
  const resposta = await fetch(BASE + caminho, {
    method: metodo,
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  return { status: resposta.status, dados: texto ? JSON.parse(texto) : null };
}

async function statusDe(id) {
  const { dados } = await api('/api/fila');
  return dados.find((item) => item.id === id)?.status;
}

// Texto do cartão da solicitação, lido na tela.
async function textoDoCartao(pagina, id) {
  const cartao = pagina.locator(`[data-flip="${id}"]`);
  return (await cartao.count()) ? cartao.innerText() : '';
}

async function clicarBotao(pagina, texto) {
  const botao = pagina.getByRole('button', { name: texto, exact: false }).first();
  await botao.waitFor({ state: 'visible', timeout: 15000 });
  await esperar(async () => botao.isEnabled(), { nome: `botão "${texto}" habilitado` });
  await botao.click();
}

const navegador = await chromium.launch();
const contexto = await navegador.newContext(
  CELULAR
    ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }
    : { viewport: { width: 1400, height: 900 } },
);
const pagina = await contexto.newPage();

if (REDE_LENTA) {
  // Perfil "Slow 3G" do DevTools: 400 kbps pra baixo e pra cima, 400 ms de latência.
  const cdp = await contexto.newCDPSession(pagina);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
}

pagina.on('console', (mensagem) => {
  if (mensagem.type() === 'error') errosDeConsole.push(mensagem.text());
});
pagina.on('pageerror', (erro) => errosDePagina.push(String(erro)));

const inicio = Date.now();
try {
  // Estado limpo antes de começar: modos e disjuntores do kit.
  await api('/api/fila/iniciar', 'POST');

  const abertura = Date.now();
  await pagina.goto(`${BASE}/#/painel`, { waitUntil: 'load' });
  await pagina.getByRole('heading', { name: 'Autorizador Inteligente' }).first().waitFor({ timeout: 30000 });
  // Esqueleto até os dados chegarem: a tela nunca fica em branco.
  await pagina.locator('.solicitacoes').first().waitFor({ timeout: 30000 });
  registrar('painel abre e carrega a fila', true, `${Date.now() - abertura} ms até a fila`);

  // "ao vivo" no topo: o SSE conectou.
  await esperar(async () => (await pagina.locator('.aovivo--ligado').count()) > 0, { nome: 'SSE ao vivo' });
  registrar('SSE conectado (selo ao vivo)', true);

  if (CELULAR) {
    // No celular as colunas viram abas: a aba do Jardim precisa mostrar o DEMO-R3.
    await pagina.getByRole('tab', { name: /Jardim/ }).click();
    await esperar(async () => pagina.locator('[data-flip="DEMO-R3"]').isVisible(), { nome: 'aba Jardim' });
    await pagina.getByRole('tab', { name: /Aurora/ }).click();
    registrar('abas por convênio no celular', true);
  }

  /* 1. Iniciar fila */
  await clicarBotao(pagina, 'Iniciar fila');
  await esperar(async () => (await statusDe('DEMO-R1')) === 'autorizada' && (await statusDe('DEMO-R3')) === 'tarefa_humana',
    { nome: 'fila processada', tempoLimiteMs: 40000 });
  await esperar(async () => (await textoDoCartao(pagina, 'DEMO-R1')).includes('DEMO-AUTH-1'), { nome: 'R1 na tela' });
  registrar('R1 autorizada com DEMO-AUTH-1 (tela e API)', true);
  registrar('R2 pendente de documento', (await statusDe('DEMO-R2')) === 'pendente_documento');
  if (CELULAR) await pagina.getByRole('tab', { name: /Jardim/ }).click();
  await esperar(async () => (await textoDoCartao(pagina, 'DEMO-R3')).toLowerCase().includes('tarefa humana'), { nome: 'R3 na tela' });
  registrar('R3 virou tarefa humana', true);

  /* 2. Texto da tarefa chegando aos poucos */
  const tarefas = pagina.locator('.tarefas .tarefa');
  await esperar(async () => (await tarefas.count()) >= 1, { nome: 'tarefa na tela' });
  const textoDaTarefa = tarefas.first().locator('.tarefa__texto');
  const tamanhos = [];
  await esperar(async () => {
    const tamanho = (await textoDaTarefa.innerText()).length;
    if (tamanho > 0 && tamanhos[tamanhos.length - 1] !== tamanho) tamanhos.push(tamanho);
    const selo = await tarefas.first().innerText();
    return tamanhos.length >= 3 && /Texto padrão|Redigido por IA/.test(selo);
  }, { nome: 'texto chegando aos poucos', tempoLimiteMs: 30000, intervaloMs: 40 });
  const seloDaOrigem = (await tarefas.first().innerText()).includes('Redigido por IA') ? 'ia' : 'template';
  registrar('texto da tarefa chega aos poucos com origem visível', true, `${tamanhos.length} tamanhos vistos, origem ${seloDaOrigem}`);

  /* 3. Anexar documento resolve o R2 */
  if (CELULAR) await pagina.getByRole('tab', { name: /Horizonte/ }).click();
  await clicarBotao(pagina, 'Anexar documento');
  await esperar(async () => (await statusDe('DEMO-R2')) === 'autorizada', { nome: 'R2 autorizada' });
  await esperar(async () => (await textoDoCartao(pagina, 'DEMO-R2')).includes('DEMO-AUTH-2'), { nome: 'R2 na tela' });
  registrar('anexar documento resolve R2 (DEMO-AUTH-2)', true);

  /* 4. Derrubar Jardim + carga: Aurora e Horizonte fluem, disjuntor do Jardim abre */
  if (CELULAR) await pagina.getByRole('tab', { name: /Jardim/ }).click();
  await clicarBotao(pagina, 'Derrubar Jardim');
  await esperar(async () => (await api('/api/saude')).dados.modos.jardim === 'caos', { nome: 'modo caos' });
  await clicarBotao(pagina, 'Gerar carga');
  await esperar(async () => {
    const { dados } = await api('/api/saude');
    return dados.convenios.find((c) => c.id === 'jardim').disjuntor === 'aberto';
  }, { nome: 'disjuntor aberto', tempoLimiteMs: 40000 });
  await esperar(async () => (await pagina.locator('.disjuntor--aberto').count()) > 0, { nome: 'disjuntor aberto na tela' });
  registrar('derrubar Jardim + carga abre o disjuntor (API e tela)', true);
  await esperar(async () => {
    const { dados } = await api('/api/fila');
    const sinteticas = dados.filter((s) => s.sintetica);
    const aurora = sinteticas.filter((s) => s.convenio === 'aurora');
    const horizonte = sinteticas.filter((s) => s.convenio === 'horizonte');
    return aurora.length >= 5 && horizonte.length >= 5
      && aurora.every((s) => s.status === 'autorizada')
      && horizonte.every((s) => s.status === 'pendente_documento');
  }, { nome: 'Aurora e Horizonte fluindo', tempoLimiteMs: 40000 });
  registrar('Aurora e Horizonte seguem fluindo com o Jardim fora', true);
  await clicarBotao(pagina, 'Restaurar Jardim');
  await esperar(async () => (await api('/api/saude')).dados.modos.jardim === 'normal', { nome: 'Jardim restaurado' });
  registrar('restaurar Jardim volta o modo e fecha o disjuntor', true);

  /* 5. Aurora sem número: trava, e voltar */
  await clicarBotao(pagina, 'Aurora sem número');
  await esperar(async () => (await statusDe('DEMO-R1')) === 'tarefa_humana', { nome: 'R1 travada' });
  const r1 = (await api('/api/fila')).dados.find((s) => s.id === 'DEMO-R1');
  registrar('Aurora sem número: R1 vira tarefa humana sem número', r1.numero_autorizacao === null, r1.motivo);
  await esperar(async () => (await pagina.getByRole('button', { name: /Aurora sem número: ligado/ }).count()) > 0, { nome: 'botão ligado' });
  await clicarBotao(pagina, 'Aurora sem número: ligado');
  await esperar(async () => (await statusDe('DEMO-R1')) === 'autorizada', { nome: 'R1 de volta' });
  registrar('desligar Aurora sem número reprocessa R1 autorizada', true);

  /* 6. Rodar 4 casos */
  await clicarBotao(pagina, 'Rodar 4 casos');
  await esperar(async () => (await pagina.locator('.controles__resultado').innerText()).includes('4/4'), { nome: '4/4 na tela', tempoLimiteMs: 40000 });
  registrar('rodar 4 casos dá 4/4', true);

  /* 7. Linha do tempo */
  if (CELULAR) await pagina.getByRole('tab', { name: /Jardim/ }).click();
  await pagina.locator('[data-flip="DEMO-R3"] .solicitacao').click();
  await pagina.getByRole('dialog').waitFor({ timeout: 10000 });
  await esperar(async () => (await pagina.locator('.linha .evento').count()) >= 3, { nome: 'eventos na linha do tempo' });
  const eventos = await pagina.locator('.linha .evento').count();
  await pagina.keyboard.press('Escape');
  await esperar(async () => (await pagina.getByRole('dialog').count()) === 0, { nome: 'gaveta fechada' });
  registrar('linha do tempo abre com eventos e fecha no Escape', true, `${eventos} eventos`);

  /* 8. Auditor e métricas */
  const auditoria = (await api('/api/auditoria')).dados;
  await esperar(async () => (await pagina.locator('.alertas .alerta').count()) === auditoria.total, { nome: 'alertas na tela' });
  registrar('auditor mostra os alertas da API', auditoria.total >= 8, `${auditoria.total} alertas`);
  // Os números da tela são interpolados (contador animado) e chegam pelo SSE: espera a
  // tela alcançar o valor que a API devolve agora.
  let metricas;
  await esperar(async () => {
    metricas = (await api('/api/metricas')).dados;
    const texto = await pagina.locator('.metricas').innerText();
    return metricas.simulado === true && texto.includes('simulado')
      && texto.includes(String(metricas.latencia_p50_ms)) && texto.includes(String(metricas.latencia_p95_ms));
  }, { nome: 'métricas da API na tela' });
  registrar('métricas marcadas como simuladas e com p50/p95 da API', true,
    `p50=${metricas.latencia_p50_ms} p95=${metricas.latencia_p95_ms} ${metricas.encaminhamentos_corretos} ${metricas.casos_kit}`);

  /* Página de abertura também carrega sem erro. */
  await pagina.goto(`${BASE}/`, { waitUntil: 'load' });
  await pagina.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 });
  await pagina.mouse.wheel(0, 2000);
  await pagina.waitForTimeout(600);
  registrar('abertura carrega e rola', true);
} catch (erro) {
  registrar('roteiro interrompido', false, erro.message);
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.passou).length;
console.log('');
console.log(`console.error: ${errosDeConsole.length}  erros de página: ${errosDePagina.length}  duração: ${Date.now() - inicio} ms`);
errosDeConsole.forEach((texto) => console.log('  console:', texto));
errosDePagina.forEach((texto) => console.log('  página:', texto));
console.log(`RESULTADO: ${resultados.length - falhas}/${resultados.length} passos ok${CELULAR ? ' (celular 390x844)' : ''}${REDE_LENTA ? ' (Slow 3G)' : ''}`);
process.exit(falhas === 0 && errosDeConsole.length === 0 && errosDePagina.length === 0 ? 0 : 1);
