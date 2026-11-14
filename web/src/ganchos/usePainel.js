// Estado do painel: carga inicial em paralelo, atualização incremental pelo SSE e
// disparo das ações. Nenhum estado de botão é local: modo e disjuntor vêm sempre do
// /api/saude e dos eventos do stream (POST /api/fila/iniciar reseta os modos no backend).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../servicos/api.js';
import { useStreamDeEventos } from '../servicos/stream.js';

// Campos da solicitação que a tela mostra. Usados pra decidir se o cartão mudou de fato
// (se não mudou, mantemos a MESMA referência e o memo do cartão não re-renderiza).
const CAMPOS_VISIVEIS = [
  'status',
  'motivo',
  'regra_usada',
  'numero_autorizacao',
  'latencia_ms',
  'tentativas',
  'paciente',
  'procedimento',
  'convenio',
];

function igualNoVisivel(a, b) {
  if (!a || !b) return false;
  return CAMPOS_VISIVEIS.every((campo) => a[campo] === b[campo]);
}

// Mescla a lista nova mantendo a identidade dos objetos que não mudaram.
function mesclarFila(atual, nova) {
  if (!Array.isArray(nova)) return atual;
  const porId = new Map(atual.map((item) => [item.id, item]));
  let mudou = atual.length !== nova.length;
  const resultado = nova.map((linha, indice) => {
    const antiga = porId.get(linha.id);
    if (antiga && igualNoVisivel(antiga, linha)) {
      if (atual[indice] !== antiga) mudou = true;
      return antiga;
    }
    mudou = true;
    return linha;
  });
  return mudou ? resultado : atual;
}

// Executa uma leitura devolvendo {dados, erro} em vez de lançar: um bloco com 404 não
// derruba os outros na carga inicial.
async function tentar(executar) {
  try {
    return { dados: await executar(), erro: null };
  } catch (erro) {
    return { dados: null, erro };
  }
}

const SEM_DADOS = Object.freeze({ fila: null, saude: null, tarefas: null, auditoria: null, metricas: null });

