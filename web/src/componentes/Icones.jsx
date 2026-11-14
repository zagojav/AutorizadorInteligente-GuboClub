// Ícones SVG de traço fino, desenhados à mão (sem biblioteca).
// Padrão: viewBox 24, stroke currentColor, fill none, traço 1.5.
// `titulo` virá como <title> quando o ícone carregar significado sozinho; quando ele
// acompanha um texto que já diz a mesma coisa, fica aria-hidden.

function Base({ titulo, tamanho = 16, children, ...resto }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={titulo ? 'img' : undefined}
      aria-hidden={titulo ? undefined : 'true'}
      focusable="false"
      {...resto}
    >
      {titulo ? <title>{titulo}</title> : null}
      {children}
    </svg>
  );
}

// Convênio
export function IconeEscudo(props) {
  return (
    <Base {...props}>
      <path d="M12 3 4.5 6v5.5c0 4.2 3 7.8 7.5 9.5 4.5-1.7 7.5-5.3 7.5-9.5V6L12 3Z" />
    </Base>
  );
}

// Disjuntor. `aberto` gira a chave 90 graus (a rotação fica no CSS da coluna).
export function IconeChave(props) {
  return (
    <Base {...props}>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12h8.5" />
      <path d="M17 12v3.2" />
      <path d="M19.6 12v2.2" />
    </Base>
  );
}

// Humano
export function IconePessoa(props) {
  return (
    <Base {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20.5c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" />
    </Base>
  );
}

export function IconeDocumento(props) {
  return (
    <Base {...props}>
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3Z" />
      <path d="M13.8 3.2v4.3h4.5" />
      <path d="M9 13h6M9 16.5h4" />
    </Base>
  );
}

export function IconeRelogio(props) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  );
}

export function IconeCerto(props) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8 12.3 2.8 2.7L16 9.5" />
    </Base>
  );
}

export function IconeAlerta(props) {
  return (
    <Base {...props}>
      <path d="M12 3.8 2.8 20h18.4L12 3.8Z" />
      <path d="M12 9.5v4.2M12 16.8h.01" />
    </Base>
  );
}

export function IconeRaio(props) {
  return (
    <Base {...props}>
      <path d="M13.5 2.5 5 13.8h5.5L9.8 21.5 18.5 10h-5.6l.6-7.5Z" />
    </Base>
  );
}

export function IconeFila(props) {
  return (
    <Base {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h10" />
    </Base>
  );
}

export function IconeGrafico(props) {
  return (
    <Base {...props}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="m7.5 15.5 3.5-4 3 2.6 4.5-6" />
    </Base>
  );
}

export function IconeSeta(props) {
  return (
    <Base {...props}>
      <path d="M5 12h13" />
      <path d="m12.5 6.5 6 5.5-6 5.5" />
    </Base>
  );
}

export function IconeX(props) {
  return (
    <Base {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Base>
  );
}

export function IconeGirando(props) {
  return (
    <Base {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20.5 4.5V10H15" />
    </Base>
  );
}
