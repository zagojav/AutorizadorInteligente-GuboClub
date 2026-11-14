// Observa uma media query e devolve se ela casa. Usado pra só ligar as abas no celular:
// no desktop as três colunas aparecem juntas e nenhuma recebe o atributo hidden
// (hidden também esconde do leitor de tela, então não pode sobrar no desktop).
import { useEffect, useState } from 'react';

export function useMidia(consulta) {
  const [casa, setCasa] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(consulta).matches : false
  ));

  useEffect(() => {
    const lista = window.matchMedia(consulta);
    const aoMudar = (evento) => setCasa(evento.matches);
    setCasa(lista.matches);
    lista.addEventListener('change', aoMudar);
    return () => lista.removeEventListener('change', aoMudar);
  }, [consulta]);

  return casa;
}

export const CONSULTA_CELULAR = '(max-width: 760px)';
