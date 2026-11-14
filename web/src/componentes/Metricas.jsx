// Métricas da simulação. Todo número vem do /api/metricas: nada é inventado aqui.
// Cada cartão leva a etiqueta "simulado" e o valor é interpolado quando muda.
import { memo } from 'react';
import { Bloco, Esqueleto } from './Estado.jsx';
import { Dica } from './Dica.jsx';
import { Selo } from './Selo.jsx';
import { useContadorAnimado } from '../ganchos/animacoes.js';
import { IconeGrafico } from './Icones.jsx';

// "—" em vez de 0 quando a métrica ainda não tem base: número ausente não é zero.
function Valor({ valor, sufixo }) {
  const animado = useContadorAnimado(valor);
  if (valor === null || valor === undefined || valor === 'pendente') {
    return <span className="metrica__valor num">—</span>;
  }
  return (
    <span className="metrica__valor num">
      {animado}
      {sufixo ? <span style={{ fontSize: '0.45em', fontWeight: 600, marginLeft: 3 }}>{sufixo}</span> : null}
    </span>
  );
}

const Metrica = memo(function Metrica({ rotulo, valor, sufixo, dica }) {
  return (
    <div className="metrica">
      <Valor valor={valor} sufixo={sufixo} />
      <span className="metrica__rotulo">
        {rotulo}
        <Selo tom="contorno">simulado</Selo>
        {dica ? <Dica rotulo={rotulo} texto={dica} /> : null}
      </span>
    </div>
  );
});

export const Metricas = memo(function Metricas({ metricas, carregando, erro }) {
  return (
    <section className="secao" aria-labelledby="titulo-metricas">
      <div className="secao__cabeca">
        <h2 className="secao__titulo" id="titulo-metricas">
          <IconeGrafico tamanho={17} /> Métricas da simulação
        </h2>
        <span className="secao__nota">
          Números da API simulada, não de atendimento real.
        </span>
      </div>

      {/* aria-live polite: a mudança dos números é anunciada sem interromper. */}
      <div aria-live="polite">
        <Bloco
          carregando={carregando}
          erro={erro}
          vazio={!metricas}
          esqueleto={(
            <div className="metricas">
              {[0, 1, 2, 3, 4, 5].map((indice) => <Esqueleto key={indice} altura={104} raio="16px" />)}
            </div>
          )}
          tituloVazio="Sem métricas ainda"
          dicaVazio="Inicie a fila pra o motor gerar chamadas e latências."
        >
          <div className="metricas">
            <Metrica
              rotulo="falhas detectadas"
              valor={metricas?.falhas_detectadas}
              dica="Chamadas que falharam somadas às solicitações que o disjuntor barrou antes de chamar o convênio."
            />
            <Metrica
              rotulo="latência p50"
              valor={metricas?.latencia_p50_ms}
              sufixo="ms"
              dica="Metade das chamadas à API simulada respondeu abaixo deste tempo."
            />
            <Metrica
              rotulo="latência p95"
              valor={metricas?.latencia_p95_ms}
              sufixo="ms"
              dica="95% das chamadas responderam abaixo deste tempo. É aqui que a cauda lenta aparece."
            />
            <Metrica
              rotulo="encaminhamentos corretos"
              valor={metricas?.encaminhamentos_corretos}
              dica="Casos do kit que terminaram no estado que o próprio kit esperava."
            />
            <Metrica
              rotulo="casos do kit"
              valor={metricas?.casos_kit}
              dica="Resultado da última execução dos 4 casos. Rode pelo botão 'Rodar 4 casos'."
            />
            <Metrica
              rotulo="tarefas abertas"
              valor={metricas?.tarefas_abertas}
              dica="Exceções esperando uma pessoa. Cada uma tem motivo escrito e linha do tempo."
            />
          </div>
        </Bloco>
      </div>
    </section>
  );
});
