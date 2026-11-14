# Preparação do Desafio 3: Autorizador Inteligente

Equipe Gubo Club. Hack Inova Health AI, 14/11/2026, Mackenzie Higienópolis.
Responsável pela integração e por todos os arquivos: Guilherme Zago.

Legenda: **[fonte]** veio do kit ou do brief. **[hipótese]** ainda precisa ser verificada com um mentor.

## 1. Enquadramento da dor

1. **Contexto e escala:** hospitais e clínicas recebem convênios diferentes, cada um com regras e integrações próprias. [fonte: brief] O volume diário por hospital é desconhecido. [hipótese]
2. **Persona e tarefa:** analista da equipe de autorizações, que envia a solicitação ao convênio, acompanha a resposta e trata as pendências. [fonte: brief]
3. **Momento que dispara a dor:** a integração de um convênio cai ou fica lenta, e as solicitações dos outros convênios ficam presas atrás dela. [fonte: brief]
4. **Processo atual:** recebe o pedido, consulta a regra do convênio, envia, aguarda, e quando falha refaz manualmente ou liga pro convênio. [hipótese]
5. **Custo:** retrabalho, procedimento atrasado e paciente esperando. Não temos número real e não vamos inventar. [hipótese]
6. **Frequência:** desconhecida. [hipótese]
7. **Quem paga, decide e sofre:** o hospital paga, a gestão de autorizações decide e o analista e o paciente sofrem. [hipótese]
8. **Alternativas e por que ficam incompletas:** portal de cada convênio (um por vez, sem visão única da fila) e planilha ou controle manual (sem rastro de quem decidiu e por quê). [hipótese]

## 2. Microjornada

| Etapa | O que acontece |
|---|---|
| Entrada | Solicitação com paciente, convênio e procedimento |
| Decisão | Regra fixa por convênio e procedimento (fonte REGRAS-DEMO-v1) |
| Ação | Chamada à API simulada do convênio, com timeout e retentativa |
| Saída | Autorizada (só com número), pendente de documento ou tarefa humana |
| Exceção | Convênio fora do ar, regra fora da base ou resposta sem número viram tarefa humana com motivo escrito |

Princípio: a IA sugere, a regra decide, o humano resolve a exceção.

## 3. Objeções registradas e resposta

| Objeção | Resposta |
|---|---|
| "Isso não foi testado com hospital real." | Correto. É uma PoC com dados sintéticos e API simulada. Não afirmamos validação. |
| "E se a IA errar a autorização?" | A IA não decide. Ela só redige a tarefa pro humano. A decisão é por regra fixa e auditada. |
| "Um convênio caindo ainda trava tudo?" | Não. Cada convênio tem uma fila isolada e um disjuntor. Mostramos isso ao vivo. |
| "Como saber por que uma solicitação foi negada?" | Toda decisão grava o motivo, a regra usada, a fonte e o horário em um log que só aceita inclusão. |
| "Resposta do convênio sem número vira autorizada?" | Nunca. Existe uma trava com teste automatizado. |
| "As métricas são reais?" | Não. São métricas da simulação e estão marcadas como simuladas na tela. |
| "Os dados do kit são confiáveis?" | Nosso auditor encontrou divergências (convênio diferente entre cadastro e fila, procedimento fora da regra, guia conflitante, falta de consentimento) e mostra cada uma como alerta. |

## 4. Estados de interface

Para cada tela: carregando (skeleton), vazio, sucesso, erro com mensagem clara e convênio fora do ar (selo vermelho com o disjuntor aberto).

## 5. Limites

- Sem portal real de convênio, sem dado real e sem métrica real.
- Decisão clínica é sempre do profissional.
- Regras versionadas manualmente (REGRAS-DEMO-v1).

## 6. Próximos passos

- Plugar um convênio real via API oficial.
- Editor de regras com versionamento.
- Validar as hipóteses da seção 1 com equipes de autorização.
