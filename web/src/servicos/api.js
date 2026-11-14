// Módulo central de chamadas HTTP. Toda chamada passa por aqui e tem timeout de 5 s.
// Nada de fetch solto nos componentes: o painel não pode ficar pendurado no projetor.

const TEMPO_LIMITE_MS = 5000;

export class ErroDeApi extends Error {
  constructor(mensagem, { status = 0, rota = '', tipo = 'rede' } = {}) {
    super(mensagem);
    this.name = 'ErroDeApi';
    this.status = status;
    this.rota = rota;
    this.tipo = tipo; // 'rede' | 'timeout' | 'http' | 'ausente' (404)
  }
}

// Mensagem curta e humana por tipo de falha. O usuário da demo lê isso no bloco.
function descreverFalha(tipo, status, rota) {
  if (tipo === 'timeout') return `A chamada para ${rota} passou de 5 s.`;
  if (tipo === 'ausente') return `A rota ${rota} não existe neste servidor.`;
  // Com o backend desligado, o proxy do Vite devolve 5xx: a dica mais útil é essa.
  if (tipo === 'http' && status >= 500) {
    return `O servidor respondeu ${status} em ${rota}. O backend pode estar desligado.`;
  }
  if (tipo === 'http') return `O servidor respondeu ${status} em ${rota}.`;
  return 'Servidor não respondeu. Confira se o backend está no ar.';
}

async function chamar(rota, { metodo = 'GET', corpo, tempoLimiteMs = TEMPO_LIMITE_MS } = {}) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tempoLimiteMs);

  try {
    const resposta = await fetch(rota, {
      method: metodo,
      headers: corpo ? { 'content-type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal,
    });

    if (!resposta.ok) {
      const tipo = resposta.status === 404 ? 'ausente' : 'http';
      throw new ErroDeApi(descreverFalha(tipo, resposta.status, rota), {
        status: resposta.status,
        rota,
        tipo,
      });
    }

    // 204 e corpo vazio não quebram: devolve null.
    const texto = await resposta.text();
    return texto ? JSON.parse(texto) : null;
  } catch (erro) {
    if (erro instanceof ErroDeApi) throw erro;
    const tipo = erro?.name === 'AbortError' ? 'timeout' : 'rede';
    throw new ErroDeApi(descreverFalha(tipo, 0, rota), { rota, tipo });
  } finally {
    clearTimeout(temporizador);
  }
}

/* ---------------- Leituras ---------------- */
export const buscarFila = () => chamar('/api/fila');
export const buscarSaude = () => chamar('/api/saude');
export const buscarTarefas = () => chamar('/api/tarefas');
export const buscarAuditoria = () => chamar('/api/auditoria');
export const buscarMetricas = () => chamar('/api/metricas');
export const buscarLinhaDoTempo = (id) => chamar(`/api/solicitacoes/${encodeURIComponent(id)}/linha-do-tempo`);

/* ---------------- Ações ---------------- */
// A rodada inteira pode passar de 5 s (3 convênios, retentativas de 200/400/800 ms):
// esta é a única chamada com folga maior, 30 s.
export const iniciarFila = () => chamar('/api/fila/iniciar', { metodo: 'POST', tempoLimiteMs: 30000 });
export const gerarCarga = () => chamar('/api/simulacao/carga', { metodo: 'POST' });
export const rodarTestes = () => chamar('/api/testes/rodar', { metodo: 'POST', tempoLimiteMs: 30000 });
export const anexarDocumento = (id) =>
  chamar(`/api/solicitacoes/${encodeURIComponent(id)}/documentos`, { metodo: 'POST', tempoLimiteMs: 15000 });
export const reprocessar = (id) =>
  chamar(`/api/solicitacoes/${encodeURIComponent(id)}/reprocessar`, { metodo: 'POST', tempoLimiteMs: 15000 });
export const derrubarConvenio = (id) =>
  chamar(`/api/convenios/${encodeURIComponent(id)}/derrubar`, { metodo: 'POST' });
export const restaurarConvenio = (id) =>
  chamar(`/api/convenios/${encodeURIComponent(id)}/restaurar`, { metodo: 'POST' });
export const definirModo = (id, modo) =>
  chamar(`/api/convenios/${encodeURIComponent(id)}/modo`, { metodo: 'POST', corpo: { modo } });

/* ---------------- Dados fixos de apresentação ---------------- */
// Ordem e rótulo das colunas. Os ids casam com o enum do backend (apiSimulada.js).
export const CONVENIOS = Object.freeze([
  { id: 'aurora', nome: 'Aurora Demo', curto: 'Aurora' },
  { id: 'horizonte', nome: 'Horizonte Demo', curto: 'Horizonte' },
  { id: 'jardim', nome: 'Jardim Demo', curto: 'Jardim' },
]);
