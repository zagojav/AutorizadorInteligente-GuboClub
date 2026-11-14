# ESTADO DO PROJETO (atualizado a cada fase)

Última atualização: 14/11/2026 13:35 (São Paulo). Fase 0 concluída.

## Como rodar (hoje)
```bash
source scripts/env.sh                 # JDK 21 e Maven de ./.tools
mvn -f backend package                # gera backend/target/autorizador.jar
(cd web && npm run build)             # gera web/dist
java -jar backend/target/autorizador.jar   # http://127.0.0.1:3000
mvn -f backend test                   # JUnit
bash scripts/paridade.sh              # prova Node x Java
```

## Pronto (confirmado na fase 0, com saída real)
- Backend Java em ./backend: `mvn test` passa (BUILD SUCCESS, 19 casos), `scripts/paridade.sh` imprime `PARIDADE OK (17 chamadas comparadas, campo por campo)`.
- Node movido pra ./referencia-node; package.json da raiz só com scripts de apoio.
- CORS só pra localhost:5173 / 127.0.0.1:5173, fora de produção.
- Front em ./web: `npm run build` sem erro nem warning. Painel (/#/painel) e abertura (/) existem.
- Abertura: Lenis + ScrollTrigger integrados (useLenis.js), barra de progresso, scrollbar da marca, 5 cenas, React.lazy, matchMedia desktop/celular, prefers-reduced-motion.
- Vite antigo na 5173 encerrado; nenhum servidor na 3000.

## Pela metade / quebrado
- **BUG (fase 1 item 8):** o Java serve `/assets/*.js` como `text/html` (a rota `GET /*` de fallback engole os estáticos antes do staticFiles do Javalin). Com isso o painel não abre pelo Java. Cache também errado: tudo sai `private, no-store` (hash deveria ter cache longo; index.html `no-cache`).
- Fontes: index.html carrega Inter do Google Fonts com 5 pesos. A missão pede fonte local com no máximo 2 pesos (fase 3).
- IA em Java: só template (origem "template"). Não existe arquivo de ambiente real no projeto (só o `.env.example`), portanto não há ANTHROPIC_API_KEY e o provedor externo NÃO será implementado, por decisão do Zago. `/api/saude.ia.provedor` = "template".

## Falta (fases seguintes)
- Fase 1: corrigir estáticos e cache no Java; teste JUnit disso; commit.
- Fase 2: validar cada fluxo do painel via API e navegador (Playwright em ./web).
- Fase 3: fontes locais; revisar cenas; commit.
- Fase 4: docs/CHECKLIST.md e docs/ESCALA.md.
- Fase 5: revisão secure-code, docs/SEGURANCA.md.
- Fase 6: scripts/demo.sh, tunel.sh, reset.sh, README, docs/EVIDENCIAS.md, 3 rodadas.
- Fase 7: relatório.

## Próximo passo exato
Fase 1: editar `backend/src/main/java/br/gubo/autorizador/Rotas.java` (registrarFrontEnd) pra servir arquivos de ./web/dist com content-type e cache corretos, e restringir o `no-store` do `after` a /api e /mock.
