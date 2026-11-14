// Painel lateral com a linha do tempo da solicitação (log que só aceita inclusão).
// Fecha no Escape e no clique fora; o foco vai pro painel e volta pro cartão ao fechar.
import { useEffect, useRef, useState } from 'react';
import { Bloco, Esqueleto } from './Estado.jsx';
import { SeloDeStatus } from './Selo.jsx';
import { IconePessoa, IconeRelogio, IconeX } from './Icones.jsx';
import { buscarLinhaDoTempo } from '../servicos/api.js';

function formatarHora(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Os eventos do disjuntor usam status_para 'disjuntor_aberto' etc.: não são status de
// solicitação, então aparecem como texto em vez de selo.
function ehEventoDeDisjuntor(evento) {
  return String(evento.status_para ?? '').startsWith('disjuntor_');
}

export function GavetaLinhaDoTempo({ solicitacao, onFechar }) {
  const [eventos, setEventos] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const refPainel = useRef(null);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    buscarLinhaDoTempo(solicitacao.id)
      .then((lista) => {
        if (cancelado) return;
        setEventos(Array.isArray(lista) ? lista : []);
      })
      .catch((falha) => {
        if (!cancelado) setErro(falha);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [solicitacao.id]);

  // Escape fecha. O listener sai no desmonte.
  useEffect(() => {
    const aoTeclar = (evento) => {
      if (evento.key === 'Escape') onFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    refPainel.current?.focus();
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <div className="gaveta">
      <button type="button" className="gaveta__fundo" aria-label="Fechar a linha do tempo" onClick={onFechar} />

      <div
        className="gaveta__painel"
        role="dialog"
        aria-modal="true"
        aria-label={`Linha do tempo da solicitação ${solicitacao.id}`}
        tabIndex={-1}
        ref={refPainel}
      >
        <div className="gaveta__cabeca">
          <div>
            <span className="etiqueta">Linha do tempo</span>
            <h2 className="gaveta__titulo num">{solicitacao.id}</h2>
            <p className="solicitacao__procedimento">
              {solicitacao.paciente}
              {solicitacao.procedimento ? ` · Procedimento ${solicitacao.procedimento}` : ''}
            </p>
            <div style={{ marginTop: 'var(--esp-2)' }}>
              <SeloDeStatus status={solicitacao.status} />
            </div>
          </div>
          <button type="button" className="gaveta__fechar" onClick={onFechar} aria-label="Fechar">
            <IconeX tamanho={16} />
          </button>
        </div>

        <div className="gaveta__corpo">
          <Bloco
            carregando={carregando}
            erro={erro}
            vazio={Array.isArray(eventos) && eventos.length === 0}
            esqueleto={(
              <div style={{ display: 'grid', gap: 'var(--esp-4)' }}>
                <Esqueleto altura={48} />
                <Esqueleto altura={48} />
                <Esqueleto altura={48} />
              </div>
            )}
            tituloVazio="Nenhum evento registrado"
            dicaVazio="Esta solicitação ainda não passou pelo motor."
          >
            <ol className="linha">
              {(eventos ?? []).map((evento) => (
                <li
                  key={evento.id}
                  className={`evento${evento.status_de !== evento.status_para ? ' evento--marco' : ''}`}
                >
                  <div className="evento__cabeca">
                    {ehEventoDeDisjuntor(evento) ? (
                      <span className="selo selo--neutro">
                        {String(evento.status_para).replace('disjuntor_', 'disjuntor ').replace('_', ' ')}
                      </span>
                    ) : (
                      <SeloDeStatus status={evento.status_para} />
                    )}
                    <span className="evento__hora num">
                      <IconeRelogio tamanho={11} /> {formatarHora(evento.horario)}
                    </span>
                    <span className="evento__hora">
                      {evento.ator === 'humano' ? <IconePessoa tamanho={11} /> : null} {evento.ator}
                    </span>
                  </div>
                  {evento.motivo ? <p className="evento__motivo">{evento.motivo}</p> : null}
                  {evento.regra_usada ? <p className="evento__regra">fonte {evento.regra_usada}</p> : null}
                </li>
              ))}
            </ol>
          </Bloco>
        </div>
      </div>
    </div>
  );
}
