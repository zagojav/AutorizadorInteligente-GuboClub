// Texto de encaminhamento da tarefa, chegando token por token.
// Componente só de apresentação: quem transmite é a fila em servicos/stream.js
// (uma tarefa por vez, pra não estourar o limite de conexões do navegador).
// O selo diz de onde o texto veio: "Redigido por IA" ou "Texto padrão".
import { memo } from 'react';
import { Selo } from './Selo.jsx';
import { IconeDocumento, IconeGirando, IconePessoa } from './Icones.jsx';

function seloDaOrigem(origem) {
  if (origem === 'ia') return { rotulo: 'Redigido por IA', tom: 'marca', Icone: IconeDocumento };
  if (origem === 'template') return { rotulo: 'Texto padrão', tom: 'contorno', Icone: IconeDocumento };
  return null;
}

export const TextoDaIa = memo(function TextoDaIa({ tarefa, fluxo }) {
  // Preferimos o que está chegando agora; sem stream, o que o banco já tem.
  const texto = fluxo?.texto || tarefa?.texto_ia || '';
  const origem = fluxo?.origem ?? tarefa?.origem_texto ?? null;
  const selo = seloDaOrigem(origem);
  const fluindo = fluxo?.situacao === 'fluindo';
  const esperando = fluxo?.situacao === 'esperando';

  return (
    <div>
      <div className="tarefa__cabeca" style={{ marginBottom: 'var(--esp-2)' }}>
        <span className="etiqueta">
          <IconePessoa tamanho={11} /> Encaminhamento sugerido
        </span>
        {selo ? <Selo tom={selo.tom} Icone={selo.Icone}>{selo.rotulo}</Selo> : null}
        {(fluindo || esperando) && !selo ? (
          <Selo tom="contorno" Icone={IconeGirando}>{esperando ? 'na fila' : 'redigindo'}</Selo>
        ) : null}
      </div>

      {/* aria-live off: senão o leitor de tela repetiria o parágrafo a cada token. */}
      <p className="tarefa__texto" aria-live="off">
        {texto}
        {fluindo ? <span className="cursor" aria-hidden="true" /> : null}
        {!texto && !fluindo && !esperando ? (
          <span style={{ color: 'var(--tinta-3)' }}>Sem texto de encaminhamento disponível.</span>
        ) : null}
      </p>

      {/* Versão final anunciada uma vez só. */}
      {!fluindo && texto ? <span className="oculto-visual" role="status">{texto}</span> : null}
    </div>
  );
});
