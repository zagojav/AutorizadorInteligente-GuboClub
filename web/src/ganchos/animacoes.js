// Animações pequenas e reutilizáveis do painel. Só transform e opacity.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';

export function querMenosMovimento() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * FLIP feito à mão com gsap: mede onde cada item estava, mede onde ficou e anima a
 * diferença. Cada item da lista precisa de data-flip="<chave>".
 * Só transform, então não causa relayout durante a animação.
 */
export function useFlipDeLista(refContainer, chaveDaOrdem) {
  const posicoes = useRef(new Map());

  useLayoutEffect(() => {
    const container = refContainer.current;
    if (!container) return;

    const itens = Array.from(container.querySelectorAll('[data-flip]'));
    const novas = new Map();
    const anteriores = posicoes.current;

    itens.forEach((item) => {
      const caixa = item.getBoundingClientRect();
      const chave = item.dataset.flip;
      novas.set(chave, caixa);

      const antiga = anteriores.get(chave);
      if (!antiga || querMenosMovimento()) return;

      const dx = antiga.left - caixa.left;
      const dy = antiga.top - caixa.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      gsap.fromTo(
        item,
        { x: dx, y: dy },
        {
          x: 0,
          y: 0,
          duration: 0.45,
          ease: 'power3.out',
          // will-change só enquanto anima: fora disso o navegador não precisa da camada.
          onStart: () => {
            item.style.willChange = 'transform';
          },
          onComplete: () => {
            item.style.willChange = '';
          },
        },
      );
    });

    posicoes.current = novas;
  }, [refContainer, chaveDaOrdem]);
}

/**
 * Contador animado: interpola do valor antigo pro novo.
 * Valor que não é número (null, "3/3", "pendente") passa direto, sem animar.
 */
export function useContadorAnimado(valor) {
  const numerico = typeof valor === 'number' && Number.isFinite(valor);
  const [exibido, setExibido] = useState(valor);
  const alvo = useRef({ n: numerico ? valor : 0 });

  useEffect(() => {
    if (!numerico) {
      setExibido(valor);
      return undefined;
    }
    if (querMenosMovimento()) {
      alvo.current.n = valor;
      setExibido(valor);
      return undefined;
    }
    const animacao = gsap.to(alvo.current, {
      n: valor,
      duration: 0.7,
      ease: 'power2.out',
      onUpdate: () => setExibido(Math.round(alvo.current.n)),
      onComplete: () => setExibido(valor),
    });
    return () => animacao.kill();
  }, [valor, numerico]);

  return exibido;
}
