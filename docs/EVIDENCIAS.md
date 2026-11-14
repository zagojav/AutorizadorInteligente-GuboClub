# Evidências da entrega

Execução local em 14/11/2026, Mac Intel, Java 21.0.13. Todos os dados e tempos de integração abaixo são **simulados**, não resultados de atendimento real. Logs integrais da sessão ficam em `.runtime/` (ignorados pelo git); trechos reais preservados aqui.

## Backend final

Comando: `source scripts/env.sh && mvn -B -ntp -f backend test`.

```text
[INFO] Tests run: 25, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
[INFO] Total time:  9.766 s
[INFO] Finished at: 2026-11-14T14:19:28-03:00
```

Baseline ao assumir: 20 testes, zero falhas. Cinco testes novos cobrem JSON inválido, headers/arquivos internos, chunked malformado, escrita concorrente e limite de ações.
Jar empacotado após esses testes com `mvn -B -ntp -f backend package -DskipTests`: BUILD SUCCESS, 4.532 s. O Shade avisa sobre metadados/licenças/module-info compartilhados; não são warnings do front.

## Paridade final

Comando: `bash scripts/paridade.sh`, com portas 3000 e 3001 livres.

```text
01-iniciar-fila            node=200 java=200
02-fila                    node=200 java=200
03-saude                   node=200 java=200
04-linha-do-tempo-r2       node=200 java=200
05-anexar-documento-r2     node=200 java=200
06-tarefas                 node=200 java=200
07-derrubar-jardim         node=200 java=200
08-carga                   node=200 java=200
09-fila-apos-carga         node=200 java=200
10-auditoria               node=200 java=200
11-metricas                node=200 java=200
12-aurora-sem-numero       node=200 java=200
13-reprocessar-r1          node=200 java=200
14-testes-rodar            node=200 java=200
15-restaurar-jardim        node=200 java=200
16-id-invalido             node=400 java=400
17-tarefa-inexistente      node=404 java=404
PARIDADE OK (17 chamadas comparadas, campo por campo)
```

## Front final

Comando: `npm run build --prefix web`.

```text
vite v7.3.8 building client environment for production...
✓ 76 modules transformed.
dist/index.html                                    0.95 kB │ gzip: 0.56 kB
dist/assets/inter-variavel-latin-8kRkwJBP.woff2      48.43 kB
dist/assets/index-BxlsfpWs.css                     26.29 kB │ gzip: 5.90 kB
dist/assets/Painel-FClAuYwh.js                     36.96 kB │ gzip: 11.59 kB
dist/assets/Icones-BTa39ZId.js                     73.81 kB │ gzip: 28.95 kB
dist/assets/Abertura-Bpy8WVd3.js                   74.31 kB │ gzip: 26.63 kB
dist/assets/index-BB-EbT1Q.js                     263.13 kB │ gzip: 83.86 kB
✓ built in 2.35s
```

Zero warnings no build do front. Não existe lint configurado; `bash -n`, `node --check scripts/verificar-rodadas.mjs` e `git diff --check` passaram. Não se declara execução de ESLint/Checkstyle inexistente.

## Três rodadas consecutivas com reset

Comando: `node scripts/verificar-rodadas.mjs`. Cada rodada para somente o processo gerenciado, inicia outro com SQLite em memória e percorre o roteiro inteiro no navegador. O script compara os resultados de negócio por igualdade, não só o código de saída.

| Rodada | Passos | Console/página | Duração do roteiro | p50 simulado | p95 simulado |
|---|---|---|---|---|---|
| 1 | 17/17 | 0/0 | 11.644 ms | 365 ms | 706 ms |
| 2 | 17/17 | 0/0 | 12.163 ms | 342 ms | 652 ms |
| 3 | 17/17 | 0/0 | 11.090 ms | 510 ms | 771 ms |

