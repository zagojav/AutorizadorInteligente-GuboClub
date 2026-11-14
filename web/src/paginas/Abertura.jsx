// / — abertura narrativa guiada pelo scroll. Cinco cenas, cada uma fixada (pin) com
// scrub no desktop. No celular, versões sem pin. Quem pediu menos movimento recebe
// as mesmas cenas, só que estáticas, com um fade simples.
//
// Regra de performance: as animações só mexem em transform e opacity, e o will-change
// entra quando a cena começa e sai quando ela termina.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { useLenis } from '../ganchos/useLenis.js';
import { querMenosMovimento } from '../ganchos/animacoes.js';
import { DestinoHumano, Fichinha, MiniPainel, TrilhoConvenio } from '../componentes/PecasDaAbertura.jsx';
import { IconeSeta } from '../componentes/Icones.jsx';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const TITULO = 'Um convênio cai. A fila inteira para.';
const ORBES = ['Aurora', 'Horizonte', 'Jardim'];

// Cena 2: uma fila só. A quarta ficha é a do Jardim, a que cai.
const FILA_UNICA = [
  { tom: 'verde', rotulo: 'AUR-1' },
  { tom: 'ambar', rotulo: 'HOR-1' },
  { tom: 'verde', rotulo: 'AUR-2' },
  { tom: 'verde', rotulo: 'JAR-1', podeCair: true },
  { tom: 'ambar', rotulo: 'HOR-2' },
  { tom: 'verde', rotulo: 'AUR-3' },
  { tom: 'ambar', rotulo: 'HOR-3' },
  { tom: 'verde', rotulo: 'JAR-2' },
  { tom: 'verde', rotulo: 'AUR-4' },
  { tom: 'ambar', rotulo: 'HOR-4' },
];

const PRINCIPIOS = [
  <>A <em>IA</em> sugere.</>,
  <>A <em>regra</em> decide.</>,
  <>O <em>humano</em> resolve a exceção.</>,
];

