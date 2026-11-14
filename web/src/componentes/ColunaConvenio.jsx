// Uma coluna por convênio: cartão do convênio no topo e as solicitações embaixo.
// A lista usa FLIP: quando um cartão muda de status e muda de altura, os vizinhos
// deslizam em vez de pular.
import { memo, useMemo, useRef } from 'react';
import { CartaoConvenio } from './CartaoConvenio.jsx';
import { CartaoSolicitacao } from './CartaoSolicitacao.jsx';
import { Bloco, Esqueleto } from './Estado.jsx';
import { useFlipDeLista } from '../ganchos/animacoes.js';

export const ColunaConvenio = memo(function ColunaConvenio({
  convenio,
  estado,
  modo,
  metrica,
  fila,
  solicitacoes,
  tarefasPorSolicitacao,
  fluxosDeTexto,
  destacarDerrubar,
  carregando,
  erro,
  erroDeSaude,
  ocupado,
  idSelecionado,
  recemMudados,
  acoes,
  oculta,
}) {
  const refLista = useRef(null);

  // A chave muda quando qualquer status muda: é o gatilho do FLIP.
  const chaveDaOrdem = useMemo(
    () => solicitacoes.map((item) => `${item.id}:${item.status}`).join('|'),
    [solicitacoes],
  );
  useFlipDeLista(refLista, chaveDaOrdem);

  return (
    <div
      className="coluna"
      id={`coluna-${convenio.id}`}
      hidden={oculta}
      role="group"
      aria-label={`Convênio ${convenio.nome}`}
    >
      <CartaoConvenio
        convenio={convenio}
        estado={estado}
        modo={modo}
        metrica={metrica}
        fila={fila}
        destacarDerrubar={destacarDerrubar}
        carregando={carregando}
        erro={erroDeSaude}
        ocupado={ocupado}
        onDerrubar={acoes.derrubar}
        onRestaurar={acoes.restaurar}
      />

      <Bloco
        carregando={carregando}
        erro={erro}
        vazio={solicitacoes.length === 0}
        esqueleto={<Esqueleto altura={120} raio="10px" />}
        tituloVazio="Nenhuma solicitação deste convênio"
        dicaVazio="Clique em Iniciar fila ou Gerar carga pra ver as solicitações entrarem."
      >
        <ul className="solicitacoes" ref={refLista}>
          {solicitacoes.map((solicitacao) => {
            const tarefa = tarefasPorSolicitacao.get(solicitacao.id);
            return (
              <CartaoSolicitacao
                key={solicitacao.id}
                solicitacao={solicitacao}
                tarefa={tarefa}
                fluxoDaTarefa={tarefa ? fluxosDeTexto[tarefa.id] : undefined}
                selecionada={idSelecionado === solicitacao.id}
                piscando={recemMudados.has(solicitacao.id)}
                ocupado={ocupado}
                onAbrir={acoes.abrirLinhaDoTempo}
                onAnexarDocumento={acoes.anexarDocumento}
              />
            );
          })}
        </ul>
      </Bloco>
    </div>
  );
});
