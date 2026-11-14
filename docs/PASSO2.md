# PASSO 2: resiliência, auditor, métricas e tempo real (já implementado no backend Node; referência de comportamento)

AJUSTES SOBRE O PASSO 1
  A validação de :id aceita também as sintéticas: ^DEMO-(R|S)[0-9]{1,4}$.
  HOST padrão 127.0.0.1. A demo pública vai por túnel no localhost.
  Rota /api/convenios/:id/modo {modo} (normal, caos, sem_numero) e /api/solicitacoes/:id/reprocessar.
  Disjuntor de verdade: aberto bloqueia a chamada.
  Demo previsível: POST /api/fila/iniciar fecha todos os disjuntores, zera falhas_seguidas e volta os modos pro padrão do kit (aurora e horizonte normal, jardim fora). POST /api/convenios/:id/restaurar faz o mesmo só para aquele convênio.

1. FILA ISOLADA POR CONVÊNIO
  Um worker por convênio (aurora, horizonte, jardim), cada um com sua fila, alimentada pelo banco. Um worker travado nunca bloqueia os outros.
  POST /api/simulacao/carga: cria 5 solicitações sintéticas por convênio (DEMO-S001 em diante, sintetica = 1, procedimento igual ao do caso do kit daquele convênio). Limite de 50 sintéticas; acima disso apaga as mais antigas.

2. RETENTATIVA COM ESPERA CRESCENTE
  Falha de integração (503, timeout ou erro de rede): tenta de novo após 200 ms, 400 ms e 800 ms. Máximo 3 tentativas, gravadas em solicitacoes.tentativas e em evento.
  Depois da 3ª falha: erro_integracao e tarefa_humana automática com motivo escrito, ex: "Jardim fora do ar após 3 tentativas (HTTP 503)". Prioridade alta, prazo de 2 horas.

3. DISJUNTOR POR CONVÊNIO
  Estados: fechado, aberto, meio_aberto. Abre após 3 falhas seguidas.
  Aberto: novas solicitações daquele convênio NÃO chamam a API; vão direto pra tarefa_humana com motivo "disjuntor aberto: Jardim indisponível".
  Após 15 s aberto, vira meio_aberto e faz 1 chamada de teste. Sucesso fecha; falha volta pra aberto.
  Toda mudança grava evento e emite no SSE.
  POST /api/convenios/:id/derrubar (modo caos) e POST /api/convenios/:id/restaurar. Só aceitam aurora, horizonte ou jardim.

4. AUDITOR DE CONSISTÊNCIA
  GET /api/auditoria devolve alertas {tipo, referencia, descricao, fonte, muda_resultado: false}. Tipos: convenio_divergente, procedimento_fora_da_regra, guia_conflitante, cadastro_irregular, sem_consentimento. Ignora as sintéticas.
  Obrigatórios, encontrados lendo os dados (sem fixar no código):
    DEMO-R1: paciente DEMO-P001 é Horizonte Demo no cadastro e Aurora Demo na fila
    DEMO-R1: procedimento DEMO-2, mas a regra da Aurora só cobre DEMO-1
    DEMO-R2: paciente DEMO-P002 é Jardim Demo no cadastro e Horizonte Demo na fila
    DEMO-R2: procedimento DEMO-3, mas a regra da Horizonte só fala de DEMO-2
    DEMO-R3: paciente DEMO-P003 é Aurora Demo no cadastro e Jardim Demo na fila
    DEMO-R3: guia DEMO-OS003 está pronta com DEMO-AUTH-3, mas a fila diz serviço indisponível
    DEMO-P001 cadastro divergente e DEMO-P002 cadastro incompleto
    DEMO-P004 e DEMO-P008 sem consentimento de contato

5. MÉTRICAS DA SIMULAÇÃO
  Tabela chamadas: convenio, solicitacao, latencia_ms, sucesso, horario. Grava toda chamada à API simulada.
  GET /api/metricas devolve {simulado: true, falhas_detectadas, latencia_p50_ms, latencia_p95_ms, por_convenio, encaminhamentos_corretos: "3/3", casos_kit: "4/4", tarefas_abertas}.
  encaminhamentos_corretos compara DEMO-R1, R2 e R3 com status_esperado_kit (autorizado = autorizada, pendente_documento = pendente_documento, servico_indisponivel = tarefa_humana).
  p50 e p95 calculados das latências reais. Nenhum número fixo no código.

6. TEMPO REAL POR SSE
  GET /api/stream, text/event-stream, heartbeat 15 s, retry: 2000.
  Eventos: solicitacao_atualizada, disjuntor_mudou, tarefa_criada, metricas (no máximo 1/s) e modo_mudou ({convenio, modo, disjuntor}).
  Remove o listener quando o cliente desconecta.

7. SERVIDOR
  Gzip em tudo EXCETO text/event-stream.
  Estáticos de ./web/dist em /.
  CORS só pra localhost:5173 em desenvolvimento.
