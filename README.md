# Autorizador Inteligente de convênios

Desafio 3 do Hack Inova (Health AI) — equipe Gubo Club. Fila observável de autorização com
três convênios fictícios, API simulada, disjuntor por convênio e encaminhamento humano
rastreável. Dados 100% sintéticos, vindos de `./kit`.

Princípio: **a IA sugere, a regra decide, o humano resolve a exceção.**

## Como rodar

```bash
source scripts/env.sh                 # JDK 21 e Maven locais, de ./.tools
mvn -f backend package                # gera backend/target/autorizador.jar
java -jar backend/target/autorizador.jar
```

Sobe em `http://127.0.0.1:3000` (porta por `PORT`, host por `HOST`). O front de
`./web/dist` é servido na raiz quando a pasta existir.

Testes: `mvn -f backend test`.

## Estrutura

| Pasta | O que é |
|---|---|
| `backend/` | O backend, em Java 21 + Javalin. É o que roda na demo. |
| `kit/` | Pacote de apoio do evento. Fonte da verdade dos dados e das regras. |
| `referencia-node/` | O backend anterior, em Node. Mantido como especificação viva e base da prova de paridade. |
| `web/` | Front (outra frente de trabalho). |
| `scripts/` | `env.sh` (ambiente Java) e `paridade.sh` (prova Node x Java). |
| `docs/` | Preparação do desafio. |

## Prova de paridade

O backend Java tem que responder igual ao Node em endpoint, nome de campo, valor e
mensagem. A prova é automatizada:

```bash
npm run paridade     # ou: bash scripts/paridade.sh
```

Sobe o Node na 3001 e o Java na 3000, roda a mesma sequência de 17 chamadas nos dois e
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
| `DETALHAR_ERROS` | `1` devolve o detalhe técnico do erro na resposta. Só local. |

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
