// Rotas públicas da API. Toda rota tem try/catch: o processo nunca cai.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrarEvento, buscarLinhaDoTempo } from './eventos.js';
import { processarSolicitacao, rodarCasosBasicos } from './motor.js';
import {
  abrirBanco,
  seedBanco,
  reiniciarSolicitacao,
  restaurarConvenio,
  restaurarTodosOsConvenios,
  criarSolicitacoesSinteticas,
  LIMITE_SINTETICAS,
} from './banco.js';
import {
  definirModo,
  obterModo,
  listarModos,
  resetarModos,
  restaurarModoPadrao,
  MODOS_VALIDOS,
  CONVENIOS_CONHECIDOS,
} from './apiSimulada.js';
import { calcularMetricas, guardarResultadoDosCasos } from './metricas.js';
import { resumirAuditoria } from './auditor.js';
import { assinar } from './barramento.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Caminho fixo, dentro de ./kit. Nunca é montado com valor vindo do usuário (sem path traversal).
const CAMINHO_DOCUMENTO_MOCK = join(__dirname, '..', 'kit', 'docs', 'documento_mock.txt');

const SINTETICAS_POR_CONVENIO = 5;
const INTERVALO_HEARTBEAT_MS = 15000;
const INTERVALO_MINIMO_DE_METRICAS_MS = 1000;

// Schema de params: o id da solicitação só aceita o formato dos identificadores do kit
// (DEMO-R* da fila original, DEMO-S* das sintéticas de carga).
// Validação server-side acontece antes do handler; o front não é a defesa.
const SCHEMA_ID_SOLICITACAO = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', pattern: '^DEMO-(R|S)[0-9]{1,4}$' },
    },
  },
};

const SCHEMA_CONVENIO = {
  params: {
    type: 'object',
    required: ['convenio'],
    properties: {
      convenio: { type: 'string', enum: [...CONVENIOS_CONHECIDOS] },
    },
  },
};

const SCHEMA_MODO_CONVENIO = {
  params: SCHEMA_CONVENIO.params,
  body: {
    type: 'object',
    required: ['modo'],
    additionalProperties: false,
    properties: {
      modo: { type: 'string', enum: [...MODOS_VALIDOS] },
    },
  },
};

// Resposta de erro única: mensagem estável pro cliente, detalhe técnico só no log do servidor.
// Só vaza o detalhe se DETALHAR_ERROS=1 estiver ligado explicitamente (uso local de depuração).
function responderErro(reply, codigo, mensagem, erro) {
  console.error(`[erro] ${mensagem}:`, erro?.message ?? erro);
  reply.code(codigo);
  const corpo = { erro: mensagem };
  if (process.env.DETALHAR_ERROS === '1' && erro?.message) corpo.detalhe = erro.message;
  return corpo;
}

