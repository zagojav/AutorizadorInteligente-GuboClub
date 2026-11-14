// Dica didática: um "?" que explica um conceito no hover e no foco de teclado.
// Usa aria-describedby, então leitor de tela lê a explicação junto do rótulo.
import { memo, useId, useState } from 'react';

export const Dica = memo(function Dica({ rotulo, texto }) {
  const id = useId();
  const [visivel, setVisivel] = useState(false);

  return (
    <span
      className="dica"
      onMouseEnter={() => setVisivel(true)}
      onMouseLeave={() => setVisivel(false)}
    >
      <button
        type="button"
        className="dica__gatilho"
        aria-label={`O que é ${rotulo}`}
        aria-describedby={visivel ? id : undefined}
        aria-expanded={visivel}
        onFocus={() => setVisivel(true)}
        onBlur={() => setVisivel(false)}
        onClick={() => setVisivel((atual) => !atual)}
      >
        ?
      </button>
      {visivel ? (
        <span className="dica__bolha" id={id} role="tooltip">
          {texto}
        </span>
      ) : null}
    </span>
  );
});
