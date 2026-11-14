// Peças visuais da abertura. São desenhos, não dados: nenhuma delas chama a API.
// Cada fichinha tem uma base cinza e camadas coloridas por cima, porque a animação
// só pode mexer em opacity e transform.
import { memo } from 'react';
import { IconeChave, IconePessoa } from './Icones.jsx';

export const Fichinha = memo(function Fichinha({ tom = 'verde', rotulo, podeCair }) {
  return (
    <div className="fichinha" data-fichinha aria-hidden="true">
      <span className={`fichinha__cor fichinha__cor--${tom}`} data-cor />
      {/* Camada que "acende" quando o convênio cai. Começa invisível. */}
      {podeCair ? <span className="fichinha__queda" data-queda /> : null}
      <span className="fichinha__conteudo">
        <span className="fichinha__rotulo">{rotulo}</span>
        <span className="fichinha__barra" />
        <span className="fichinha__barra fichinha__barra--curta" />
      </span>
    </div>
  );
});

// Uma trilha de convênio da cena 3.
export const TrilhoConvenio = memo(function TrilhoConvenio({
  nome, estado, tom, quantidade, chaveAbre, indice,
}) {
  return (
    <div className="trilho-convenio" data-trilho={indice}>
      <span className="trilho-convenio__rotulo">
        <span className="trilho-convenio__nome">{nome}</span>
        <span className="trilho-convenio__estado">{estado}</span>
      </span>

      <span className={`chave${chaveAbre ? ' chave--abre' : ''}`} data-chave={chaveAbre ? 'abre' : 'fecha'}>
        <IconeChave tamanho={26} />
      </span>

      <span className="trilho__linha" data-linha>
        {Array.from({ length: quantidade }, (_, posicao) => (
          <Fichinha key={posicao} tom={tom} rotulo={`${nome.slice(0, 3).toUpperCase()}-${posicao + 1}`} />
        ))}
      </span>
    </div>
  );
});

// Destino humano da cena 3.
export const DestinoHumano = memo(function DestinoHumano() {
  return (
    <span className="humano" data-humano aria-hidden="true">
      <IconePessoa tamanho={28} />
      <span className="humano__rotulo">Tarefa humana</span>
    </span>
  );
});

// Miniatura do painel usada no mergulho da cena 5. É um desenho do layout real.
export const MiniPainel = memo(function MiniPainel() {
  const colunas = [
    { tom: 'verde', fichas: ['verde', 'verde', 'verde'] },
    { tom: 'ambar', fichas: ['ambar', 'verde', 'ambar'] },
    { tom: 'vermelho', fichas: ['vermelho', 'vermelho', 'vermelho'] },
  ];

  return (
    <div className="minipainel" data-minipainel aria-hidden="true">
      <div className="minipainel__topo">
        <span className="minipainel__titulo">Autorizador Inteligente</span>
        <span className="minipainel__selo">ao vivo</span>
      </div>
      <div className="minipainel__colunas">
        {colunas.map((coluna, indiceColuna) => (
          <div className="minipainel__coluna" key={indiceColuna}>
            <span className={`minipainel__cabeca minipainel__cabeca--${coluna.tom}`} />
            {coluna.fichas.map((ficha, indiceFicha) => (
              <span className={`minipainel__ficha minipainel__ficha--${ficha}`} key={indiceFicha} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});