export function registrarRotasPublicas(fastify, db, filas) {
  // Dados de usuário nunca vão pra cache de CDN/edge, e nada de sniffing de content-type.
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
  });

  fastify.get('/api/saude', async (request, reply) => {
    try {
      const convenios = db.prepare(`
        SELECT id, nome, status_integracao, disjuntor, falhas_seguidas, aberto_em, tempo_limite_ms
        FROM convenios ORDER BY id
      `).all();
      return {
        status: 'ok',
        simulado: true,
        hora: new Date().toISOString(),
        convenios,
        modos: listarModos(),
        filas: filas.situacao(),
      };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar a saúde', erro);
    }
  });

  fastify.get('/api/fila', async (request, reply) => {
    try {
      return db.prepare('SELECT * FROM solicitacoes ORDER BY sintetica, id').all();
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar a fila', erro);
    }
  });

  // Rodada previsível: fecha todos os disjuntores, zera falhas, volta os modos pro padrão
  // do kit, reseta as solicitações e processa tudo pelas filas por convênio.
  fastify.post('/api/fila/iniciar', async (request, reply) => {
    try {
      restaurarTodosOsConvenios(db);
      resetarModos();

      const ids = db.prepare('SELECT id FROM solicitacoes ORDER BY sintetica, id').all().map((linha) => linha.id);
      ids.forEach((id) => reiniciarSolicitacao(db, id));
      filas.enfileirar(ids);
      await filas.aguardarConclusao();

      const fila = db.prepare('SELECT * FROM solicitacoes ORDER BY sintetica, id').all();
      return { processadas: ids.length, fila };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao iniciar a fila', erro);
    }
  });

  fastify.get('/api/solicitacoes/:id/linha-do-tempo', { schema: SCHEMA_ID_SOLICITACAO }, async (request, reply) => {
    try {
      const { id } = request.params;
      const solicitacao = db.prepare('SELECT id FROM solicitacoes WHERE id = ?').get(id);
      if (!solicitacao) {
        reply.code(404);
        return { erro: 'solicitação não encontrada' };
      }
      return buscarLinhaDoTempo(db, id);
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar a linha do tempo', erro);
    }
  });

  // Reprocessa UMA solicitação sem tocar em modo nem em disjuntor: serve pra ver o efeito
  // de um convênio derrubado/sem número numa solicitação específica.
  fastify.post('/api/solicitacoes/:id/reprocessar', { schema: SCHEMA_ID_SOLICITACAO }, async (request, reply) => {
    try {
      const { id } = request.params;
      const solicitacao = db.prepare('SELECT id FROM solicitacoes WHERE id = ?').get(id);
      if (!solicitacao) {
        reply.code(404);
        return { erro: 'solicitação não encontrada' };
      }
      reiniciarSolicitacao(db, id);
      await processarSolicitacao(db, id);
      return db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id);
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao reprocessar a solicitação', erro);
    }
  });

  // Anexa o documento fictício do kit (caminho fixo no servidor) e reprocessa a solicitação.
  fastify.post('/api/solicitacoes/:id/documentos', { schema: SCHEMA_ID_SOLICITACAO }, async (request, reply) => {
    try {
      const { id } = request.params;
      const solicitacao = db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id);
      if (!solicitacao) {
        reply.code(404);
        return { erro: 'solicitação não encontrada' };
      }

      const conteudo = readFileSync(CAMINHO_DOCUMENTO_MOCK, 'utf8');
      db.prepare(`
        INSERT INTO documentos (solicitacao, tipo, conteudo, recebido_em)
        VALUES (?, 'documento_mock', ?, ?)
      `).run(id, conteudo, new Date().toISOString());

      registrarEvento(db, {
        solicitacao: id,
        statusDe: solicitacao.status,
        statusPara: solicitacao.status,
        motivo: 'documento anexado pelo atendimento',
        regraUsada: solicitacao.regra_usada,
        ator: 'humano',
      });

      await processarSolicitacao(db, id);
      return db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(id);
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao anexar documento', erro);
    }
  });

  fastify.get('/api/tarefas', async (request, reply) => {
    try {
      return db.prepare('SELECT * FROM tarefas_humanas ORDER BY id').all();
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao consultar as tarefas', erro);
    }
  });

  // Troca o modo da API simulada de um convênio.
  // Convênio e modo validados por enum; nada além dos valores conhecidos entra aqui.
  fastify.post('/api/convenios/:convenio/modo', { schema: SCHEMA_MODO_CONVENIO }, async (request, reply) => {
    try {
      const { convenio } = request.params;
      const { modo } = request.body;
      definirModo(convenio, modo);
      return { convenio, modo: obterModo(convenio) };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao trocar o modo do convênio', erro);
    }
  });

  // Botão "derrubar Jardim": joga o convênio no modo caos (503 ou demora acima do timeout).
  fastify.post('/api/convenios/:convenio/derrubar', { schema: SCHEMA_CONVENIO }, async (request, reply) => {
    try {
      const { convenio } = request.params;
      definirModo(convenio, 'caos');
      return { convenio, modo: obterModo(convenio), derrubado: true };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao derrubar o convênio', erro);
    }
  });

  // Volta um convênio ao estado do kit: modo padrão, disjuntor fechado e falhas zeradas.
  fastify.post('/api/convenios/:convenio/restaurar', { schema: SCHEMA_CONVENIO }, async (request, reply) => {
    try {
      const { convenio } = request.params;
      restaurarModoPadrao(convenio);
      restaurarConvenio(db, convenio);
      const estado = db.prepare('SELECT id, status_integracao, disjuntor, falhas_seguidas FROM convenios WHERE id = ?').get(convenio);
      return { ...estado, modo: obterModo(convenio), restaurado: true };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao restaurar o convênio', erro);
    }
  });

  // Carga sintética: 5 solicitações por convênio entram nas filas. Não espera o fim de
  // propósito, pra demo mostrar o fluxo acontecendo ao vivo no SSE.
  fastify.post('/api/simulacao/carga', async (request, reply) => {
    try {
      const criadas = criarSolicitacoesSinteticas(db, SINTETICAS_POR_CONVENIO);
      filas.enfileirar(criadas.map((item) => item.id));
      const totalSinteticas = db.prepare('SELECT COUNT(*) AS total FROM solicitacoes WHERE sintetica = 1').get().total;
      return {
        simulado: true,
        criadas: criadas.length,
        ids: criadas.map((item) => item.id),
        sinteticas_no_banco: totalSinteticas,
        limite: LIMITE_SINTETICAS,
      };
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao gerar carga sintética', erro);
    }
  });

  fastify.get('/api/auditoria', async (request, reply) => {
    try {
      return resumirAuditoria(db);
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao rodar a auditoria', erro);
    }
  });

  fastify.get('/api/metricas', async (request, reply) => {
    try {
      return calcularMetricas(db);
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao calcular as métricas', erro);
    }
  });

  // Roda os 4 casos do kit num banco em memória: não encosta no banco da demo.
  fastify.post('/api/testes/rodar', async (request, reply) => {
    let dbTeste;
    try {
      dbTeste = abrirBanco(':memory:');
      seedBanco(dbTeste);
      const resultado = await rodarCasosBasicos(dbTeste);
      guardarResultadoDosCasos(resultado);
      return resultado;
    } catch (erro) {
      return responderErro(reply, 500, 'falha ao rodar os testes', erro);
    } finally {
      dbTeste?.close();
    }
  });

  registrarStream(fastify, db);
}

