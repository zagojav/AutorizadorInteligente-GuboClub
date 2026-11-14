// Assinaturas SSE do painel.
//
// Cuidado importante: HTTP/1.1 permite ~6 conexões por host. O /api/stream já usa uma.
// Se cada tarefa humana abrisse o seu próprio EventSource, com 6 tarefas o painel
// travaria no meio da apresentação. Por isso os textos da IA entram numa FILA e são
// transmitidos um por vez.
import { useCallback, useEffect, useRef, useState } from 'react';

const TIPOS = ['conectado', 'solicitacao_atualizada', 'disjuntor_mudou', 'modo_mudou', 'tarefa_criada', 'metricas'];

// Teto por tarefa: stream pendurado não pode travar a fila inteira.
const LIMITE_POR_TAREFA_MS = 15000;

/**
 * Liga no /api/stream e chama os handlers recebidos.
 * O EventSource já reconecta sozinho; aqui traduzimos isso em estado visível.
 * @param {Record<string, (dados: any) => void>} manipuladores mapa tipo -> função
 * @returns {'conectando'|'ao_vivo'|'reconectando'} situação da conexão
 */
export function useStreamDeEventos(manipuladores) {
  const [situacao, setSituacao] = useState('conectando');
  // Ref pra que trocar os handlers não reabra a conexão a cada render.
  const refManipuladores = useRef(manipuladores);
  refManipuladores.current = manipuladores;

  useEffect(() => {
    let fonte;
    try {
      fonte = new EventSource('/api/stream');
    } catch {
      setSituacao('reconectando');
      return undefined;
    }

    const aoAbrir = () => setSituacao('ao_vivo');
    const aoErrar = () => setSituacao('reconectando');
    fonte.addEventListener('open', aoAbrir);
    fonte.addEventListener('error', aoErrar);

    const registrados = TIPOS.map((tipo) => {
      const ouvinte = (evento) => {
        setSituacao('ao_vivo');
        try {
          refManipuladores.current?.[tipo]?.(JSON.parse(evento.data));
        } catch {
          // Evento sem JSON válido não derruba a tela.
        }
      };
      fonte.addEventListener(tipo, ouvinte);
      return [tipo, ouvinte];
    });

    return () => {
      fonte.removeEventListener('open', aoAbrir);
      fonte.removeEventListener('error', aoErrar);
      registrados.forEach(([tipo, ouvinte]) => fonte.removeEventListener(tipo, ouvinte));
      fonte.close();
    };
  }, []);

  return situacao;
}

// Lê um bloco do SSE de texto. Aceita JSON ({token, origem, fim}) ou texto puro.
function interpretarPedaco(bruto) {
  try {
    const dados = JSON.parse(bruto);
    if (typeof dados === 'string') return { token: dados };
    return {
      token: dados?.token ?? dados?.texto ?? dados?.delta ?? '',
      origem: dados?.origem ?? null,
      fim: Boolean(dados?.fim ?? dados?.concluido),
    };
  } catch {
    return { token: bruto };
  }
}

/**
 * Transmite o texto de encaminhamento das tarefas, UMA por vez.
 * Rota: GET /api/tarefas/:id/texto-ia/stream (SSE, token por token, com a origem).
 *
 * @param {Array<{id: number, texto_ia?: string|null, origem_texto?: string|null}>} tarefas
 * @returns {Record<number, {texto: string, origem: string|null, situacao: string}>}
 */
