// Topo fixo do painel: identidade, selo de dados sintéticos e indicador "ao vivo".
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Selo } from './Selo.jsx';
import { IconeEscudo } from './Icones.jsx';

const TEXTO_DA_SITUACAO = {
  ao_vivo: 'ao vivo',
  conectando: 'conectando',
  reconectando: 'reconectando',
};

export const Topo = memo(function Topo({ situacaoDoStream }) {
  const ligado = situacaoDoStream === 'ao_vivo';

  return (
    <header className="topo">
      <div className="topo__interno">
        <div className="topo__marca">
          <h1 className="topo__titulo">Autorizador Inteligente</h1>
          <span className="topo__equipe">Gubo Club</span>
        </div>

        <div className="topo__selos">
          <Selo tom="contorno" Icone={IconeEscudo}>Dados sintéticos · métricas simuladas</Selo>

          {/* aria-live: leitor de tela ouve quando a conexão cai ou volta. */}
          <span
            className={`aovivo${ligado ? ' aovivo--ligado' : ''}`}
            role="status"
            aria-live="polite"
          >
            <span className="aovivo__ponto" />
            {TEXTO_DA_SITUACAO[situacaoDoStream] ?? 'sem conexão'}
          </span>

          <Link className="botao botao--pequeno" to="/">Ver a abertura</Link>
        </div>
      </div>
    </header>
  );
});
