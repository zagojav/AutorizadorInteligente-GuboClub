// Cartão de uma solicitação. Clicar abre a linha do tempo na gaveta lateral.
// Memo + identidade estável no usePainel: só o cartão que mudou re-renderiza.
import { memo } from 'react';
import { SeloDeStatus } from './Selo.jsx';
import { TextoDaIa } from './TextoDaIa.jsx';
import { Dica } from './Dica.jsx';
import { IconeCerto, IconeDocumento, IconeGirando, IconeRelogio } from './Icones.jsx';

function formatarMs(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? `${Math.round(valor)} ms` : null;
}

export const CartaoSolicitacao = memo(function CartaoSolicitacao({
  solicitacao,
  tarefa,
  fluxoDaTarefa,
  selecionada,
  piscando,
  ocupado,
  onAbrir,
  onAnexarDocumento,
}) {
  const latencia = formatarMs(solicitacao.latencia_ms);
  const pendente = solicitacao.status === 'pendente_documento';
  const anexando = ocupado === `documento:${solicitacao.id}`;

  return (
    <li data-flip={solicitacao.id}>
      <div
        className={[
          'solicitacao',
          `solicitacao--${solicitacao.status}`,
          piscando ? 'solicitacao--mudou' : '',
        ].filter(Boolean).join(' ')}
        role="button"
        tabIndex={0}
        aria-current={selecionada ? 'true' : undefined}
        aria-label={`Solicitação ${solicitacao.id}, paciente ${solicitacao.paciente}. Abrir linha do tempo.`}
        onClick={() => onAbrir(solicitacao.id)}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter' || evento.key === ' ') {
            evento.preventDefault();
            onAbrir(solicitacao.id);
          }
        }}
      >
        <div className="solicitacao__linha1">
          <span className="solicitacao__id num">{solicitacao.id}</span>
          <SeloDeStatus status={solicitacao.status} />
        </div>

        <div>
          <div className="solicitacao__paciente">{solicitacao.paciente}</div>
          <div className="solicitacao__procedimento">
            {solicitacao.procedimento ? `Procedimento ${solicitacao.procedimento}` : 'Procedimento não informado'}
            {solicitacao.sintetica ? ' · sintética' : ''}
          </div>
        </div>

        {solicitacao.numero_autorizacao ? (
          <span className="solicitacao__numero num">
            <IconeCerto tamanho={13} />
            {solicitacao.numero_autorizacao}
          </span>
        ) : null}

        {solicitacao.motivo ? <p className="solicitacao__motivo">{solicitacao.motivo}</p> : null}

        <div className="solicitacao__meta">
          {solicitacao.regra_usada ? (
            <span>
              <IconeDocumento tamanho={11} /> regra {solicitacao.regra_usada}
            </span>
          ) : null}
          <span>
            <IconeGirando tamanho={11} /> {solicitacao.tentativas ?? 0} tentativa
            {(solicitacao.tentativas ?? 0) === 1 ? '' : 's'}
          </span>
          {latencia ? (
            <span>
              <IconeRelogio tamanho={11} /> {latencia}
            </span>
          ) : null}
        </div>
      </div>

      {/* Ações e sugestão ficam fora do botão: botão dentro de botão não é acessível. */}
      {pendente || tarefa ? (
        <div className="solicitacao__acoes">
          {pendente ? (
            <>
              <button
                type="button"
                className="botao botao--pequeno botao--marca"
                disabled={Boolean(ocupado)}
                onClick={() => onAnexarDocumento(solicitacao.id)}
              >
                <IconeDocumento tamanho={14} />
                {anexando ? 'Anexando...' : 'Anexar documento'}
              </button>
              <Dica
                rotulo="anexar documento"
                texto="Anexa o documento fictício do kit e reprocessa a solicitação. A regra do Horizonte exige documento antes de autorizar."
              />
            </>
          ) : null}
        </div>
      ) : null}

      {tarefa ? (
        <div className="sugestao">
          <TextoDaIa tarefa={tarefa} fluxo={fluxoDaTarefa} />
        </div>
      ) : null}
    </li>
  );
});