export default function Abertura() {
  const raiz = useRef(null);
  // Decidido uma vez na montagem: o resto do componente respeita essa escolha.
  const [semMovimento] = useState(() => querMenosMovimento());

  useLenis({ ligado: !semMovimento });

  useGSAP(() => {
    /* ---------- Barra de progresso de leitura ---------- */
    gsap.to('[data-progresso]', {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
    });

    /* ---------- Quem pediu menos movimento: fade simples, sem scrub e sem pin ----------
       Esta decisão é um if em JavaScript, e não uma condição do gsap.matchMedia, de
       propósito: aqui não existe dúvida sobre quem foi avaliado, e nenhuma timeline com
       pin chega a ser criada. */
    if (semMovimento) {
      // Camadas que normalmente entram animadas já nascem visíveis, e a chave do
      // Jardim nasce aberta: a legenda ao lado diz que o disjuntor abriu.
      gsap.set('[data-queda], [data-humano], [data-saida]', { opacity: 1 });
      gsap.set('[data-chave="abre"]', { rotate: 90 });

      gsap.utils.toArray('[data-aparece]').forEach((elemento) => {
        gsap.fromTo(
          elemento,
          { opacity: 0 },
          {
            opacity: 1,
            duration: 0.5,
            scrollTrigger: { trigger: elemento, start: 'top 88%', once: true },
          },
        );
      });

      ScrollTrigger.refresh();
      return undefined;
    }

    /* ---------- Cenas animadas ---------- */
    const mm = gsap.matchMedia();
    mm.add(
      {
        desktop: '(min-width: 761px)',
        celular: '(max-width: 760px)',
      },
      (contexto) => {
        const { desktop } = contexto.conditions;
        // No celular nada é fixado: pin em tela pequena custa caro e trava.
        const fixar = Boolean(desktop);

        // Base comum das cenas: fixa a cena e amarra a timeline ao scroll.
        const gatilho = (seletor, extensao = '+=120%') => ({
          trigger: seletor,
          start: 'top top',
          end: extensao,
          scrub: 0.6,
          pin: fixar,
          anticipatePin: fixar ? 1 : 0,
          invalidateOnRefresh: true,
        });

        // will-change só enquanto a cena está na tela.
        const ligarCamada = (alvos) => ({
          onToggle: ({ isActive }) => {
            gsap.utils.toArray(alvos).forEach((elemento) => {
              elemento.style.willChange = isActive ? 'transform, opacity' : '';
            });
          },
        });

        /* ---- Cena 1: gancho ---- */
        // Título palavra por palavra, sem scrub: entra de uma vez e fica.
        gsap.from('[data-cena="1"] .palavra > span', {
          yPercent: 115,
          duration: 0.85,
          ease: 'power3.out',
          stagger: 0.055,
          scrollTrigger: { trigger: '[data-cena="1"]', start: 'top 80%', once: true },
        });

        // Os três convênios orbitam devagar, sem depender do scroll.
        gsap.to('[data-giro]', { rotate: 360, duration: 54, ease: 'none', repeat: -1 });
        gsap.to('[data-orbe-texto]', { rotate: -360, duration: 54, ease: 'none', repeat: -1 });

        // E crescem conforme o scroll.
        gsap.fromTo(
          '[data-orbe]',
          { scale: 0.55 },
          {
            scale: 1.15,
            ease: 'none',
            stagger: 0.08,
            scrollTrigger: {
              trigger: '[data-cena="1"]',
              start: 'top top',
              end: 'bottom top',
              scrub: 0.6,
            },
          },
        );

        gsap.to('[data-role]', {
          opacity: 0,
          ease: 'none',
          scrollTrigger: { trigger: '[data-cena="1"]', start: 'top top', end: '40% top', scrub: true },
        });

        /* ---- Cena 2: a dor (efeito dominó) ---- */
        const cena2 = gsap.timeline({
          scrollTrigger: {
            ...gatilho('[data-cena="2"]'),
            ...ligarCamada('[data-cena="2"] [data-linha], [data-cena="2"] [data-fichinha]'),
          },
        });

        cena2
          // A fila anda e para na metade: é a parada que conta a história.
          .fromTo(
            '[data-cena="2"] [data-linha]',
            { xPercent: 6 },
            { xPercent: desktop ? -26 : -46, ease: 'none', duration: 0.5 },
            0,
          )
          // O Jardim fica vermelho.
          .to('[data-cena="2"] [data-queda]', { opacity: 1, duration: 0.12 }, 0.5)
          // E tudo que está atrás dele apaga, uma ficha depois da outra.
          .to(
            '[data-cena="2"] [data-atras] [data-cor]',
            { opacity: 0, duration: 0.3, stagger: 0.06 },
            0.56,
          )
          .to('[data-cena="2"] [data-atras]', { scale: 0.96, duration: 0.3, stagger: 0.06 }, 0.56)
          .fromTo('[data-cena="2"] [data-legenda]', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.25 }, 0.62);

        /* ---- Cena 3: a virada (a fila vira três trilhos) ---- */
        const cena3 = gsap.timeline({
          scrollTrigger: {
            ...gatilho('[data-cena="3"]'),
            ...ligarCamada('[data-cena="3"] [data-trilho], [data-cena="3"] [data-linha]'),
          },
        });

        const separacao = desktop ? 108 : 72;
        cena3
          // Os três trilhos saem de uma linha só e se separam.
          .fromTo(
            '[data-trilho="0"]',
            { y: separacao, opacity: 0.25 },
            { y: 0, opacity: 1, ease: 'power2.out', duration: 0.3 },
            0,
          )
          .fromTo('[data-trilho="1"]', { y: 0, opacity: 0.25 }, { y: 0, opacity: 1, duration: 0.3 }, 0)
          .fromTo(
            '[data-trilho="2"]',
            { y: -separacao, opacity: 0.25 },
            { y: 0, opacity: 1, ease: 'power2.out', duration: 0.3 },
            0,
          )
          // Aurora e Horizonte seguem fluindo.
          .to('[data-trilho="0"] [data-linha]', { xPercent: -14, ease: 'none', duration: 0.7 }, 0.3)
          .to('[data-trilho="1"] [data-linha]', { xPercent: -11, ease: 'none', duration: 0.7 }, 0.3)
          // A chave do Jardim gira e abre.
          .to('[data-cena="3"] [data-chave="abre"]', { rotate: 90, duration: 0.2, ease: 'back.out(1.6)' }, 0.42)
          // O destino humano aparece.
          .to('[data-humano]', { opacity: 1, scale: 1, duration: 0.2 }, 0.5)
          // E os pedidos do Jardim desviam pra lá.
          .to(
            '[data-trilho="2"] [data-fichinha]',
            { x: desktop ? 440 : 120, y: desktop ? 26 : 58, opacity: 0, duration: 0.3, stagger: 0.05 },
            0.54,
          )
          .fromTo('[data-cena="3"] [data-legenda]', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.2 }, 0.7);

        /* ---- Cena 4: princípios, um por vez ---- */
        const cena4 = gsap.timeline({
          scrollTrigger: { ...gatilho('[data-cena="4"]', '+=150%'), ...ligarCamada('.principio') },
        });

        // A saída de cada frase se sobrepõe à entrada da próxima: sem a sobreposição
        // sobra uma faixa de scroll com a tela vazia entre uma frase e a seguinte.
        const PASSO = 0.33;
        gsap.utils.toArray('.principio').forEach((frase, indice) => {
          const entrada = indice * PASSO;
          const ehUltima = indice === 2;
          cena4.fromTo(frase, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.09 }, entrada);
          // A última fica na tela até o fim da cena.
          if (!ehUltima) {
            cena4.to(frase, { opacity: 0, scale: 1.06, duration: 0.09 }, entrada + 0.29);
          }
        });

        /* ---- Cena 5: mergulho no painel ---- */
        const cena5 = gsap.timeline({
          scrollTrigger: { ...gatilho('[data-cena="5"]', '+=150%'), ...ligarCamada('[data-minipainel]') },
        });

        cena5
          .fromTo(
            '[data-minipainel]',
            { scale: 0.3, rotateX: 26, rotateZ: -4, opacity: 0.6 },
            { scale: 1, rotateX: 0, rotateZ: 0, opacity: 1, ease: 'power2.out', duration: 0.6 },
            0,
          )
          // Passa de 1: é o que dá a sensação de entrar na tela.
          .to('[data-minipainel]', { scale: desktop ? 1.7 : 1.25, ease: 'power1.in', duration: 0.3 }, 0.6)
          .to('[data-saida]', { opacity: 1, y: 0, duration: 0.15 }, 0.78);
      },
    );

    // O refresh garante as medidas certas depois do layout final.
    ScrollTrigger.refresh();

    // O useGSAP reverte o que foi criado no escopo dele, mas o gsap.matchMedia() é um
    // objeto à parte: sem este revert, os ScrollTriggers e os pin-spacers da abertura
    // continuam vivos depois de sair da rota e sujam o painel.
    return () => {
      mm.revert();
      ScrollTrigger.refresh();
    };
  }, { scope: raiz, dependencies: [semMovimento] });

  return (
    <div className={`abertura${semMovimento ? ' abertura--sem-movimento' : ''}`} ref={raiz}>
      <div className="progresso" aria-hidden="true">
        <div className="progresso__preenchido" data-progresso />
      </div>

      {/* Atalho sempre disponível: ninguém é obrigado a rolar até o fim. */}
      <Link className="botao botao--pequeno abertura__atalho" to="/painel">
        Ir direto ao painel <IconeSeta tamanho={14} />
      </Link>

      <main>
        {/* ---------------- Cena 1 ---------------- */}
        <section className="cena" data-cena="1" aria-labelledby="gancho">
          <div className="cena__interno">
            <span className="cena__numero" data-aparece>Autorizador Inteligente · Gubo Club</span>

            <h1 className="display gancho__titulo" id="gancho" data-aparece>
              {/* Uma palavra por invólucro: é assim que ela sobe de dentro do corte. */}
              {TITULO.split(' ').map((palavra, indice) => (
                <span className="palavra" key={`${palavra}-${indice}`}>
                  <span>{palavra}&nbsp;</span>
                </span>
              ))}
            </h1>

            <div className="orbita" aria-hidden="true">
              <span className="orbita__anel" />
              <span className="orbita__giro" data-giro>
                {ORBES.map((nome, indice) => {
                  const angulo = (indice / ORBES.length) * Math.PI * 2 - Math.PI / 2;
                  return (
                    <span
                      className="orbe"
                      data-orbe
                      key={nome}
                      style={{
                        transform: `translate(${Math.cos(angulo) * 130}px, ${Math.sin(angulo) * 130}px)`,
                      }}
                    >
                      <span className="orbe__texto" data-orbe-texto>{nome}</span>
                    </span>
                  );
                })}
              </span>
            </div>

            <span className="role" data-role>
              role pra começar
              <span className="role__traco" aria-hidden="true" />
            </span>
          </div>
        </section>

        {/* ---------------- Cena 2 ---------------- */}
        <section className="cena" data-cena="2" aria-labelledby="dor">
          <div className="cena__interno">
            <span className="cena__numero" data-aparece>A dor</span>
            <h2 className="titulo-secao" id="dor" data-aparece>Uma fila só, para todos os convênios</h2>

            <div className="trilho" aria-hidden="true">
              <div className="trilho__linha" data-linha>
                {FILA_UNICA.map((ficha, indice) => (
                  // Tudo que vem depois da ficha que cai congela junto com ela.
                  <span key={ficha.rotulo} {...(indice > 3 ? { 'data-atras': '' } : {})}>
                    <Fichinha tom={ficha.tom} rotulo={ficha.rotulo} podeCair={ficha.podeCair} />
                  </span>
                ))}
              </div>
            </div>

            <p className="cena__legenda" data-legenda data-aparece>
              Hoje, <strong>uma integração fora do ar segura todos os pedidos.</strong>
            </p>
          </div>
        </section>

        {/* ---------------- Cena 3 ---------------- */}
        <section className="cena" data-cena="3" aria-labelledby="virada">
          <div className="cena__interno">
            <span className="cena__numero" data-aparece>A virada</span>
            <h2 className="titulo-secao" id="virada" data-aparece>Uma fila por convênio, com disjuntor</h2>

            <div className="trilhos" aria-hidden="true">
              <TrilhoConvenio indice="0" nome="Aurora" estado="autorizando" tom="verde" quantidade={6} />
              <TrilhoConvenio indice="1" nome="Horizonte" estado="pedindo documento" tom="ambar" quantidade={6} />
              <TrilhoConvenio indice="2" nome="Jardim" estado="fora do ar" tom="vermelho" quantidade={5} chaveAbre />
              <DestinoHumano />
            </div>

            <p className="cena__legenda" data-legenda data-aparece>
              O disjuntor do Jardim abre e <strong>os pedidos dele viram tarefa humana</strong>.
              Aurora e Horizonte seguem andando.
            </p>
          </div>
        </section>

        {/* ---------------- Cena 4 ---------------- */}
        <section className="cena" data-cena="4" aria-labelledby="principios">
          <div className="cena__interno">
            <span className="cena__numero" data-aparece>Os princípios</span>
            <h2 className="oculto-visual" id="principios">Princípios do autorizador</h2>

            <div className="principios">
              {PRINCIPIOS.map((frase, indice) => (
                <p className="principio" key={indice} data-aparece>{frase}</p>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- Cena 5 ---------------- */}
        <section className="cena" data-cena="5" aria-labelledby="mergulho">
          <div className="cena__interno">
            <span className="cena__numero" data-aparece>Ao vivo</span>
            <h2 className="titulo-secao" id="mergulho" data-aparece>É isto que o painel mostra agora</h2>

            <div className="mergulho">
              <MiniPainel />
            </div>

            <div className="mergulho__saida" data-saida>
              <Link className="botao botao--marca" to="/painel">
                Abrir painel ao vivo <IconeSeta tamanho={15} />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
