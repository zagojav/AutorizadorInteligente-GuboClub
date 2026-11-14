// Três rodadas reais no navegador, com processo/banco novos entre elas.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const raiz = new URL('../', import.meta.url).pathname;
process.chdir(raiz);
mkdirSync('.runtime', { recursive: true });
const ler = async (rota) => {
  // Não reaproveitar sockets entre processos Java diferentes após o reset.
  const resposta = await fetch(`http://127.0.0.1:3000${rota}`, { headers: { connection: 'close' } });
  assert.equal(resposta.status, 200);
  return resposta.json();
};
let referencia;
for (let rodada = 1; rodada <= 3; rodada++) {
  console.log(`RODADA ${rodada}: reset de processo e banco em memória`);
  execFileSync('bash', ['scripts/reset.sh'], { stdio: 'inherit' });
  const saida = execFileSync(process.execPath, ['testes/fluxo-painel.mjs'], {
    cwd: `${raiz}/web`, encoding: 'utf8', timeout: 180000,
  });
  console.log(saida);
  writeFileSync(`.runtime/rodada-${rodada}.log`, saida);
  const [fila, auditoria, metricas, saude] = await Promise.all([
    ler('/api/fila'), ler('/api/auditoria'), ler('/api/metricas'), ler('/api/saude'),
  ]);
  // Horários, IDs de eventos e latências variam legitimamente. Compara decisões,
  // números de autorização, alertas e contagens, sem apagar diferenças de negócio.
  const resumo = {
    fila: fila.map(({ id, convenio, status, numero_autorizacao }) => ({ id, convenio, status, numero_autorizacao })),
    alertas: auditoria.alertas.map(({ tipo, referencia, muda_resultado }) => ({ tipo, referencia, muda_resultado })),
    casos: metricas.casos_kit,
    encaminhamentos: metricas.encaminhamentos_corretos,
    tarefas: metricas.tarefas_abertas,
    modos: saude.modos,
  };
  assert.equal(metricas.simulado, true);
  assert.equal(metricas.casos_kit, '4/4');
  if (referencia) assert.deepEqual(resumo, referencia);
  referencia = resumo;
  writeFileSync(`.runtime/rodada-${rodada}.json`, JSON.stringify({ resumo, metricas, auditoria }, null, 2));
  console.log(`RODADA ${rodada} OK: decisões conferidas; métricas simuladas p50=${metricas.latencia_p50_ms}, p95=${metricas.latencia_p95_ms}`);
}
console.log('3/3 RODADAS OK: resultados de negócio idênticos com reset entre rodadas.');
