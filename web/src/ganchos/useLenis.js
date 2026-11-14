// Lenis integrado ao ScrollTrigger, do jeito que a documentação do GSAP pede:
// o scroll do Lenis avisa o ScrollTrigger, o raf do Lenis roda dentro do ticker do GSAP
// e o lagSmoothing fica desligado (senão o GSAP "pula" quadros e a cena sai do lugar).
// Quem pediu menos movimento não recebe Lenis nenhum: fica com o scroll nativo.
import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

export function useLenis({ ligado = true } = {}) {
  useEffect(() => {
    if (!ligado) return undefined;

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });

    const aoRolar = () => ScrollTrigger.update();
    lenis.on('scroll', aoRolar);

    // O ticker do GSAP entrega o tempo em segundos; o Lenis espera milissegundos.
    const passo = (tempo) => lenis.raf(tempo * 1000);
    gsap.ticker.add(passo);
    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.off('scroll', aoRolar);
      gsap.ticker.remove(passo);
      gsap.ticker.lagSmoothing(500, 33); // volta ao padrão do GSAP
      lenis.destroy();
    };
  }, [ligado]);
}
