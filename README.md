# Autorizador Inteligente de convênios

Desafio 3 do Hack Inova (Health AI) — equipe Gubo Club. Fila observável de autorização com
três convênios fictícios, API simulada, disjuntor por convênio e encaminhamento humano
rastreável. Dados 100% sintéticos, vindos de `./kit`.

Princípio: **a IA sugere, a regra decide, o humano resolve a exceção.**

## Como rodar

```bash
bash scripts/demo.sh
```

Builda quando necessário e sobe Java em `http://127.0.0.1:3000`, abertura em `/` e painel em `/#/painel`.
Requer JDK/Maven já presentes em `.tools` e dependências do front instaladas (`npm ci --prefix web`, primeiro uso).
O script não instala dependências automaticamente. Usa SQLite em memória, só dados sintéticos; estado dura até parar.

Reset completo: `bash scripts/reset.sh`. Parar: `bash scripts/reset.sh --parar`.
Túnel existente em outro terminal: `bash scripts/tunel.sh`; URL `https://autorizador.zagolabs.com.br` depende desse processo.
Logs locais em `.runtime/demo.log`. Não substitua o jar enquanto o servidor estiver rodando.

Testes: `source scripts/env.sh` e `mvn -f backend test`.
Três rodadas de navegador: `node scripts/verificar-rodadas.mjs` (faz reset entre cada uma).
Celular/rede lenta: `npm run verificar:celular --prefix web` com servidor recém-reiniciado.
Não há lint configurado; validações disponíveis: build, JUnit, Playwright, `bash -n`, `node --check` e `git diff --check`.

## Arquitetura em 10 linhas

1. React oferece abertura narrativa e painel ao vivo, em chunks separados.
2. Java 21/Javalin serve os assets e a API na mesma origem.
3. SQLite guarda solicitações, documentos, chamadas e eventos.
4. O seed lê apenas os dados sintéticos do kit, sem alterar os arquivos.
5. Um worker por convênio mantém Aurora e Horizonte andando quando Jardim cai.
6. O motor chama o mock por HTTP com timeout, retentativa e disjuntor.
7. Nenhuma autorização existe sem número retornado pelo convênio.
8. SSE entrega transições e métricas da simulação em tempo real.
9. O auditor destaca divergências sem mudar as decisões.
10. A camada de texto só redige encaminhamento; nesta demo usa template identificado.

## Roteiro da demo em 8 passos

1. Abra `/`, percorra as cinco cenas e clique em **Abrir painel ao vivo**.
2. Clique em **Iniciar fila**: R1 autorizada, R2 pendente e R3 tarefa humana.
3. Abra a linha do tempo de R3 e mostre a origem **Texto padrão** do encaminhamento.
4. Anexe o documento de R2 e confira a autorização retornada.
5. Clique em **Derrubar Jardim** e **Gerar carga**; mostre os outros convênios fluindo.
6. Restaure Jardim; ligue **Aurora sem número** para provar a trava, depois desligue.
7. Clique em **Rodar 4 casos** e confira 4/4, auditoria e métricas marcadas simuladas.
8. Rode `bash scripts/reset.sh` para a próxima apresentação, limpando também os limites de geração.

## Estrutura

| Pasta | O que é |
|---|---|
| `backend/` | O backend, em Java 21 + Javalin. É o que roda na demo. |
| `kit/` | Pacote de apoio do evento. Fonte da verdade dos dados e das regras. |
| `referencia-node/` | O backend anterior, em Node. Mantido como especificação viva e base da prova de paridade. |
| `web/` | Front React integrado ao Java e testes Playwright. |
| `scripts/` | `env.sh` (ambiente Java) e `paridade.sh` (prova Node x Java). |
| `docs/` | Preparação do desafio. |

## Prova de paridade

O backend Java tem que responder igual ao Node em endpoint, nome de campo, valor e
mensagem. A prova é automatizada:

```bash
npm run paridade     # ou: bash scripts/paridade.sh
```

