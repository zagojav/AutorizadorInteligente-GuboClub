// Banco de dados: schema, indices e seed a partir do kit (REGRAS-DEMO-v1).
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarEvento } from './eventos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PASTA_DADOS_KIT = join(__dirname, '..', 'kit', 'data');

// Parser simples de CSV: os arquivos do kit nao tem virgula nem aspas dentro de campos.
function lerCsv(caminho) {
  const texto = readFileSync(caminho, 'utf8').trim();
  const linhas = texto.split(/\r?\n/);
  const cabecalho = linhas[0].split(',');
  return linhas.slice(1).filter((linha) => linha.length > 0).map((linha) => {
    const valores = linha.split(',');
    const registro = {};
    cabecalho.forEach((chave, indice) => {
      registro[chave] = valores[indice] ?? '';
    });
    return registro;
  });
}

// "Aurora Demo" -> "aurora"
function normalizarConvenio(nome) {
  return nome.trim().split(/\s+/)[0].toLowerCase();
}

// "Procedimento DEMO-2" -> "DEMO-2"
function normalizarProcedimento(nome) {
  return nome.replace(/^Procedimento\s+/i, '').trim();
}

function criarTabelas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS convenios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      status_integracao TEXT NOT NULL,
      disjuntor TEXT NOT NULL,
      falhas_seguidas INTEGER NOT NULL DEFAULT 0,
      tempo_limite_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS regras (
      convenio TEXT PRIMARY KEY,
      procedimento TEXT NOT NULL,
      exige_documento INTEGER NOT NULL,
      acao TEXT NOT NULL,
      fonte TEXT NOT NULL,
      versao INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS solicitacoes (
      id TEXT PRIMARY KEY,
      paciente TEXT NOT NULL,
      convenio TEXT NOT NULL,
      procedimento TEXT,
      status TEXT NOT NULL,
      numero_autorizacao TEXT,
      motivo TEXT,
      regra_usada TEXT,
      tentativas INTEGER NOT NULL DEFAULT 0,
      criado_em TEXT NOT NULL,
      respondido_em TEXT,
      latencia_ms INTEGER,
      status_esperado_kit TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_solicitacoes_convenio_status ON solicitacoes(convenio, status);

    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitacao TEXT NOT NULL,
      status_de TEXT,
      status_para TEXT NOT NULL,
      motivo TEXT,
      regra_usada TEXT,
      ator TEXT NOT NULL,
      horario TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eventos_solicitacao ON eventos(solicitacao);

    CREATE TABLE IF NOT EXISTS tarefas_humanas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitacao TEXT NOT NULL,
      motivo TEXT NOT NULL,
      texto_ia TEXT,
      prioridade TEXT NOT NULL DEFAULT 'normal',
      responsavel TEXT,
      prazo TEXT,
      status TEXT NOT NULL DEFAULT 'aberta'
    );

    CREATE TABLE IF NOT EXISTS documentos (
      solicitacao TEXT NOT NULL,
      tipo TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      recebido_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pacientes (
      patient_id TEXT PRIMARY KEY,
      nome TEXT,
      documento TEXT,
      email TEXT,
      convenio TEXT,
      carteirinha TEXT,
      status_cadastro TEXT,
      consentimento_contato_simulado INTEGER
    );

    CREATE TABLE IF NOT EXISTS guias (
      os_id TEXT PRIMARY KEY,
      patient_id TEXT,
      autorizacao TEXT,
      assinatura TEXT,
      status TEXT
    );
  `);
}

// Abre (ou cria) o arquivo de banco. Use ':memory:' para banco efemero (testes).
export function abrirBanco(caminhoArquivo = 'gubo_autorizador.db') {
  const db = new Database(caminhoArquivo);
  if (caminhoArquivo !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  criarTabelas(db);
  return db;
}

function limparTabelas(db) {
  db.exec(`
    DELETE FROM documentos;
    DELETE FROM tarefas_humanas;
    DELETE FROM eventos;
    DELETE FROM solicitacoes;
    DELETE FROM regras;
    DELETE FROM convenios;
    DELETE FROM pacientes;
    DELETE FROM guias;
  `);
}

// Reseta o banco e recarrega os dados fixos do kit (REGRAS-DEMO-v1). Usada no boot e nos testes.
export function seedBanco(db) {
  limparTabelas(db);

  const inserirConvenio = db.prepare(`
    INSERT INTO convenios (id, nome, status_integracao, disjuntor, falhas_seguidas, tempo_limite_ms)
    VALUES (?, ?, ?, ?, 0, ?)
  `);
  inserirConvenio.run('aurora', 'Aurora Demo', 'ok', 'fechado', 2000);
  inserirConvenio.run('horizonte', 'Horizonte Demo', 'ok', 'fechado', 2000);
  inserirConvenio.run('jardim', 'Jardim Demo', 'fora', 'fechado', 2000);

  const inserirRegra = db.prepare(`
    INSERT INTO regras (convenio, procedimento, exige_documento, acao, fonte, versao)
    VALUES (?, ?, ?, ?, 'REGRAS-DEMO-v1', 1)
  `);
  inserirRegra.run('aurora', 'DEMO-1', 0, 'autorizar');
  inserirRegra.run('horizonte', 'DEMO-2', 1, 'pedir_documento');
  inserirRegra.run('jardim', 'qualquer', 0, 'humano');
  inserirRegra.run('fora_da_base', 'qualquer', 0, 'humano');

  const pacientes = lerCsv(join(PASTA_DADOS_KIT, 'pacientes_sinteticos.csv'));
  const inserirPaciente = db.prepare(`
    INSERT INTO pacientes (patient_id, nome, documento, email, convenio, carteirinha, status_cadastro, consentimento_contato_simulado)
    VALUES (@patient_id, @nome, @documento, @email, @convenio, @carteirinha, @status_cadastro, @consentimento)
  `);
  for (const paciente of pacientes) {
    inserirPaciente.run({
      patient_id: paciente.patient_id,
      nome: paciente.nome,
      documento: paciente.documento,
      email: paciente.email,
      convenio: paciente.convenio,
      carteirinha: paciente.carteirinha,
      status_cadastro: paciente.status_cadastro,
      consentimento: paciente.consentimento_contato_simulado === 'true' ? 1 : 0,
    });
  }

  const guias = lerCsv(join(PASTA_DADOS_KIT, 'os_guias_mock.csv'));
  const inserirGuia = db.prepare(`
    INSERT INTO guias (os_id, patient_id, autorizacao, assinatura, status)
    VALUES (@os_id, @patient_id, @autorizacao, @assinatura, @status)
  `);
  for (const guia of guias) {
    inserirGuia.run(guia);
  }

  // Mapa patient_id -> procedimento normalizado, usado pela fila de autorizacao.
  const agendamentos = lerCsv(join(PASTA_DADOS_KIT, 'agendamentos_sinteticos.csv'));
  const procedimentoPorPaciente = new Map();
  for (const agendamento of agendamentos) {
    procedimentoPorPaciente.set(agendamento.patient_id, normalizarProcedimento(agendamento.procedimento));
  }

  const fila = lerCsv(join(PASTA_DADOS_KIT, 'fila_autorizacao_mock.csv'));
  const inserirSolicitacao = db.prepare(`
    INSERT INTO solicitacoes (id, paciente, convenio, procedimento, status, numero_autorizacao, motivo, regra_usada, tentativas, criado_em, respondido_em, latencia_ms, status_esperado_kit)
    VALUES (@id, @paciente, @convenio, @procedimento, 'recebida', NULL, NULL, NULL, 0, @criado_em, NULL, NULL, @status_esperado_kit)
  `);
  const agora = new Date().toISOString();
  for (const linha of fila) {
    inserirSolicitacao.run({
      id: linha.request_id,
      paciente: linha.patient_id,
      convenio: normalizarConvenio(linha.convenio),
      procedimento: procedimentoPorPaciente.get(linha.patient_id) ?? null,
      criado_em: agora,
      status_esperado_kit: linha.status,
    });
    registrarEvento(db, {
      solicitacao: linha.request_id,
      statusDe: null,
      statusPara: 'recebida',
      motivo: 'solicitacao recebida do kit (seed)',
      regraUsada: null,
      ator: 'sistema',
    });
  }
}

// Reinicia uma solicitacao para 'recebida', limpando o resultado anterior e as tarefas abertas.
export function reiniciarSolicitacao(db, id) {
  const atual = db.prepare('SELECT status FROM solicitacoes WHERE id = ?').get(id);
  if (!atual) return;

  db.prepare(`
    UPDATE solicitacoes
    SET status = 'recebida', numero_autorizacao = NULL, motivo = NULL, regra_usada = NULL,
        respondido_em = NULL, latencia_ms = NULL, tentativas = 0
    WHERE id = ?
  `).run(id);
  db.prepare('DELETE FROM tarefas_humanas WHERE solicitacao = ?').run(id);
  // Documentos anexados tambem saem: o estado inicial do kit nao tem documento, entao
  // reiniciar a fila sempre reproduz os mesmos tres resultados na demo.
  db.prepare('DELETE FROM documentos WHERE solicitacao = ?').run(id);

  registrarEvento(db, {
    solicitacao: id,
    statusDe: atual.status,
    statusPara: 'recebida',
    motivo: 'solicitacao reiniciada para novo processamento',
    regraUsada: null,
    ator: 'sistema',
  });
}
