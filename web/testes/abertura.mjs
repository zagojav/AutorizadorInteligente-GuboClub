// Verificação da página de abertura (/) em navegador headless.
// Confere: nenhuma requisição a domínio de terceiro, fonte local carregada, as 5 cenas
// presentes, scroll até o fim com taxa de quadros medida por requestAnimationFrame,
// botão "Abrir painel ao vivo" levando a /#/painel e prefers-reduced-motion sem Lenis.
// Tira capturas em web/testes/capturas/ pra conferência visual.
//
// Uso: node testes/abertura.mjs [--celular] [--base http://127.0.0.1:3000]
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

const argumentos = process.argv.slice(2);
const CELULAR = argumentos.includes('--celular');
const indiceBase = argumentos.indexOf('--base');
const BASE = indiceBase >= 0 ? argumentos[indiceBase + 1] : 'http://127.0.0.1:3000';
const PASTA = new URL('./capturas/', import.meta.url).pathname;
await mkdir(PASTA, { recursive: true });

const resultados = [];
function registrar(nome, passou, detalhe = '') {
  resultados.push({ nome, passou });
  console.log(`${passou ? 'OK ' : 'ERRO'}  ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}

const navegador = await chromium.launch();
const contexto = await navegador.newContext(
  CELULAR ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1400, height: 900 } },
);
const pagina = await contexto.newPage();
const errosDeConsole = [];
const terceiros = new Set();
pagina.on('console', (m) => { if (m.type() === 'error') errosDeConsole.push(m.text()); });
pagina.on('pageerror', (e) => errosDeConsole.push(String(e)));
pagina.on('request', (r) => {
  const url = new URL(r.url());
  if (url.origin !== new URL(BASE).origin) terceiros.add(url.host);
});

try {
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await pagina.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 });

  registrar('nenhuma requisição a domínio de terceiro', terceiros.size === 0, [...terceiros].join(', ') || 'só a própria origem');

  const fonte = await pagina.evaluate(async () => {
    await document.fonts.ready;
    const carregadas = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`);
    return { ok: document.fonts.check('700 16px Inter') && document.fonts.check('400 16px Inter'), carregadas };
  });
  registrar('Inter local carregada (peso variável 100 a 900)', fonte.ok, fonte.carregadas.join('; '));

  const cenas = await pagina.locator('[data-cena]').count();
  registrar('5 cenas presentes', cenas === 5, `${cenas} cenas`);

  const sufixo = CELULAR ? '-celular' : '';
  await pagina.screenshot({ path: `${PASTA}cena1${sufixo}.png` });

  // Rola até o fim medindo quadros por segundo: o scroll é por roda (Lenis) em passos.
  const altura = await pagina.evaluate(() => document.documentElement.scrollHeight);
  const medicao = await pagina.evaluate(() => {
    window.__quadros = 0;
    window.__inicio = performance.now();
    const contar = () => { window.__quadros += 1; if (!window.__parar) requestAnimationFrame(contar); };
    requestAnimationFrame(contar);
    return true;
  });
  const passos = 24;
  for (let i = 1; i <= passos; i += 1) {
    await pagina.mouse.wheel(0, altura / passos);
    await pagina.waitForTimeout(120);
    if (i === Math.round(passos * 0.3)) await pagina.screenshot({ path: `${PASTA}cena2${sufixo}.png` });
    if (i === Math.round(passos * 0.5)) await pagina.screenshot({ path: `${PASTA}cena3${sufixo}.png` });
    if (i === Math.round(passos * 0.72)) await pagina.screenshot({ path: `${PASTA}cena4${sufixo}.png` });
  }
  await pagina.waitForTimeout(1200);
  const fps = await pagina.evaluate(() => {
    window.__parar = true;
    const segundos = (performance.now() - window.__inicio) / 1000;
    return Math.round(window.__quadros / segundos);
  });
  await pagina.screenshot({ path: `${PASTA}cena5${sufixo}.png` });
  registrar('scroll até o fim com quadros contados', medicao && fps >= 50, `${fps} fps médios durante o scroll (headless)`);

  const longasTarefas = await pagina.evaluate(() => new Promise((resolve) => {
    // Tarefas longas (> 50 ms) durante 1,5 s de scroll programático.
    const longas = [];
    const observador = new PerformanceObserver((lista) => lista.getEntries().forEach((e) => longas.push(Math.round(e.duration))));
    observador.observe({ type: 'longtask', buffered: false });
    window.scrollTo({ top: 0 });
    let passo = 0;
    const timer = setInterval(() => {
      passo += 1;
      window.scrollBy(0, document.documentElement.scrollHeight / 20);
      if (passo >= 20) { clearInterval(timer); setTimeout(() => { observador.disconnect(); resolve(longas); }, 300); }
    }, 60);
  }));
  registrar('sem tarefa longa (> 50 ms) durante o scroll', longasTarefas.length === 0, longasTarefas.length ? `${longasTarefas.join(', ')} ms` : 'nenhuma');

  const botao = pagina.getByRole('link', { name: /Abrir painel ao vivo/ });
  await botao.scrollIntoViewIfNeeded();
  await pagina.waitForTimeout(800);
  await botao.click();
  await pagina.waitForURL(/#\/painel/, { timeout: 10000 });
  await pagina.getByRole('heading', { name: 'Autorizador Inteligente' }).first().waitFor({ timeout: 15000 });
  registrar('"Abrir painel ao vivo" leva a /#/painel', true);

  // Voltar pra abertura não deixa pin-spacer nem ScrollTrigger sobrando no painel.
  const sobras = await pagina.locator('.pin-spacer').count();
  registrar('painel sem sobras da abertura (pin-spacer)', sobras === 0, `${sobras} pin-spacer`);

  // Quem pediu menos movimento: sem Lenis, cenas visíveis com fade.
  await pagina.emulateMedia({ reducedMotion: 'reduce' });
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const semMovimento = await pagina.locator('.abertura--sem-movimento').count();
  const lenisAtivo = await pagina.evaluate(() => document.documentElement.classList.contains('lenis'));
  registrar('prefers-reduced-motion: sem Lenis e sem scrub', semMovimento === 1 && !lenisAtivo);

  registrar('zero erro de console', errosDeConsole.length === 0, errosDeConsole.join(' | '));
} catch (erro) {
  registrar('roteiro interrompido', false, erro.message);
} finally {
  await navegador.close();
}

const falhas = resultados.filter((r) => !r.passou).length;
console.log(`RESULTADO ABERTURA: ${resultados.length - falhas}/${resultados.length} ok${CELULAR ? ' (celular)' : ''}`);
process.exit(falhas === 0 ? 0 : 1);