Pare a demo antes (`bash scripts/reset.sh --parar`). Sobe o Node na 3001 e o Java na 3000, roda a mesma sequência de 17 chamadas nos dois e
compara os JSONs campo por campo, ignorando só horários, latências e ids gerados. Imprime
`PARIDADE OK` ou a lista de diferenças.

## Variáveis de ambiente

Todas opcionais; sem nenhuma, o projeto roda. Lidas de propriedade de sistema ou do ambiente.

| Nome | Para que |
|---|---|
| `PORT`, `HOST` | Porta (3000) e host (127.0.0.1). |
| `BANCO_ARQUIVO` | Arquivo SQLite (`gubo_autorizador.db`). |
| `MOCK_LATENCIA_MS` | Fixa a latência da API simulada (padrão: 100 a 800 ms aleatório). |
| `ESPERAS_RETENTATIVA_MS` | Espera entre tentativas (padrão `200,400,800`). |
| `DISJUNTOR_ESPERA_MS` | Tempo até o disjuntor virar meio_aberto (padrão 15000). |
| `IA_ATRASO_TEMPLATE_MS` | Ritmo da transmissão do texto da tarefa (padrão 15). |

## Endpoints

| Método e rota | O que faz |
|---|---|
| `GET /api/saude` | Estado dos convênios, modos, filas e provedor de texto. |
| `GET /api/fila` | A fila inteira. |
| `POST /api/fila/iniciar` | Rodada previsível: fecha disjuntores, zera falhas, volta modos e processa tudo. |
| `GET /api/solicitacoes/:id/linha-do-tempo` | Eventos em ordem (log que só aceita inclusão). |
| `POST /api/solicitacoes/:id/reprocessar` | Reprocessa uma, sem mexer em modo nem disjuntor. |
| `POST /api/solicitacoes/:id/documentos` | Anexa o documento do kit, devolve `sugestao_ia` e reprocessa. |
| `GET /api/tarefas` | Tarefas humanas abertas. |
| `GET /api/tarefas/:id/texto-ia/stream` | Texto de encaminhamento por SSE, com a origem. |
| `POST /api/convenios/:id/modo` | Troca o modo (`normal`, `caos`, `sem_numero`). |
| `POST /api/convenios/:id/derrubar` | Botão "derrubar Jardim". |
| `POST /api/convenios/:id/restaurar` | Volta o convênio ao estado do kit. |
| `POST /api/simulacao/carga` | 5 solicitações sintéticas por convênio, pra ver fluxo ao vivo. |
| `GET /api/auditoria` | Alertas de inconsistência nos dados do kit, com fonte. |
| `GET /api/metricas` | p50/p95 das chamadas reais, encaminhamentos e casos do kit. |
| `POST /api/testes/rodar` | Roda os 4 casos do kit num banco em memória. |
| `GET /api/stream` | SSE: `solicitacao_atualizada`, `disjuntor_mudou`, `modo_mudou`, `tarefa_criada`, `metricas`. |
| `POST /mock/:convenio/autorizar` | A API fictícia do convênio. |

## Limites

PoC com dados sintéticos e API simulada. As métricas são da simulação (vão marcadas com
`simulado: true`) e não equivalem a resultado com paciente real. Decisão clínica é sempre do
profissional. Nenhuma autorização é emitida sem número devolvido pelo convênio.

Sem autenticação, múltiplas instâncias ou provedor LLM externo. Fonte Inter local variável única;
HTML React ainda não é pré-renderizado. Jetty 11 tem alertas residuais e mitigação de chunked,
detalhados em [SEGURANCA](docs/SEGURANCA.md). Não usar com dados reais.
O Maven Shade pode avisar sobre recursos de licença/módulos sobrepostos; o build do front não tem warnings.

Evidências: [EVIDENCIAS](docs/EVIDENCIAS.md), [CHECKLIST](docs/CHECKLIST.md), [ESCALA](docs/ESCALA.md).
Próximos passos: adaptadores por convênio no padrão TISS da ANS, editor de regras versionado,
autenticação por organização e migração para runtime web suportado antes de produção.

## Equipe

Gabriel Rodrigues, Guilherme Lima e Guilherme Zago.
