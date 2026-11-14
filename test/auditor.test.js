// Auditor de consistência: confere que os alertas do kit aparecem, lendo os dados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, seedBanco } from '../server/banco.js';
import { auditarConsistencia } from '../server/auditor.js';

let db;
let alertas;

test.before(() => {
  db = abrirBanco(':memory:');
  seedBanco(db);
  alertas = auditarConsistencia(db);
});

test.after(() => {
  db.close();
});

// Procura um alerta de um tipo cuja referência bate e cuja descrição cita todos os termos.
function achar(tipo, referencia, ...termos) {
  return alertas.find((item) => item.tipo === tipo
    && item.referencia.includes(referencia)
    && termos.every((termo) => item.descricao.toLowerCase().includes(termo.toLowerCase())));
}

test('Auditor - convenio divergente entre cadastro e fila nas tres solicitacoes do kit', () => {
  assert.ok(achar('convenio_divergente', 'DEMO-R1', 'DEMO-P001', 'Horizonte Demo', 'aurora'));
  assert.ok(achar('convenio_divergente', 'DEMO-R2', 'DEMO-P002', 'Jardim Demo', 'horizonte'));
  assert.ok(achar('convenio_divergente', 'DEMO-R3', 'DEMO-P003', 'Aurora Demo', 'jardim'));
});

test('Auditor - procedimento fora da regra explicita do convenio', () => {
  assert.ok(achar('procedimento_fora_da_regra', 'DEMO-R1', 'DEMO-2', 'aurora', 'DEMO-1'));
  assert.ok(achar('procedimento_fora_da_regra', 'DEMO-R2', 'DEMO-3', 'horizonte', 'DEMO-2'));
  // Jardim cobre 'qualquer' procedimento, entao DEMO-R3 nao pode gerar este alerta.
  assert.equal(alertas.some((item) => item.tipo === 'procedimento_fora_da_regra' && item.referencia.includes('DEMO-R3')), false);
});

test('Auditor - guia pronta com autorizacao enquanto a fila diz servico indisponivel', () => {
  const alerta = achar('guia_conflitante', 'DEMO-OS003', 'DEMO-AUTH-3', 'servico_indisponivel');
  assert.ok(alerta);
  assert.ok(alerta.referencia.includes('DEMO-R3'));
});

test('Auditor - cadastro irregular e falta de consentimento', () => {
  assert.ok(achar('cadastro_irregular', 'DEMO-P001', 'divergente'));
  assert.ok(achar('cadastro_irregular', 'DEMO-P002', 'incompleto'));
  assert.ok(achar('sem_consentimento', 'DEMO-P004'));
  assert.ok(achar('sem_consentimento', 'DEMO-P008'));
});

test('Auditor - todo alerta tem fonte do kit e nao muda o resultado', () => {
  assert.ok(alertas.length >= 11);
  for (const alerta of alertas) {
    assert.equal(alerta.muda_resultado, false);
    assert.match(alerta.fonte, /^kit\//);
    assert.ok(alerta.descricao.length > 0);
  }
});
