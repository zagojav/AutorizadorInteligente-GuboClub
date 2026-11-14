// Barra de controles da demo. Todo botão desabilita enquanto a ação roda (sem clique duplo).
// O estado de "Aurora sem número" vem do /api/saude, nunca de estado local.
import { memo } from 'react';
import { Dica } from './Dica.jsx';
import { Selo } from './Selo.jsx';
import { EstadoDeErro } from './Estado.jsx';
import { IconeCerto, IconeFila, IconeGirando, IconeRaio, IconeX } from './Icones.jsx';

export const Controles = memo(function Controles({
  ocupado,
  erroDeAcao,
  resultadoDosCasos,
  auroraSemNumero,
  acoes,
}) {
  const algoRodando = Boolean(ocupado);

  return (
    <section className="secao" aria-labelledby="titulo-controles">
      <div className="secao__cabeca">
        <h2 className="secao__titulo" id="titulo-controles">Controles da demonstração</h2>
        <span className="secao__nota">Tudo que acontece aqui é simulado e reversível.</span>
      </div>

      <div className="controles">
        <button
          type="button"
          className="botao botao--marca"
          disabled={algoRodando}
          onClick={acoes.iniciarFila}
        >
          {ocupado === 'iniciarFila' ? <IconeGirando tamanho={15} /> : <IconeFila tamanho={15} />}
          {ocupado === 'iniciarFila' ? 'Processando a fila...' : 'Iniciar fila'}
        </button>

        <button type="button" className="botao" disabled={algoRodando} onClick={acoes.gerarCarga}>
          <IconeRaio tamanho={15} />
          Gerar carga
        </button>

        <button type="button" className="botao" disabled={algoRodando} onClick={acoes.rodarTestes}>
          <IconeCerto tamanho={15} />
          {ocupado === 'rodarTestes' ? 'Rodando...' : 'Rodar 4 casos'}
        </button>

        <button
          type="button"
          className={`botao${auroraSemNumero ? ' botao--ativo' : ''}`}
          disabled={algoRodando}
          aria-pressed={auroraSemNumero}
          onClick={() => acoes.alternarAuroraSemNumero(!auroraSemNumero)}
        >
          <IconeX tamanho={15} />
          {auroraSemNumero ? 'Aurora sem número: ligado' : 'Aurora sem número'}
        </button>

        <span className="controles__resultado">
          {resultadoDosCasos ? (
            <Selo tom={resultadoDosCasos.passaram === resultadoDosCasos.total ? 'verde' : 'vermelho'} Icone={IconeCerto}>
              {resultadoDosCasos.passaram}/{resultadoDosCasos.total} casos do kit
            </Selo>
          ) : (
            <Selo tom="contorno">4/4 casos do kit</Selo>
          )}
          <Dica
            rotulo="os 4 casos do kit"
            texto="Aurora autoriza, Horizonte fica pendente, Jardim cria tarefa humana e resposta sem número não autoriza. Rodam num banco em memória, sem tocar na demo."
          />
        </span>
      </div>

      {erroDeAcao ? (
        <div style={{ marginTop: 'var(--esp-3)' }}>
          <EstadoDeErro titulo="A última ação não completou" erro={erroDeAcao} />
        </div>
      ) : null}

      {auroraSemNumero ? (
        <p className="auditor__frase" style={{ marginTop: 'var(--esp-4)' }}>
          A Aurora está respondendo <strong>autorizado sem número</strong>. A trava do motor
          manda a DEMO-R1 pra tarefa humana em vez de inventar uma autorização.
        </p>
      ) : null}
    </section>
  );
});
