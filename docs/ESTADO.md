# ESTADO DO PROJETO (atualizado a cada fase)

Última atualização: 14/11/2026 14:25 (São Paulo). Fase 6 concluída com limites documentados.

## Como rodar (hoje)
```bash
bash scripts/demo.sh                  # comando único; build se necessário, fila inicial pronta
bash scripts/reset.sh                 # reinicia processo e banco sintético em memória
bash scripts/reset.sh --parar         # para somente a demo gerenciada
source scripts/env.sh                 # JDK 21 e Maven de ./.tools
mvn -f backend package                # testa (25 casos) e gera backend/target/autorizador.jar
(cd web && npm run build)             # gera web/dist
java -jar backend/target/autorizador.jar   # http://127.0.0.1:3000  (painel em /#/painel)
bash scripts/paridade.sh              # prova Node x Java
(cd web && npm run verificar)         # roteiro do painel em navegador headless (Java na 3000)
(cd web && npm run verificar:celular) # mesmo roteiro em 390x844 + Slow 3G
```

## Pronto (confirmado com saída real)
- Fase 0: inventário em git; web/dist no .gitignore; front versionado.
- Fase 1: backend Java completo. `mvn package`: `Tests run: 20, Failures: 0, Errors: 0, Skipped: 0`, `BUILD SUCCESS`. `scripts/paridade.sh`: `PARIDADE OK (17 chamadas comparadas, campo por campo)`. Java serve ./web/dist com cache correto (teste 19).
- Fase 2: painel integrado ao Java e verificado por Playwright (devDependency só em ./web, `web/testes/fluxo-painel.mjs`):
  - desktop 1400x900: `RESULTADO: 17/17 passos ok`, `console.error: 0`, 12,5 s.
  - celular 390x844: `RESULTADO: 18/18 passos ok`, `console.error: 0`, 11,2 s.
  - celular + Slow 3G (400 kbps, 400 ms): `RESULTADO: 18/18 passos ok`, `console.error: 0`, 22 s (5,4 s até a fila aparecer).
  - Passos cobertos: iniciar fila; R1 autorizada com DEMO-AUTH-1; R2 pendente e anexar documento resolve (DEMO-AUTH-2); R3 tarefa humana com texto chegando aos poucos e origem visível; derrubar Jardim + carga com Aurora e Horizonte fluindo e disjuntor abrindo; restaurar; Aurora sem número (trava) e voltar; rodar 4 casos 4/4; linha do tempo; auditor; métricas simuladas; abertura carrega.
- Bugs corrigidos na fase 2 (sem mudar visual):
  1. Plugin de CORS do Javalin respondia 400 a qualquer requisição com header Origin fora da lista, inclusive da própria página (module script, fetch). O painel servido pelo Java não carregava. Trocado por CORS manual, igual ao Node (só Vite local recebe o cabeçalho; os outros só ficam sem ele). Teste 17b estendido.
  2. O front não ouvia o evento SSE `trecho`; o texto da IA só aparecia inteiro no `fim`. Agora chega aos poucos e o `fim` não duplica o texto.
  3. Tarefa apagada pelo backend (fila reiniciada) saía da lista mas continuava na fila de streams do front, gerando 404. Agora sai da fila.

## Decisões registradas
- IA em Java: só template (origem "template"). Não existe arquivo de ambiente real no projeto (só o `.env.example`), logo não há ANTHROPIC_API_KEY; por decisão do Zago o provedor externo não foi implementado. `/api/saude.ia.provedor` = "template" e o painel mostra "Texto padrão".
- Limite de 10 gerações de texto por minuto (spec): rodar a demo inteira mais de uma vez no mesmo minuto sem reiniciar o servidor bate em 429 (texto não aparece naquelas tarefas). O reset da demo reinicia o processo.
- `encaminhamentos_corretos` mostra 2/3 depois de anexar o documento do R2 (o kit esperava pendente_documento). É o comportamento especificado, igual no Node.

## Fase 3 verificada
- O checkpoint já continha Inter local variável, cinco cenas, lazy loading e teste da abertura.
- Corrigida barra de progresso para não usar scrub com movimento reduzido.
- Build sem warnings; abertura desktop e celular: 9/9 em cada, 59 fps médios headless, zero tarefas longas e zero erros de console. Isso não garante 60 fps em todo dispositivo.
- Mantido um único WOFF2 variável (48,43 kB), em vez de dois arquivos de pesos: preserva a tipografia aprovada. Divergência literal do limite de dois pesos registrada.

## Fase 4
- CHECKLIST e ESCALA registram os 31 pontos e limites, sem anunciar infraestrutura inexistente.
- Consultas em lote nas filas e métricas; projeções SQL explícitas; debounce/cancelamento das tarefas.
- `mvn package`: 20 testes, zero falhas; `PARIDADE OK (17 chamadas comparadas, campo por campo)`.
- Item 20 parcial (assets no build, sem pré-renderizar React); fonte variável única preserva visual.
- Primeira rodada móvel falhou durante substituição do jar em execução. Repetição com processo novo em andamento; não substituir o jar enquanto o servidor roda.

## Fase 5
- SEGURANCA documenta revisão, correções e alertas residuais de Jetty 11.
- Jackson 2.23.0, Jetty 11.0.26; CSP/headers, JSON inválido 400, caminhos protegidos, mutações serializadas e limitadas.
- Payload chunked de request smuggling recusado com conexão fechada e nenhuma ação executada.
- 25 testes JUnit passando. Painel móvel com processo novo: 18/18, zero console, 21.005 ms em Slow 3G.
- Histórico de arquivos de ambiente não verificado: hook bloqueou a consulta. Sem contornar.

## Fase 6
- Scripts demo/reset/túnel, README com arquitetura, roteiro e equipe; evidências em docs/EVIDENCIAS.md.
- Paridade final 17/17; mvn test final 25 testes; build front sem warnings.
- Três rodadas consecutivas completas: 17/17 cada, zero erros de console/página, decisões iguais após reset de processo/banco. Métricas simuladas variam naturalmente.
- Celular final Slow 3G: 18/18, zero console/página, 20.905 ms. Testes do kit HTTP 200, 4/4.
- Demo deixada ativa em 127.0.0.1:3000, fila inicial 3/3, casos 4/4. Túnel não iniciado nesta sessão.
- Nenhum arquivo do kit alterado. AGENTS.md já estava não rastreado e foi preservado.

## Falta
- Fase 7: entregar relatório final. Pendências de produto/escala e ressalvas de segurança estão no CHECKLIST, ESCALA e SEGURANCA; não são anunciadas como implementadas.

## Próximo passo exato
Fase 7: registrar o relatório e informar comando único, resultados e ressalvas.
