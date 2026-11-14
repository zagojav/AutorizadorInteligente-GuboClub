# Método da equipe — Health AI, PUC Consolação
12/09/2026 · 09h às 19h. Sequência sugerida; respeite a agenda da organização.

## Antes do código
1. Pesquise a dor por quatro perspectivas: usuário, operação, técnica e negócio.
2. Registre as fontes e separe evidências de hipóteses.
3. Compare propostas e escolha uma microjornada.
4. Outra pessoa ou agente questiona: alguém quer, sustenta, cabe no dia? Onde falha?
5. Desenhe entrada, sucesso, erro, espera e ajuda humana.

## Oito campos para enquadrar a dor
Preencha com o brief e converse com um mentor. Quando faltar evidência, escreva “hipótese a verificar”.

1. Contexto: onde acontece, em qual operação e escala?
2. Persona: quem usa, qual tarefa precisa concluir e quais dificuldades enfrenta?
3. Momento: qual situação concreta dispara o problema?
4. Processo atual: como a pessoa resolve hoje, passo a passo?
5. Custo: quanto tempo, retrabalho ou dinheiro se perde? Registre fonte ou estimativa.
6. Frequência: com que frequência acontece e em qual período observado?
7. Quem paga e quem sofre: quem decide, quem tem orçamento e quem sente a dor?
8. Alternativas: quais soluções existem e onde deixam essa jornada incompleta?

## Crítica com perspectivas simuladas
Exercício opcional do brainstorm: peça ao agente do time para simular 12 perspectivas — três pessoas da recepção, três da gestão, quatro pacientes com necessidades diversas e duas de auditoria/privacidade. Identifique todas como fictícias. Para cada uma, registre uma objeção, o impacto e qual evidência real ajudaria a respondê-la. Termine com as três maiores incertezas e um ajuste no recorte.

Não invente entrevistas, reclamações encontradas na internet, intenção de compra ou métricas. A simulação ajuda a formular perguntas; não valida mercado nem substitui conversa com pessoas. Não há nota de aprovação obrigatória no kit.

## Coordenação
Uma tarefa, um responsável, uma pasta. Orquestrador define prioridades; implementador entrega uma tarefa; integrador junta e testa; crítico questiona premissas. Uma pessoa pode acumular papéis.

Com Git já inicializado e ao menos um commit:
```bash
git worktree add ../health-interface -b tarefa/interface
git worktree add ../health-api -b tarefa/api
```
Cada worktree precisa de porta, variáveis e dados de teste próprios quando aplicável. Combine arquivos compartilhados e contratos antes de dividir o trabalho. Worktrees reduzem colisões de arquivos, mas não eliminam conflitos na integração.

## Cartão de tarefa
- ID e título
- Responsável
- Arquivos e branch
- Dependências
- Critério de pronto
- Caso de erro

## Demo
Uma entrada → uma decisão → uma ação → uma saída → humano quando necessário.
Apresente problema, demonstração, evidências, limites e próximo passo. Confirme o tempo, a ordem e os critérios da apresentação com a organização.

## Evidências
Concordância entre agentes não prova uma hipótese. Métrica sintética não equivale a resultado clínico. Nenhuma sugestão de ferramenta é requisito de participação.
