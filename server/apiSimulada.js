// API fictícia dos convenios. Nao depende do banco: so conhece o convenio pelo id da rota.
// Modo por convenio, trocavel em tempo real (ex: botao "derrubar Jardim" na demo).

const modosPorConvenio = new Map();

export function definirModo(convenio, modo) {
  modosPorConvenio.set(convenio, modo);
}

export function obterModo(convenio) {
  return modosPorConvenio.get(convenio) ?? 'normal';
}

export function resetarModos() {
  modosPorConvenio.clear();
}

function calcularLatenciaMs() {
  const fixa = process.env.MOCK_LATENCIA_MS;
  if (fixa !== undefined) return Number(fixa);
  return 100 + Math.random() * 700; // 100 a 800 ms
}

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registrarRotasMockAutorizacao(fastify) {
  fastify.post('/mock/:convenio/autorizar', async (request, reply) => {
    try {
      const { convenio } = request.params;
      const corpo = request.body ?? {};
      const modo = obterModo(convenio);

      if (modo === 'caos') {
        const vaiEstourarTimeout = Math.random() < 0.5;
        // Demora proposital maior que qualquer tempo_limite_ms configurado na demo (2000ms).
        await aguardar(vaiEstourarTimeout ? 3000 : calcularLatenciaMs());
        reply.code(503);
        return { status: 'servico_indisponivel' };
      }

      await aguardar(calcularLatenciaMs());

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

      if (convenio === 'jardim') {
        reply.code(503);
        return { status: 'servico_indisponivel' };
      }

      reply.code(404);
      return { status: 'convenio_desconhecido' };
    } catch (erro) {
      reply.code(500);
      return { erro: 'falha na api simulada', detalhe: erro.message };
    }
  });
}
