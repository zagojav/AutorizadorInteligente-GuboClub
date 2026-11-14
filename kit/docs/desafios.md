# Sete desafios — PUC Consolação, 12/09/2026

## 1. Recepção Sem Fila

Dor: Conferir documento, carteirinha, agendamento e guia mantém a recepção presa em tarefas repetitivas.

Construir: Um check-in assistido: documento fictício → conferência do cadastro → confirmação da guia → registro da passagem. Se algo falhar, atendimento remoto; apoio presencial para quem precisa.

Demo: Mostre três caminhos: cadastro correto, informação divergente e atendimento humano acionado.

Métrica: Tempo de check-in e proporção de casos concluídos ou escalados corretamente.

Stack sugerida: Web app + OCR + base sintética + painel de atendimento. Na OCI: Compute, Vision ou Document Understanding e APEX.

Limites: Use imagens fictícias e simule a verificação de identidade. A demo pode rodar no navegador, sem depender de totem físico.

## 2. Chegar Certo

Dor: O convênio mudou, o cadastro ficou para trás e o erro só aparece na hora do atendimento.

Construir: Um fluxo que confirma os dados antes ou na chegada, recebe a correção e atualiza uma base fictícia antes de abrir a guia.

Demo: Paciente confirma os dados → informa que mudou de convênio → cadastro é corrigido → a recepção vê a pendência resolvida.

Métrica: Divergências detectadas e corrigidas antes de gerar a guia.

Stack sugerida: Chat simulado + OCR opcional + banco + painel de divergências. Na OCI: Generative AI, Document Understanding e APEX.

Limites: Inclua quem não respondeu em casa. A validação assistida na chegada também faz parte da jornada.

## 3. Autorizador Inteligente

Dor: Cada convênio tem regras diferentes. Uma integração que falha pode travar toda a fila.

Construir: Uma fila observável com três convênios fictícios: autorização, documento pendente e serviço indisponível. Registre o resultado e encaminhe a exceção para a equipe.

Demo: Uma solicitação é autorizada, outra pede documento e uma falha vira tarefa para atendimento manual.

Métrica: Falhas detectadas, tempo de resposta e encaminhamentos corretos.

Stack sugerida: API simulada + fila + banco + dashboard. Na OCI: Compute, Autonomous Database e APEX.

Limites: Trabalhe em um portal ou API fictícia. O desafio é provar a esteira, sem depender de portais reais.

## 4. Copiloto Médico de Insights

Dor: Histórico, exames e conversa estão espalhados. Organizar esse contexto durante a consulta exige tempo.

Construir: Um copiloto que cruza prontuário sintético e transcrição simulada com uma base controlada, mostra pontos de atenção com fonte e permite ao profissional aceitar ou ignorar.

Demo: Mostre um ponto de atenção rastreável, a fonte usada e uma sugestão bloqueada por falta de evidência.

Métrica: Proporção de insights com fonte verificável e revisão do profissional.

Stack sugerida: Transcrição + busca em documentos + LLM + tela de revisão. Na OCI: Speech, Generative AI e AI Vector Search.

Limites: Somente apoio ao profissional: sem diagnóstico, prescrição ou orientação clínica automática ao paciente.

## 5. Paciente Não Fica Solto

Dor: O paciente sai com uma conduta, mas ninguém acompanha se o exame foi marcado ou se o retorno aconteceu.

Construir: Um agente que transforma uma conduta fictícia em tarefas com prazo, faz um follow-up simulado, interpreta a resposta e atualiza o kanban.

Demo: “Exame em 15 dias, retorno em 30” → duas tarefas → “não consegui marcar” → ajuda humana acionada.

Métrica: Tarefas criadas corretamente, respostas classificadas e casos encaminhados à equipe.

Stack sugerida: LLM + tarefas em JSON + chat simulado + kanban. Na OCI: Generative AI, banco e APEX.

Limites: Inclua pedido de ajuda, ausência de resposta e opção SAIR. As mensagens ficam na simulação.

## 6. Atendente IA com Regras

Dor: O atendimento precisa responder com as regras da clínica: cobertura, documentos, preparo e agendamento.

Construir: Um chat que consulta documentos fictícios, responde citando a regra e encaminha para uma pessoa quando a informação não existe ou é ambígua.

Demo: Uma pergunta com resposta e fonte; outra fora da base, encaminhada ao atendimento humano.

Métrica: Respostas corretas com fonte e exceções escaladas corretamente.

Stack sugerida: Documentos em Markdown + RAG + chat + registro das fontes. Na OCI: Object Storage, Generative AI e busca vetorial.

Limites: Use convênios inventados e regras de demonstração. Nunca apresente conteúdo sintético como orientação médica real.

## 7. Quarto Inteligente

Dor: Quartos vazios com luz e ar ligados geram desperdício; sensores sem contexto geram alertas inúteis.

Construir: Um painel que recebe eventos de sensores simulados, cruza presença e consumo e cria alertas acionáveis com confirmação humana.

Demo: Quarto vazio com ar ligado → alerta; quarto ocupado → sem ação; sensor indisponível → revisão manual.

Métrica: Alertas úteis, falsos alertas e tempo até a confirmação.

Stack sugerida: Gerador de eventos + API + dashboard. Na OCI: Compute, banco, APEX e Logging.

Limites: Hardware é opcional. A PoC não controla equipamentos reais nem altera o ambiente de um paciente.