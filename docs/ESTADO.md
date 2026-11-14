# ESTADO DO PROJETO (atualizado a cada fase)

Última atualização: 14/11/2026 13:40 (São Paulo). Fase 1 concluída.

## Como rodar (hoje)
```bash
source scripts/env.sh                 # JDK 21 e Maven de ./.tools
mvn -f backend package                # testa e gera backend/target/autorizador.jar
(cd web && npm run build)             # gera web/dist
java -jar backend/target/autorizador.jar   # http://127.0.0.1:3000
mvn -f backend test                   # JUnit (20 casos)
bash scripts/paridade.sh              # prova Node x Java
```

## Pronto (confirmado com saída real)
- Fase 0: inventário em git; web/dist no .gitignore; front versionado.
- Fase 1: backend Java completo. `mvn package`: `Tests run: 20, Failures: 0, Errors: 0, Skipped: 0`, `BUILD SUCCESS`. `scripts/paridade.sh`: `PARIDADE OK (17 chamadas comparadas, campo por campo)`.
- Fase 1, correção: o Java agora serve ./web/dist corretamente. Verificado com curl no jar:
  - `/` e `/painel` (SPA): `text/html`, `cache-control: no-cache`.
  - `/assets/*.js|css`: `text/javascript`/`text/css`, `cache-control: public, max-age=31536000, immutable`, gzip.
  - `/api/*` e `/mock/*`: `cache-control: private, no-store`, nosniff; `/api/nada` → 404 JSON.
  - `/assets/../../../pom.xml` cai no index (path traversal bloqueado). Teste JUnit 19 cobre isso.
- Node em ./referencia-node (especificação viva); package.json da raiz só com scripts de apoio.
- Vite antigo na 5173 encerrado; nenhum servidor na 3000 ao fim da fase.

## Decisões registradas
- IA em Java: só template (origem "template"). Não existe arquivo de ambiente real no projeto (só o `.env.example`), logo não há ANTHROPIC_API_KEY; por decisão do Zago o provedor externo não foi implementado. O teste "IA cai no template com timeout" não se aplica (sem provedor não há timeout); "sem chave cai no template" está coberto pelo teste 16. `/api/saude.ia.provedor` = "template" e o painel mostra a origem real.

## Pela metade / falta
- Fontes: index.html carrega Inter do Google Fonts com 5 pesos; a missão pede fonte local com no máximo 2 pesos (fase 3).
- Fase 2: validar cada fluxo do painel via API e navegador (Playwright em ./web).
- Fase 3: fontes locais; revisar cenas; commit.
- Fase 4: docs/CHECKLIST.md e docs/ESCALA.md.
- Fase 5: revisão secure-code, docs/SEGURANCA.md.
- Fase 6: scripts/demo.sh, tunel.sh, reset.sh, README, docs/EVIDENCIAS.md, 3 rodadas.
- Fase 7: relatório.

## Próximo passo exato
Fase 2: `cd web && npm run build`, subir o jar na 3000, rodar a sequência do painel pela API e por Playwright (headless) conferindo zero erro de console.
