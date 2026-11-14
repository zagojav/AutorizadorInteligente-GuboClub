// Cartão do convênio: integração, disjuntor, falhas seguidas, latência e fila.
// O botão Derrubar/Restaurar troca conforme o modo, que vem do /api/saude.
import { memo } from 'react';
import { Dica } from './Dica.jsx';
import { Selo } from './Selo.jsx';
import { Esqueleto, EstadoDeErro } from './Estado.jsx';
import { IconeAlerta, IconeCerto, IconeChave, IconeEscudo, IconeFila, IconeGirando, IconeRelogio } from './Icones.jsx';

const INTEGRACAO = {
  ok: { rotulo: 'Integração no ar', tom: 'verde', Icone: IconeCerto },
  degradado: { rotulo: 'Integração instável', tom: 'ambar', Icone: IconeAlerta },
  fora: { rotulo: 'Integração fora do ar', tom: 'vermelho', Icone: IconeAlerta },
};

const DISJUNTOR = {
  fechado: { rotulo: 'Disjuntor fechado', detalhe: 'as chamadas estão passando' },
  meio_aberto: { rotulo: 'Disjuntor meio aberto', detalhe: 'uma chamada de teste liberada' },
  aberto: { rotulo: 'Disjuntor aberto', detalhe: 'não chama o convênio, vai pro humano' },
};

// Estado que a tela não conhece: diz que não sabe, em vez de chutar verde ou vermelho.
const INTEGRACAO_DESCONHECIDA = { rotulo: 'Integração: estado desconhecido', tom: 'neutro', Icone: IconeAlerta };
const DISJUNTOR_DESCONHECIDO = { rotulo: 'Disjuntor em estado desconhecido', detalhe: 'valor não previsto pela tela' };

const MODO = {
  normal: { rotulo: 'Modo normal', tom: 'contorno' },
  caos: { rotulo: 'Modo caos', tom: 'vermelho' },
  sem_numero: { rotulo: 'Modo sem número', tom: 'ambar' },
};

// Mostra "—" em vez de 0 quando a métrica ainda não existe: nada de número inventado.
function formatarMs(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? `${Math.round(valor)} ms` : '—';
}

export const CartaoConvenio = memo(function CartaoConvenio({
  convenio,
  estado,
  modo,
  metrica,
  fila,
  destacarDerrubar,
  carregando,
  erro,
  ocupado,
  onDerrubar,
  onRestaurar,
}) {
  // Sem estado: ou ainda está carregando, ou o /api/saude não respondeu.
  // São coisas diferentes e a tela precisa dizer qual é.
  if (!estado) {
    return (
      <article className={`cartao convenio${erro ? ' convenio--fora' : ''}`} aria-busy={carregando || undefined}>
        <div className="convenio__cabeca">
          <IconeEscudo tamanho={20} className="convenio__icone" titulo={`Convênio ${convenio.nome}`} />
          <div style={{ minWidth: 0 }}>
            <h3 className="convenio__nome">{convenio.nome}</h3>
            <span className="convenio__id">
              {carregando ? 'carregando estado...' : 'estado indisponível'}
            </span>
          </div>
        </div>
        {carregando ? (
          <>
            <Esqueleto altura={56} raio="10px" />
            <Esqueleto altura={54} raio="10px" />
          </>
        ) : (
          <EstadoDeErro
            titulo="Sem estado deste convênio"
            erro={erro ?? { message: 'A consulta a /api/saude não trouxe este convênio.' }}
          />
        )}
      </article>
    );
  }

  const integracao = INTEGRACAO[estado.status_integracao] ?? INTEGRACAO_DESCONHECIDA;
  const disjuntor = DISJUNTOR[estado.disjuntor] ?? DISJUNTOR_DESCONHECIDO;
  const infoDoModo = MODO[modo] ?? MODO.normal;
  const derrubado = modo === 'caos';
  const acaoOcupada = ocupado === `derrubar:${convenio.id}` || ocupado === `restaurar:${convenio.id}`;

  return (
    <article className={`cartao convenio convenio--${INTEGRACAO[estado.status_integracao] ? estado.status_integracao : 'desconhecido'}`}>
      <div className="convenio__cabeca">
        <IconeEscudo tamanho={20} className="convenio__icone" titulo={`Convênio ${convenio.nome}`} />
        <div style={{ minWidth: 0 }}>
          <h3 className="convenio__nome">{convenio.nome}</h3>
          <span className="convenio__id">fila isolada · tempo limite {formatarMs(estado.tempo_limite_ms)}</span>
        </div>
      </div>

      <div className="convenio__selos">
        <Selo tom={integracao.tom} Icone={integracao.Icone}>{integracao.rotulo}</Selo>
        <Selo tom={infoDoModo.tom}>{infoDoModo.rotulo}</Selo>
      </div>

      {/* Disjuntor: a chave gira 90 graus quando abre. */}
      <div className={`disjuntor disjuntor--${estado.disjuntor}`}>
        <span className="disjuntor__chave">
          <IconeChave tamanho={22} titulo={disjuntor.rotulo} />
        </span>
        <span className="disjuntor__texto">
          <span className="disjuntor__estado">
            {disjuntor.rotulo}
            <Dica
              rotulo="o disjuntor"
              texto="Depois de 3 falhas seguidas, para de chamar o convênio e manda direto pro humano."
            />
          </span>
          <span className="disjuntor__detalhe">{disjuntor.detalhe}</span>
        </span>
      </div>

      <div className="medidores">
        <div className="medidor">
          <span className="medidor__valor num">{estado.falhas_seguidas ?? 0}</span>
          <span className="medidor__rotulo">
            <IconeAlerta tamanho={11} /> falhas seguidas · abre em 3
          </span>
        </div>
        <div className="medidor">
          <span className="medidor__valor num">{formatarMs(metrica?.latencia_p50_ms)}</span>
          <span className="medidor__rotulo">
            <IconeRelogio tamanho={11} /> latência p50
          </span>
        </div>
        <div className="medidor">
          {/* Logo depois do boot o backend devolve filas {}: ausência é fila zerada. */}
          <span className="medidor__valor num">{fila?.na_fila ?? 0}</span>
          <span className="medidor__rotulo">
            {fila?.processando ? <IconeGirando tamanho={11} /> : <IconeFila tamanho={11} />}
            {fila?.processando ? 'na fila · ativo' : 'na fila'}
          </span>
        </div>
      </div>

      <div className="convenio__acoes">
        {derrubado ? (
          <button
            type="button"
            className="botao botao--pequeno"
            disabled={acaoOcupada}
            onClick={() => onRestaurar(convenio.id)}
          >
            <IconeCerto tamanho={14} />
            {acaoOcupada ? 'Restaurando...' : `Restaurar ${convenio.curto}`}
          </button>
        ) : (
          <button
            type="button"
            className={`botao botao--pequeno${destacarDerrubar ? ' botao--perigo botao--destaque' : ' botao--discreto'}`}
            disabled={acaoOcupada}
            onClick={() => onDerrubar(convenio.id)}
          >
            <IconeAlerta tamanho={14} />
            {acaoOcupada ? 'Derrubando...' : `Derrubar ${convenio.curto}`}
          </button>
        )}
        {destacarDerrubar ? (
          <Dica
            rotulo="derrubar o convênio"
            texto="Coloca a API simulada deste convênio em modo caos (erro 503 ou demora acima do tempo limite). As filas dos outros convênios continuam andando."
          />
        ) : null}
      </div>
    </article>
  );
});
