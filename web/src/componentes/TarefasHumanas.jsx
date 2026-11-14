// Tarefas humanas abertas. Cada uma mostra o texto de encaminhamento chegando token por
// token, com o selo da origem. A exceção é humana: é esse o ponto da tela.
import { memo } from 'react';
import { Bloco, Esqueleto } from './Estado.jsx';
import { Selo } from './Selo.jsx';
import { TextoDaIa } from './TextoDaIa.jsx';
import { Dica } from './Dica.jsx';
import { IconeAlerta, IconePessoa, IconeRelogio } from './Icones.jsx';

function formatarPrazo(iso) {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export const TarefasHumanas = memo(function TarefasHumanas({
  tarefas,
  fluxosDeTexto,
  carregando,
  erro,
  onAbrirSolicitacao,
}) {
  return (
    <section className="secao" aria-labelledby="titulo-tarefas">
      <div className="secao__cabeca">
        <h2 className="secao__titulo" id="titulo-tarefas">
          <IconePessoa tamanho={17} /> Tarefas humanas
          <Dica
            rotulo="tarefa humana"
            texto="Toda exceção vira tarefa com motivo escrito. A IA redige o encaminhamento; quem decide é a pessoa."
          />
        </h2>
        <span className="secao__nota">
          {tarefas.length} aberta{tarefas.length === 1 ? '' : 's'}
        </span>
      </div>

      <Bloco
        carregando={carregando}
        erro={erro}
        vazio={tarefas.length === 0}
        esqueleto={<Esqueleto altura={140} raio="16px" />}
        tituloVazio="Nenhuma tarefa humana aberta"
        dicaVazio="Derrube um convênio ou ligue o Aurora sem número pra ver a exceção chegar aqui."
      >
        <ul className="tarefas">
          {tarefas.map((tarefa) => (
            <li key={tarefa.id} className="cartao tarefa">
              <div className="tarefa__cabeca">
                <button
                  type="button"
                  className="tarefa__solicitacao num"
                  style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}
                  onClick={() => onAbrirSolicitacao(tarefa.solicitacao)}
                >
                  {tarefa.solicitacao}
                </button>
                {tarefa.prioridade === 'alta' ? (
                  <Selo tom="vermelho" Icone={IconeAlerta}>prioridade alta</Selo>
                ) : (
                  <Selo tom="neutro">prioridade {tarefa.prioridade}</Selo>
                )}
                {formatarPrazo(tarefa.prazo) ? (
                  <Selo tom="contorno" Icone={IconeRelogio}>prazo {formatarPrazo(tarefa.prazo)}</Selo>
                ) : null}
              </div>

              <p className="tarefa__motivo">{tarefa.motivo}</p>

              <TextoDaIa tarefa={tarefa} fluxo={fluxosDeTexto[tarefa.id]} />
            </li>
          ))}
        </ul>
      </Bloco>
    </section>
  );
});
