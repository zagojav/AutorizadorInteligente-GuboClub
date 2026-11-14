// /painel — tela ao vivo. Nenhuma animação depende de scroll aqui.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePainel } from '../ganchos/usePainel.js';
import { CONSULTA_CELULAR, useMidia } from '../ganchos/useMidia.js';
import { useTextosDaIa } from '../servicos/stream.js';
import { CONVENIOS } from '../servicos/api.js';
import { Topo } from '../componentes/Topo.jsx';
import { Controles } from '../componentes/Controles.jsx';
import { ColunaConvenio } from '../componentes/ColunaConvenio.jsx';
import { TarefasHumanas } from '../componentes/TarefasHumanas.jsx';
import { Auditor } from '../componentes/Auditor.jsx';
import { Metricas } from '../componentes/Metricas.jsx';
import { Conceitos } from '../componentes/Conceitos.jsx';
import { Rodape } from '../componentes/Rodape.jsx';
import { GavetaLinhaDoTempo } from '../componentes/GavetaLinhaDoTempo.jsx';
import { Dica } from '../componentes/Dica.jsx';

// O "Derrubar" mais destacado da tela é o do Jardim: é o botão da narrativa da demo.
const CONVENIO_EM_DESTAQUE = 'jardim';

export default function Painel() {
  const painel = usePainel();
  const {
    dados, erros, carregando, ocupado, anuncio, recemMudados, situacaoDoStream,
    resultadoDosCasos, filaPorConvenio, conveniosPorId, tarefasAbertas, auroraSemNumero, acoes,
  } = painel;

  const [idSelecionado, setIdSelecionado] = useState(null);
  const [abaAtiva, setAbaAtiva] = useState(CONVENIOS[0].id);
  const ehCelular = useMidia(CONSULTA_CELULAR);

  // Textos da IA de todas as tarefas abertas, transmitidos um por vez.
  const fluxosDeTexto = useTextosDaIa(tarefasAbertas);

  // Uma tarefa por solicitação (a mais recente), pra mostrar a sugestão no cartão certo.
  const tarefasPorSolicitacao = useMemo(() => {
    const mapa = new Map();
    tarefasAbertas.forEach((tarefa) => mapa.set(tarefa.solicitacao, tarefa));
    return mapa;
  }, [tarefasAbertas]);

  const solicitacaoSelecionada = useMemo(
    () => (dados.fila ?? []).find((item) => item.id === idSelecionado) ?? null,
    [dados.fila, idSelecionado],
  );

  const abrirLinhaDoTempo = useCallback((id) => setIdSelecionado(id), []);
  const fecharLinhaDoTempo = useCallback(() => setIdSelecionado(null), []);

  // Ações que as colunas recebem: as do hook mais as de interface.
  const acoesDaColuna = useMemo(
    () => ({ ...acoes, abrirLinhaDoTempo }),
    [acoes, abrirLinhaDoTempo],
  );

  // Trava o scroll do fundo enquanto a gaveta está aberta.
  useEffect(() => {
    if (!solicitacaoSelecionada) return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [solicitacaoSelecionada]);

  return (
    <div className="painel">
      <Topo situacaoDoStream={situacaoDoStream} />

      {/* Região única de anúncios: mudança de status, disjuntor, modo e falha de ação. */}
      <p className="oculto-visual" role="status" aria-live="polite">{anuncio}</p>

      <main>
        <Controles
          ocupado={ocupado}
          erroDeAcao={erros.acao}
          resultadoDosCasos={resultadoDosCasos}
          auroraSemNumero={auroraSemNumero}
          acoes={acoes}
        />

        <section className="secao" aria-labelledby="titulo-filas">
          <div className="secao__cabeca">
            <h2 className="secao__titulo" id="titulo-filas">
              Filas por convênio
              <Dica
                rotulo="fila isolada"
                texto="Cada convênio tem sua fila. Um caindo não trava os outros."
              />
            </h2>
            <span className="secao__nota">Clique numa solicitação pra ver a linha do tempo.</span>
          </div>

          {/* No celular as três colunas viram abas. */}
          <div className="abas" role="tablist" aria-label="Convênios">
            {CONVENIOS.map((convenio) => (
              <button
                key={convenio.id}
                type="button"
                role="tab"
                className="aba"
                aria-selected={abaAtiva === convenio.id}
                aria-controls={`coluna-${convenio.id}`}
                onClick={() => setAbaAtiva(convenio.id)}
              >
                {convenio.curto}
                <span className="num">({(filaPorConvenio[convenio.id] ?? []).length})</span>
              </button>
            ))}
          </div>

          <div className="colunas">
            {CONVENIOS.map((convenio) => (
              <ColunaConvenio
                key={convenio.id}
                convenio={convenio}
                estado={conveniosPorId.get(convenio.id)}
                modo={dados.saude?.modos?.[convenio.id] ?? 'normal'}
                metrica={dados.metricas?.por_convenio?.[convenio.id]}
                fila={dados.saude?.filas?.[convenio.id]}
                solicitacoes={filaPorConvenio[convenio.id] ?? []}
                tarefasPorSolicitacao={tarefasPorSolicitacao}
                fluxosDeTexto={fluxosDeTexto}
                destacarDerrubar={convenio.id === CONVENIO_EM_DESTAQUE}
                carregando={carregando}
                erro={erros.fila}
                erroDeSaude={erros.saude}
                ocupado={ocupado}
                idSelecionado={idSelecionado}
                recemMudados={recemMudados}
                acoes={acoesDaColuna}
                oculta={ehCelular && abaAtiva !== convenio.id}
              />
            ))}
          </div>
        </section>

        <TarefasHumanas
          tarefas={tarefasAbertas}
          fluxosDeTexto={fluxosDeTexto}
          carregando={carregando}
          erro={erros.tarefas}
          onAbrirSolicitacao={abrirLinhaDoTempo}
        />

        <Auditor auditoria={dados.auditoria} carregando={carregando} erro={erros.auditoria} />

        <Metricas metricas={dados.metricas} carregando={carregando} erro={erros.metricas} />

        <Conceitos />
      </main>

      <Rodape />

      {solicitacaoSelecionada ? (
        <GavetaLinhaDoTempo solicitacao={solicitacaoSelecionada} onFechar={fecharLinhaDoTempo} />
      ) : null}
    </div>
  );
}
