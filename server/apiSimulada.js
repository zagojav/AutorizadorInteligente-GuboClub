// API fictícia dos convênios. Não depende do banco: só conhece o convênio pelo id da rota.
// Modo por convênio, trocável em tempo real (ex: botão "derrubar Jardim" na demo).

// Allowlist: só esses convênios e modos existem. Usada também pelo schema das rotas públicas.
export const CONVENIOS_CONHECIDOS = Object.freeze(['aurora', 'horizonte', 'jardim']);
export const MODOS_VALIDOS = Object.freeze(['normal', 'caos', 'sem_numero']);

const modosPorConvenio = new Map();

export function definirModo(convenio, modo) {
  if (!CONVENIOS_CONHECIDOS.includes(convenio)) throw new Error('convênio desconhecido');
  if (!MODOS_VALIDOS.includes(modo)) throw new Error('modo inválido');
  modosPorConvenio.set(convenio, modo);
}

export function obterModo(convenio) {
  return modosPorConvenio.get(convenio) ?? 'normal';
}

export function resetarModos() {
  modosPorConvenio.clear();
}

// Modo padrão do kit: aurora e horizonte normais; jardim também 'normal', porque o
// indisponível dele já é o comportamento nativo da API simulada (responde 503).
export function restaurarModoPadrao(convenio) {
  modosPorConvenio.delete(convenio);
}

export function listarModos() {
  return Object.fromEntries(CONVENIOS_CONHECIDOS.map((convenio) => [convenio, obterModo(convenio)]));
}

// Latência aleatória de 100 a 800 ms. Nos testes, fixa por MOCK_LATENCIA_MS.
function calcularLatenciaMs() {
  const fixa = Number(process.env.MOCK_LATENCIA_MS);
  if (Number.isFinite(fixa) && fixa >= 0) return fixa;
  return 100 + Math.random() * 700;
}

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SCHEMA_ROTA_MOCK = {
  params: {
    type: 'object',
    required: ['convenio'],
    properties: {
      convenio: { type: 'string', enum: [...CONVENIOS_CONHECIDOS] },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      solicitacao: { type: 'string', maxLength: 64 },
      procedimento: { type: ['string', 'null'], maxLength: 64 },
      tem_documento: { type: 'boolean' },
      // Modo só desta chamada. Os casos do kit usam isso pra rodar sem mexer no modo
      // global do convênio (senão rodar os testes mudaria o comportamento da demo ao vivo).
      modo_simulado: { type: 'string', enum: [...MODOS_VALIDOS] },
    },
  },
};

export function registrarRotasMockAutorizacao(fastify) {
  fastify.post('/mock/:convenio/autorizar', { schema: SCHEMA_ROTA_MOCK }, async (request, reply) => {
    try {
      const { convenio } = request.params;
      const corpo = request.body ?? {};
      const modo = corpo.modo_simulado ?? obterModo(convenio);

      if (modo === 'caos') {
        const vaiEstourarTimeout = Math.random() < 0.5;
        // Demora proposital maior que qualquer tempo_limite_ms configurado na demo (2000ms).
        await aguardar(vaiEstourarTimeout ? 3000 : calcularLatenciaMs());
        reply.code(503);
        return { status: 'servico_indisponivel' };
      }

      await aguardar(calcularLatenciaMs());

      // Responde autorizado SEM número: existe pra provar que o motor não inventa autorização.
      if (modo === 'sem_numero') {
        return { status: 'autorizado' };
      }

      if (convenio === 'aurora') {
        return { status: 'autorizado', numero_autorizacao: 'DEMO-AUTH-1' };
      }

      if (convenio === 'horizonte') {
        if (corpo.tem_documento) {
          return { status: 'autorizado', numero_autorizacao: 'DEMO-AUTH-2-SIMULADO' };
        }
        return { status: 'pendente_documento' };
      }

      // jardim: serviço simulado indisponível.
      reply.code(503);
      return { status: 'servico_indisponivel' };
    } catch (erro) {
      console.error('[erro] falha na api simulada:', erro.message);
      reply.code(500);
      return { status: 'erro_interno' };
    }
  });
}
