// Estados de bloco: carregando (skeleton), vazio e erro. Todo bloco do painel usa estes
// três, então nenhuma seção fica em branco se o backend não responder.
import { memo } from 'react';
import { IconeAlerta } from './Icones.jsx';
import { ErroDeApi } from '../servicos/api.js';

export const Esqueleto = memo(function Esqueleto({ altura = 16, largura = '100%', raio }) {
  return (
    <span
      className="esqueleto"
      aria-hidden="true"
      style={{ display: 'block', height: altura, width: largura, borderRadius: raio }}
    />
  );
});

export const EstadoVazio = memo(function EstadoVazio({ titulo, children }) {
  return (
    <div className="estado">
      <span className="estado__titulo">{titulo}</span>
      {children ? <span>{children}</span> : null}
    </div>
  );
});

export const EstadoDeErro = memo(function EstadoDeErro({ titulo = 'Não foi possível carregar', erro }) {
  const mensagem = erro instanceof ErroDeApi ? erro.message : String(erro?.message ?? erro ?? '');
  return (
    <div className="estado estado--erro" role="status">
      <span className="estado__titulo">
        <IconeAlerta tamanho={14} /> {titulo}
      </span>
      <span>{mensagem}</span>
    </div>
  );
});

/**
 * Decide o que renderizar a partir do trio carregando/erro/vazio.
 * Mantém a mesma hierarquia de estados em todos os blocos, sem repetir if em cada um.
 */
export function Bloco({ carregando, erro, vazio, esqueleto, tituloVazio, dicaVazio, children }) {
  if (carregando) return esqueleto ?? <Esqueleto altura={80} />;
  if (erro) return <EstadoDeErro erro={erro} />;
  if (vazio) return <EstadoVazio titulo={tituloVazio ?? 'Nada por aqui ainda'}>{dicaVazio}</EstadoVazio>;
  return children;
}