// SSE. Usa reply.hijack() e escreve direto no socket: não passa pelo onSend, então não
// é comprimido nem recebe content-length. O listener sai no 'close' do cliente.
function registrarStream(fastify, db) {
  // Publica 'metricas' no máximo 1 vez por segundo, reagindo ao que o motor emite.
  let ultimoEnvioDeMetricas = 0;
  let agendado = null;
  const publicarMetricas = () => {
    ultimoEnvioDeMetricas = Date.now();
    agendado = null;
    try {
      despacharParaTodos('metricas', calcularMetricas(db));
    } catch (erro) {
      console.error('[erro] falha ao calcular métricas para o stream:', erro.message);
    }
  };

  const clientes = new Set();

  function despacharParaTodos(tipo, dados) {
    const bloco = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const cliente of clientes) {
      try {
        cliente.write(bloco);
      } catch (erro) {
        console.error('[erro] falha ao escrever no cliente SSE:', erro.message);
      }
    }
  }

  const cancelarAssinatura = assinar(({ tipo, dados, horario }) => {
    if (clientes.size === 0) return;
    despacharParaTodos(tipo, { ...dados, horario });

    if (tipo === 'metricas') return;
    const desdeOUltimo = Date.now() - ultimoEnvioDeMetricas;
    if (desdeOUltimo >= INTERVALO_MINIMO_DE_METRICAS_MS) {
      publicarMetricas();
    } else if (!agendado) {
      agendado = setTimeout(publicarMetricas, INTERVALO_MINIMO_DE_METRICAS_MS - desdeOUltimo);
      agendado.unref?.();
    }
  });

  fastify.addHook('onClose', async () => {
    cancelarAssinatura();
    if (agendado) clearTimeout(agendado);
    for (const cliente of clientes) {
      try {
        cliente.end();
      } catch {
        // cliente já fechou
      }
    }
    clientes.clear();
  });

  fastify.get('/api/stream', (request, reply) => {
    try {
      reply.hijack();
      const resposta = reply.raw;
      resposta.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      resposta.write('retry: 2000\n\n');
      resposta.write(`event: conectado\ndata: ${JSON.stringify({ simulado: true, horario: new Date().toISOString() })}\n\n`);

      clientes.add(resposta);
      const pulso = setInterval(() => {
        try {
          resposta.write(': heartbeat\n\n');
        } catch (erro) {
          console.error('[erro] heartbeat SSE:', erro.message);
        }
      }, INTERVALO_HEARTBEAT_MS);
      pulso.unref?.();

      // Sem isso o listener fica pendurado e vaza memória a cada reconexão do front.
      const encerrar = () => {
        clearInterval(pulso);
        clientes.delete(resposta);
      };
      request.raw.on('close', encerrar);
      request.raw.on('error', encerrar);
    } catch (erro) {
      console.error('[erro] falha ao abrir o stream SSE:', erro.message);
    }
  });
}