export function usePainel() {
  const [dados, setDados] = useState(SEM_DADOS);
  const [erros, setErros] = useState(SEM_DADOS);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(null); // nome da ação em andamento
  const [resultadoDosCasos, setResultadoDosCasos] = useState(null);
  const [anuncio, setAnuncio] = useState('');
  // Ids que acabaram de mudar de status: o cartão pisca por 1,2 s.
  const [recemMudados, setRecemMudados] = useState(() => new Set());

  const temporizadores = useRef({ fila: null, saude: null, confirmacao: null, piscadas: new Map() });
  const ultimaMudancaDeEstado = useRef(0);

  /* ---------------- Carga inicial (em paralelo) ---------------- */
  const recarregarTudo = useCallback(async () => {
    const [fila, saude, tarefas, auditoria, metricas] = await Promise.all([
      tentar(api.buscarFila),
      tentar(api.buscarSaude),
      tentar(api.buscarTarefas),
      tentar(api.buscarAuditoria),
      tentar(api.buscarMetricas),
    ]);
    setDados((atual) => ({
      fila: fila.dados ? mesclarFila(atual.fila ?? [], fila.dados) : atual.fila,
      saude: saude.dados ?? atual.saude,
      tarefas: tarefas.dados ?? atual.tarefas,
      auditoria: auditoria.dados ?? atual.auditoria,
      metricas: metricas.dados ?? atual.metricas,
    }));
    setErros({
      fila: fila.erro,
      saude: saude.erro,
      tarefas: tarefas.erro,
      auditoria: auditoria.erro,
      metricas: metricas.erro,
    });
    setCarregando(false);
  }, []);

  useEffect(() => {
    recarregarTudo();
  }, [recarregarTudo]);

  // Limpa tudo que ficou pendurado no desmonte.
  useEffect(() => () => {
    const atuais = temporizadores.current;
    clearTimeout(atuais.fila);
    clearTimeout(atuais.saude);
    clearTimeout(atuais.confirmacao);
    atuais.piscadas.forEach((id) => clearTimeout(id));
    atuais.piscadas.clear();
  }, []);

  /* ---------------- Recargas com atraso ---------------- */
  // O SSE não traz todos os campos (tentativas, paciente das sintéticas novas), então
  // depois da rajada de eventos reconciliamos com um GET. Com atraso pra não pedir
  // /api/fila a cada token de evento.
  const recarregarFilaEmBreve = useCallback((atrasoMs = 700) => {
    clearTimeout(temporizadores.current.fila);
    temporizadores.current.fila = setTimeout(async () => {
      const { dados: lista, erro } = await tentar(api.buscarFila);
      if (erro) return;
      setDados((atual) => ({ ...atual, fila: mesclarFila(atual.fila ?? [], lista) }));
      setErros((atual) => ({ ...atual, fila: null }));
    }, atrasoMs);
  }, []);

  const recarregarSaudeEmBreve = useCallback((atrasoMs = 400) => {
    clearTimeout(temporizadores.current.saude);
    temporizadores.current.saude = setTimeout(async () => {
      const { dados: saude, erro } = await tentar(api.buscarSaude);
      if (erro) return;
      setDados((atual) => ({ ...atual, saude }));
      setErros((atual) => ({ ...atual, saude: null }));
    }, atrasoMs);
  }, []);

  const recarregarTarefasEmBreve = useCallback((atrasoMs = 500) => {
    setTimeout(async () => {
      const { dados: tarefas, erro } = await tentar(api.buscarTarefas);
      if (erro) return;
      setDados((atual) => ({ ...atual, tarefas }));
      setErros((atual) => ({ ...atual, tarefas: null }));
    }, atrasoMs);
  }, []);

  const piscar = useCallback((id) => {
    setRecemMudados((atual) => new Set(atual).add(id));
    const anterior = temporizadores.current.piscadas.get(id);
    if (anterior) clearTimeout(anterior);
    const temporizador = setTimeout(() => {
      setRecemMudados((atual) => {
        const copia = new Set(atual);
        copia.delete(id);
        return copia;
      });
      temporizadores.current.piscadas.delete(id);
    }, 1200);
    temporizadores.current.piscadas.set(id, temporizador);
  }, []);

  /* ---------------- Eventos do stream ---------------- */
  const manipuladores = useMemo(() => ({
    solicitacao_atualizada: (evento) => {
      let conhecida = false;
      setDados((atual) => {
        const fila = atual.fila ?? [];
        const indice = fila.findIndex((item) => item.id === evento.id);
        if (indice === -1) return atual;
        conhecida = true;
        const antiga = fila[indice];
        const nova = {
          ...antiga,
          status: evento.status ?? antiga.status,
          motivo: evento.motivo ?? antiga.motivo,
          regra_usada: evento.regra_usada ?? antiga.regra_usada,
          numero_autorizacao: evento.numero_autorizacao ?? antiga.numero_autorizacao,
          latencia_ms: evento.latencia_ms ?? antiga.latencia_ms,
        };
        if (igualNoVisivel(antiga, nova)) return atual;
        // Troca só o cartão que mudou: o resto do array mantém a identidade.
        const copia = fila.slice();
        copia[indice] = nova;
        return { ...atual, fila: copia };
      });

      if (evento.status && evento.status !== evento.status_de) {
        piscar(evento.id);
        setAnuncio(`${evento.id}: ${evento.status?.replace(/_/g, ' ')}.`);
      }
      // Id desconhecido = solicitação sintética nova; busca a lista completa.
      recarregarFilaEmBreve(conhecida ? 900 : 300);
    },

    disjuntor_mudou: (evento) => {
      ultimaMudancaDeEstado.current = Date.now();
      setDados((atual) => {
        if (!atual.saude?.convenios) return atual;
        const convenios = atual.saude.convenios.map((convenio) => (
          convenio.id === evento.convenio ? { ...convenio, disjuntor: evento.para } : convenio
        ));
        return { ...atual, saude: { ...atual.saude, convenios } };
      });
      setAnuncio(`Disjuntor de ${evento.nome ?? evento.convenio}: ${String(evento.para).replace('_', ' ')}.`);
      recarregarSaudeEmBreve();
    },

    // O backend pode mandar {convenio, modo} ou {convenio, de, para}: aceitamos os dois.
    modo_mudou: (evento) => {
      ultimaMudancaDeEstado.current = Date.now();
      const modo = evento.modo ?? evento.para;
      setDados((atual) => {
        if (!atual.saude) return atual;
        return { ...atual, saude: { ...atual.saude, modos: { ...atual.saude.modos, [evento.convenio]: modo } } };
      });
      setAnuncio(`Modo de ${evento.convenio}: ${String(modo).replace('_', ' ')}.`);
      recarregarSaudeEmBreve();
    },

    tarefa_criada: (evento) => {
      setDados((atual) => {
        const tarefas = atual.tarefas ?? [];
        if (tarefas.some((tarefa) => tarefa.id === evento.id)) return atual;
        return {
          ...atual,
          tarefas: [...tarefas, {
            id: evento.id,
            solicitacao: evento.solicitacao,
            motivo: evento.motivo,
            prioridade: evento.prioridade,
            prazo: evento.prazo,
            texto_ia: null,
            origem_texto: null,
            status: 'aberta',
          }],
        };
      });
      setAnuncio(`Nova tarefa humana para ${evento.solicitacao}.`);
    },

    metricas: (evento) => {
      setDados((atual) => ({ ...atual, metricas: evento }));
      setErros((atual) => ({ ...atual, metricas: null }));
    },
  }), [piscar, recarregarFilaEmBreve, recarregarSaudeEmBreve]);

  const situacaoDoStream = useStreamDeEventos(manipuladores);

  /* ---------------- Ações ---------------- */
  // Confere, 1 s depois do POST, se o evento chegou. Se não chegou, refaz o GET /api/saude.
  const conferirEstadoDepoisDoPost = useCallback(() => {
    const marca = Date.now();
    clearTimeout(temporizadores.current.confirmacao);
    temporizadores.current.confirmacao = setTimeout(() => {
      if (ultimaMudancaDeEstado.current < marca) recarregarSaudeEmBreve(0);
    }, 1000);
  }, [recarregarSaudeEmBreve]);

  // Envelope único das ações: marca o botão como ocupado (sem clique duplo) e guarda o erro.
  const executarAcao = useCallback(async (nome, acao) => {
    setOcupado(nome);
    try {
      return await acao();
    } catch (erro) {
      setErros((atual) => ({ ...atual, acao: erro }));
      setAnuncio(`A ação falhou: ${erro.message}`);
      return null;
    } finally {
      setOcupado(null);
    }
  }, []);

  const acoes = useMemo(() => ({
    iniciarFila: () => executarAcao('iniciarFila', async () => {
      setErros((atual) => ({ ...atual, acao: null }));
      await api.iniciarFila();
      setAnuncio('Fila iniciada. Modos voltaram ao padrão do kit.');
      await recarregarTudo();
    }),

    gerarCarga: () => executarAcao('gerarCarga', async () => {
      const resposta = await api.gerarCarga();
      setAnuncio(`Carga gerada: ${resposta?.criadas ?? 0} solicitações sintéticas.`);
      recarregarFilaEmBreve(400);
    }),

    rodarTestes: () => executarAcao('rodarTestes', async () => {
      const resultado = await api.rodarTestes();
      setResultadoDosCasos(resultado);
      setAnuncio(`Casos do kit: ${resultado?.passaram ?? 0} de ${resultado?.total ?? 0}.`);
      const { dados: metricas } = await tentar(api.buscarMetricas);
      if (metricas) setDados((atual) => ({ ...atual, metricas }));
    }),

    // Alterna o modo 'sem_numero' da Aurora e reprocessa a DEMO-R1 pra mostrar a trava.
    alternarAuroraSemNumero: (ligado) => executarAcao('auroraSemNumero', async () => {
      await api.definirModo('aurora', ligado ? 'sem_numero' : 'normal');
      conferirEstadoDepoisDoPost();
      await api.reprocessar('DEMO-R1');
      recarregarFilaEmBreve(200);
      recarregarTarefasEmBreve(400);
    }),

    derrubar: (convenio) => executarAcao(`derrubar:${convenio}`, async () => {
      await api.derrubarConvenio(convenio);
      conferirEstadoDepoisDoPost();
      setAnuncio(`${convenio} derrubado: a API simulada passa a responder erro.`);
    }),

    restaurar: (convenio) => executarAcao(`restaurar:${convenio}`, async () => {
      await api.restaurarConvenio(convenio);
      conferirEstadoDepoisDoPost();
      setAnuncio(`${convenio} restaurado: disjuntor fechado e falhas zeradas.`);
    }),

    anexarDocumento: (id) => executarAcao(`documento:${id}`, async () => {
      await api.anexarDocumento(id);
      recarregarFilaEmBreve(200);
      recarregarTarefasEmBreve(300);
      setAnuncio(`Documento anexado em ${id}.`);
    }),

    reprocessar: (id) => executarAcao(`reprocessar:${id}`, async () => {
      await api.reprocessar(id);
      recarregarFilaEmBreve(200);
      recarregarTarefasEmBreve(300);
    }),
  }), [executarAcao, conferirEstadoDepoisDoPost, recarregarFilaEmBreve, recarregarTarefasEmBreve, recarregarTudo]);

  /* ---------------- Derivados ---------------- */
  // Solicitações agrupadas por convênio, na ordem do backend (kit primeiro, sintéticas depois).
  const filaPorConvenio = useMemo(() => {
    const mapa = Object.fromEntries(api.CONVENIOS.map((convenio) => [convenio.id, []]));
    (dados.fila ?? []).forEach((solicitacao) => {
      if (!mapa[solicitacao.convenio]) mapa[solicitacao.convenio] = [];
      mapa[solicitacao.convenio].push(solicitacao);
    });
    return mapa;
  }, [dados.fila]);

  const conveniosPorId = useMemo(() => {
    const mapa = new Map();
    (dados.saude?.convenios ?? []).forEach((convenio) => mapa.set(convenio.id, convenio));
    return mapa;
  }, [dados.saude]);

  const tarefasAbertas = useMemo(
    () => (dados.tarefas ?? []).filter((tarefa) => tarefa.status === 'aberta'),
    [dados.tarefas],
  );

  const auroraSemNumero = dados.saude?.modos?.aurora === 'sem_numero';

  return {
    dados,
    erros,
    carregando,
    ocupado,
    anuncio,
    recemMudados,
    situacaoDoStream,
    resultadoDosCasos,
    filaPorConvenio,
    conveniosPorId,
    tarefasAbertas,
    auroraSemNumero,
    acoes,
    recarregarTudo,
  };
}
