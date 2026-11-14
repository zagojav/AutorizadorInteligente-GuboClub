// Auditor de consistência: cruza fila, cadastro, guias e regras procurando contradição
// nos dados do kit. Tudo sai de consulta ao banco (nada de id fixo no código), e nenhum
// alerta muda a decisão do motor: muda_resultado é sempre false, é material pra equipe ver.
import { normalizarConvenio } from './banco.js';

const FONTE_FILA = 'kit/data/fila_autorizacao_mock.csv';
const FONTE_PACIENTES = 'kit/data/pacientes_sinteticos.csv';
const FONTE_GUIAS = 'kit/data/os_guias_mock.csv';
const FONTE_REGRAS = 'kit/docs/regras_convenios_demo.md (REGRAS-DEMO-v1)';

function alerta(tipo, referencia, descricao, fonte) {
  return { tipo, referencia, descricao, fonte, muda_resultado: false };
}

// Convênio do cadastro do paciente diferente do convênio com que a solicitação entrou na fila.
function acharConvenioDivergente(db) {
  const linhas = db.prepare(`
    SELECT s.id, s.paciente, s.convenio AS convenio_fila, p.convenio AS convenio_cadastro,
           COALESCE(c.nome, s.convenio) AS nome_convenio_fila
    FROM solicitacoes s
    JOIN pacientes p ON p.patient_id = s.paciente
    LEFT JOIN convenios c ON c.id = s.convenio
    WHERE s.sintetica = 0
    ORDER BY s.id
  `).all();

  return linhas
    .filter((linha) => normalizarConvenio(linha.convenio_cadastro) !== normalizarConvenio(linha.convenio_fila))
    .map((linha) => alerta(
      'convenio_divergente',
      linha.id,
      `paciente ${linha.paciente} é ${linha.convenio_cadastro} no cadastro e ${linha.nome_convenio_fila} na fila`,
      `${FONTE_PACIENTES} x ${FONTE_FILA}`,
    ));
}

// Procedimento da solicitação fora do que a regra daquele convênio cobre explicitamente.
function acharProcedimentoForaDaRegra(db) {
  const linhas = db.prepare(`
    SELECT s.id, s.convenio, s.procedimento, r.procedimento AS procedimento_da_regra, r.fonte
    FROM solicitacoes s
    JOIN regras r ON r.convenio = s.convenio
    WHERE s.sintetica = 0
      AND r.procedimento <> 'qualquer'
      AND s.procedimento IS NOT NULL
      AND s.procedimento <> r.procedimento
    ORDER BY s.id
  `).all();

  return linhas.map((linha) => alerta(
    'procedimento_fora_da_regra',
    linha.id,
    `procedimento ${linha.procedimento}, mas a regra do convênio ${linha.convenio} só cobre ${linha.procedimento_da_regra}`,
    FONTE_REGRAS,
  ));
}

// Guia pronta com número de autorização enquanto a solicitação do mesmo paciente não tem
// autorização nenhuma (nem a efetiva nem a que o kit esperava).
function acharGuiaConflitante(db) {
  const linhas = db.prepare(`
    SELECT g.os_id, g.patient_id, g.autorizacao, g.status AS status_guia,
           s.id AS solicitacao, s.status AS status_solicitacao, s.status_esperado_kit, s.numero_autorizacao
    FROM guias g
    JOIN solicitacoes s ON s.paciente = g.patient_id
    WHERE s.sintetica = 0
      AND TRIM(COALESCE(g.autorizacao, '')) <> ''
      AND TRIM(COALESCE(s.numero_autorizacao, '')) = ''
      AND COALESCE(s.status_esperado_kit, '') <> 'autorizado'
    ORDER BY g.os_id
  `).all();

  return linhas.map((linha) => alerta(
    'guia_conflitante',
    `${linha.solicitacao}/${linha.os_id}`,
    `guia ${linha.os_id} está ${linha.status_guia} com ${linha.autorizacao}, mas a fila diz ${linha.status_esperado_kit} para ${linha.solicitacao}`,
    `${FONTE_GUIAS} x ${FONTE_FILA}`,
  ));
}

// Cadastro que não está 'correto' no kit (divergente, incompleto...).
function acharCadastroIrregular(db) {
  const linhas = db.prepare(`
    SELECT patient_id, status_cadastro
    FROM pacientes
    WHERE COALESCE(status_cadastro, '') <> 'correto'
    ORDER BY patient_id
  `).all();

  return linhas.map((linha) => alerta(
    'cadastro_irregular',
    linha.patient_id,
    `cadastro ${linha.status_cadastro}`,
    FONTE_PACIENTES,
  ));
}

// Paciente sem consentimento de contato simulado: não pode entrar em follow-up automático.
function acharSemConsentimento(db) {
  const linhas = db.prepare(`
    SELECT patient_id
    FROM pacientes
    WHERE consentimento_contato_simulado = 0
    ORDER BY patient_id
  `).all();

  return linhas.map((linha) => alerta(
    'sem_consentimento',
    linha.patient_id,
    'sem consentimento de contato simulado: não entra em contato automático',
    FONTE_PACIENTES,
  ));
}

export function auditarConsistencia(db) {
  return [
    ...acharConvenioDivergente(db),
    ...acharProcedimentoForaDaRegra(db),
    ...acharGuiaConflitante(db),
    ...acharCadastroIrregular(db),
    ...acharSemConsentimento(db),
  ];
}

export function resumirAuditoria(db) {
  const alertas = auditarConsistencia(db);
  const porTipo = {};
  for (const item of alertas) {
    porTipo[item.tipo] = (porTipo[item.tipo] ?? 0) + 1;
  }
  return { simulado: true, total: alertas.length, por_tipo: porTipo, alertas };
}