```text
RODADA 1 OK: decisões conferidas; métricas simuladas p50=365, p95=706
RODADA 2 OK: decisões conferidas; métricas simuladas p50=342, p95=652
RODADA 3 OK: decisões conferidas; métricas simuladas p50=510, p95=771
3/3 RODADAS OK: resultados de negócio idênticos com reset entre rodadas.
```

Todas terminaram com 18 solicitações, seis tarefas abertas, 15 alertas do auditor, casos do kit 4/4 e encaminhamentos 2/3. O 2/3 é esperado **depois** de anexar documento a R2: a expectativa inicial do kit é pendente_documento, mas R2 já foi autorizada. Não é erro de regra. Todos os alertas mantêm `muda_resultado: false`.

Horários, latências e IDs de eventos não entram na comparação de igualdade. Status, números de autorização, modos, tipos/referências de alertas e contagens entram. JSONs completos da captura: `.runtime/rodada-1.json` a `rodada-3.json`.

Uma tentativa anterior da coleta falhou ao reutilizar um socket entre processos; o verificador agora usa `Connection: close`. A sequência acima é a nova execução completa, bem-sucedida.

## Abertura e celular

Abertura desktop e celular: `RESULTADO ABERTURA: 9/9 ok` em cada. Zero requests externos, Inter local carregada, cinco cenas presentes, CTA funcional, zero pin-spacer no painel e zero erros de console. Medição headless: 59 fps médios e nenhuma tarefa longa acima de 50 ms; não é garantia de 60 fps em qualquer hardware.

Celular final em 390x844, Slow 3G (400 kbps, 400 ms):

```text
OK   painel abre e carrega a fila  (5148 ms até a fila)
OK   rodar 4 casos dá 4/4
OK   auditor mostra os alertas da API  (15 alertas)
OK   métricas marcadas como simuladas e com p50/p95 da API  (p50=445 p95=764 2/3 4/4)
console.error: 0  erros de página: 0  duração: 20905 ms
RESULTADO: 18/18 passos ok (celular 390x844) (Slow 3G)
```

Após reiniciar a demo, `POST /api/testes/rodar` retornou HTTP 200:

```json
{"passaram":4,"total":4,"detalhes":[{"caso":"Aurora Demo: retorna autorização DEMO","passou":true,"status":"autorizada"},{"caso":"Horizonte Demo sem documento: mantém pendência","passou":true,"status":"pendente_documento"},{"caso":"Jardim Demo indisponível: cria tarefa humana","passou":true,"status":"tarefa_humana"},{"caso":"Resposta sem número de autorização: não marca autorizado","passou":true,"status":"tarefa_humana"}]}
```

Métricas reais dessa rodada **simulada** inicial: 5 chamadas, 3 falhas detectadas, p50 468 ms, p95 816 ms, encaminhamentos 3/3, casos 4/4 e uma tarefa aberta. Auditor: 15 alertas (3 convênios divergentes, 2 procedimentos fora da regra, 1 guia conflitante, 7 cadastros irregulares, 2 sem consentimento), todos com `muda_resultado: false`.

A coleta imediatamente após o teste móvel recebeu um 409 de concorrência; após reinício, o endpoint acima foi conferido com HTTP 200. O servidor foi deixado ativo em sessão de terminal persistente, com a fila inicial pronta.

## Limites explícitos

- Template identificado como Texto padrão, sem provedor LLM externo, conforme decisão anterior registrada.
- Item 20 do checklist parcial: assets estáticos no build, sem pré-renderização HTML React.
- Fonte local é um arquivo variável único, não dois pesos fixos; preservado visual aprovado.
- Jetty 11 EOL com alertas residuais e mitigação testada; detalhes em SEGURANCA. Não é homologação para dados reais.
- Histórico de arquivos de ambiente bloqueado pelo hook; sem scanner dedicado disponível. Não verificados.
- Túnel preparado em script, mas não iniciado nem validado publicamente nesta sessão.