export function useTextosDaIa(tarefas) {
  const [textos, setTextos] = useState({});
  const controle = useRef({
    fila: [],
    enfileirados: new Set(),
    rodando: false,
    fonte: null,
    temporizador: null,
    desmontado: false,
  });

  const atualizar = useCallback((id, mudanca) => {
    setTextos((atual) => ({
      ...atual,
      [id]: { texto: '', origem: null, situacao: 'esperando', ...atual[id], ...mudanca },
    }));
  }, []);

  const girar = useCallback(() => {
    const ref = controle.current;
    if (ref.rodando || ref.desmontado) return;

    const id = ref.fila.shift();
    if (id === undefined) return;
    ref.rodando = true;

    const encerrar = (situacaoFinal) => {
      clearTimeout(ref.temporizador);
      ref.temporizador = null;
      try {
        ref.fonte?.close();
      } catch {
        // já fechou
      }
      ref.fonte = null;
      ref.rodando = false;
      if (situacaoFinal) atualizar(id, { situacao: situacaoFinal });
      if (!ref.desmontado) girar();
    };

    let fonte;
    try {
      fonte = new EventSource(`/api/tarefas/${encodeURIComponent(id)}/texto-ia/stream`);
    } catch {
      encerrar('indisponivel');
      return;
    }
    ref.fonte = fonte;
    atualizar(id, { situacao: 'fluindo', texto: '' });

    const aplicar = (bruto) => {
      const { token, origem, fim } = interpretarPedaco(bruto);
      if (origem || token) {
        setTextos((atual) => {
          const anterior = atual[id] ?? { texto: '', origem: null, situacao: 'fluindo' };
          return {
            ...atual,
            [id]: {
              texto: token ? anterior.texto + token : anterior.texto,
              origem: origem ?? anterior.origem,
              situacao: 'fluindo',
            },
          };
        });
      }
      if (fim) encerrar('concluido');
    };

    // O backend emite "origem", "trecho" (um pedaço por vez) e "fim" (texto completo).
    // Os trechos vão se acumulando; no "fim" só aproveitamos o texto completo se nenhum
    // trecho chegou (texto salvo de antes), senão o parágrafo sairia dobrado.
    const aoTerminar = (bruto) => {
      const { token, origem } = interpretarPedaco(bruto ?? '');
      setTextos((atual) => {
        const anterior = atual[id] ?? { texto: '', origem: null, situacao: 'fluindo' };
        return {
          ...atual,
          [id]: {
            texto: anterior.texto || token || '',
            origem: origem ?? anterior.origem,
            situacao: 'concluido',
          },
        };
      });
      encerrar('concluido');
    };

    const ouvintes = [
      ['message', (evento) => aplicar(evento.data)],
      ['token', (evento) => aplicar(evento.data)],
      ['trecho', (evento) => aplicar(evento.data)],
      ['origem', (evento) => aplicar(evento.data)],
      ['falha', () => encerrar('indisponivel')],
      ['fim', (evento) => aoTerminar(evento.data)],
    ];
    ouvintes.forEach(([tipo, ouvinte]) => fonte.addEventListener(tipo, ouvinte));

    // Erro aqui não reconecta em loop: a próxima tarefa da fila é mais importante,
    // e o componente mostra o texto já salvo no banco quando existir.
    fonte.addEventListener('error', () => {
      if (!ref.fonte) return;
      setTextos((atual) => {
        const atualDoId = atual[id];
        // Se já chegou texto, o fim do stream conta como concluído.
        const situacao = atualDoId?.texto ? 'concluido' : 'indisponivel';
        return { ...atual, [id]: { ...atualDoId, texto: atualDoId?.texto ?? '', origem: atualDoId?.origem ?? null, situacao } };
      });
      encerrar(null);
    });

    ref.temporizador = setTimeout(() => encerrar('indisponivel'), LIMITE_POR_TAREFA_MS);
  }, [atualizar]);

  // Enfileira cada tarefa nova uma única vez. Tarefa que sumiu da lista (a fila foi
  // reiniciada e o backend apagou a tarefa) sai da espera: pedir o texto dela daria 404.
  useEffect(() => {
    const ref = controle.current;
    const abertas = new Set((tarefas ?? []).map((tarefa) => tarefa?.id));
    ref.fila = ref.fila.filter((id) => abertas.has(id));
    let entrouAlguma = false;
    (tarefas ?? []).forEach((tarefa) => {
      if (tarefa?.id == null || ref.enfileirados.has(tarefa.id)) return;
      ref.enfileirados.add(tarefa.id);
      ref.fila.push(tarefa.id);
      atualizar(tarefa.id, { situacao: 'esperando' });
      entrouAlguma = true;
    });
    if (entrouAlguma) girar();
  }, [tarefas, girar, atualizar]);

  useEffect(() => {
    const ref = controle.current;
    ref.desmontado = false;
    return () => {
      ref.desmontado = true;
      clearTimeout(ref.temporizador);
      try {
        ref.fonte?.close();
      } catch {
        // já fechou
      }
      ref.fonte = null;
      ref.rodando = false;
    };
  }, []);

  return textos;
}
