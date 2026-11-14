// Rodapé com a frase que resume a arquitetura.
import { memo } from 'react';

export const Rodape = memo(function Rodape() {
  return (
    <footer className="rodape">
      <p className="rodape__frase">
        A <em>IA sugere</em>, a <em>regra decide</em>, o <em>humano</em> resolve a exceção.
      </p>
      <span className="rodape__nota">
        Gubo Club · Hack Inova Health AI · dados sintéticos, regras REGRAS-DEMO-v1
      </span>
    </footer>
  );
});
