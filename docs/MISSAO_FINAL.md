# MISSÃO FINAL: Autorizador Inteligente (Gubo Club, Hack Inova, Desafio 3)

Você é o único engenheiro do projeto agora: backend, front, segurança, operação e documentação. Execute TUDO deste arquivo até o fim, em uma sessão, sem parar pra pedir confirmação. Só pare e pergunte se uma ação for irreversível fora desta pasta.

Prazo: o código congela às 15:00 (horário de São Paulo). Rode `date` no início de cada fase. No fim de CADA fase: atualize docs/ESTADO.md (fase concluída, o que funciona, próximo passo exato, comandos pra rodar) e faça commit com a mensagem "fase N concluída". Se a sessão cair, outra IA continua a partir do ESTADO.md.

## REGRAS GERAIS
- Carregue a skill secure-code e siga durante tudo. Da skill hackathon, use só spec first e auditoria com evidência (sem setup, sem worktrees, sem branches).
- O kit em ./kit é a fonte da verdade. Nunca altere ./kit.
- Só dados sintéticos do kit. Nenhuma métrica inventada: todo número na tela vem da API. Tudo que é simulado aparece como "simulado".
- Princípio: a IA sugere, a regra decide, o humano resolve a exceção. A IA nunca muda status nem cria número de autorização.
- Código comentado em português, nomes em português quando possível.
- A ORGANIZAÇÃO EXIGE O BACKEND EM JAVA. O front pode ser React.
- Teste antes de dizer que funciona. Mostre a saída real.

## FASE 0: INVENTÁRIO (5 min)
1. `git status`, `git log --oneline | head -20`, árvore do projeto (sem node_modules, .tools, target).
2. Duas sessões anteriores foram interrompidas no meio: uma migrando o backend pra Java (./backend, ./.tools, ./scripts) e outra fazendo a página de abertura do front (./web). Descubra exatamente o que cada uma deixou pronto, pela metade ou quebrado.
3. Escreva docs/ESTADO.md com: pronto, pela metade, falta. Continue sem refazer o que está certo.

## FASE 1: BACKEND JAVA COM PARIDADE TOTAL (prioridade máxima)
O backend Node (./server e ./test, ou ./referencia-node se já movido) é a ESPECIFICAÇÃO VIVA. O Java reproduz exatamente os mesmos endpoints, JSONs (nomes de campos idênticos), eventos SSE e regras. Leia o Node inteiro antes. Leia ./docs/PASSO2.md.

Ambiente: se não houver JDK 21, baixe o Temurin 21 macOS x64 de https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jdk/hotspot/normal/eclipse em ./.tools/jdk. Se não houver Maven, baixe o binário oficial Apache Maven 3.9 em ./.tools/maven. scripts/env.sh exporta JAVA_HOME e PATH. Não use Homebrew (Mac Intel compila do zero). .tools no .gitignore.

Stack: Java 21, Maven, Javalin 6, org.xerial sqlite-jdbc, Jackson, java.net.http.HttpClient, JUnit 5. Pasta ./backend. maven-shade gera backend/target/autorizador.jar. Porta 3000 (env PORT), host 127.0.0.1 (env HOST). Pacote br.gubo.autorizador. Classes: Aplicacao, Banco, ApiSimulada, Motor, Disjuntor, FilaPorConvenio, Eventos, Auditor, Metricas, Rotas, TempoReal, Ia.

Porte fiel:
1. Banco e seed do kit idênticos (tabelas, colunas, índices, WAL, PreparedStatement sempre, só as colunas necessárias nos SELECT, sem N+1).
2. API simulada /mock/:convenio/autorizar: modos normal, caos, sem_numero; latência 100 a 800 ms (fixa por env MOCK_LATENCIA_MS); modo_simulado por chamada como no Node.
3. Motor: regra do convênio; chamada HTTP real com timeout pelo tempo_limite_ms; TRAVA: sem número nunca autoriza; motivo e regra_usada em toda decisão; evento em toda transição.
4. Fila isolada por convênio (um executor por convênio), retentativa 200/400/800 ms, disjuntor fechado/aberto/meio_aberto (3 falhas, 15 s), reset previsível em /api/fila/iniciar e /restaurar.
5. Todas as rotas do Node (incluindo /api/solicitacoes/:id/reprocessar, /api/convenios/:id/modo, /api/simulacao/carga, /api/testes/rodar, /api/tarefas/:id/texto-ia/stream) com a mesma validação (^DEMO-(R|S)[0-9]{1,4}$, enum de convênio e modo), respostas de erro curtas, bodyLimit 64 KB, headers no-store e nosniff, CORS só localhost:5173.
6. SSE /api/stream: solicitacao_atualizada, disjuntor_mudou, tarefa_criada, metricas (no máximo 1/s) e modo_mudou ({convenio, modo, disjuntor}, emitido em /modo, /derrubar, /restaurar e /fila/iniciar). Heartbeat 15 s, retry 2000, remove o cliente ao desconectar.
7. Auditor (mesmos alertas, ignorando sintéticas), métricas (p50 e p95 da tabela chamadas, 3/3, 4/4, simulado: true), /api/testes/rodar hermético.
8. Gzip em tudo EXCETO text/event-stream. Estáticos de ./web/dist em /, com cache longo nos arquivos com hash e no-cache no index.html; fallback para index.html fora de /api e /mock.
9. Ia: se existir ANTHROPIC_API_KEY no .env, usa a API da Anthropic por HTTP com streaming, modelo por env IA_MODELO (padrão claude-haiku-5-5), timeout 8 s, max_tokens 300, enviando só os campos necessários. Sem chave, erro ou timeout: template determinístico, também transmitido aos poucos. Todo texto guarda origem "ia" ou "template". Nunca rotular template como IA. Chave nunca em log, resposta ou front. Limite: 1 geração simultânea por tarefa, 10 por minuto no total. Resumo do documento do DEMO-R2 no campo sugestao_ia do evento de anexo.

Prova obrigatória:
- scripts/paridade.sh: Node na 3001 e Java na 3000, mesma sequência nos dois (iniciar fila, fila, linha do tempo do DEMO-R2, anexar documento, derrubar jardim, carga, auditoria, métricas, aurora sem_numero + reprocessar, testes/rodar), compara JSONs ignorando horários, latências e ids gerados. Resultado "PARIDADE OK".
- JUnit: 4 casos do kit, trava sem número, anexo do R2, disjuntor abrindo e bloqueando, meio_aberto, auditor com os 8 alertas obrigatórios, gzip fora do SSE, validação de parâmetros, IA nunca muda status, IA cai no template sem chave e com timeout.
- Depois da PARIDADE OK: mova o Node pra ./referencia-node (não apague) e deixe o package.json da raiz só com scripts de apoio. Commit.

## FASE 2: INTEGRAÇÃO DO FRONT COM O JAVA
1. O painel (/#/painel) já está pronto e aprovado. Não mude o visual nem o comportamento; só corrija bug.
2. cd web && npm run build sem erro nem warning. O Java serve ./web/dist.
3. Com o Java no ar, verifique cada fluxo do painel pela API e, se possível, com um navegador headless (Playwright, instalado só em ./web como devDependency): iniciar fila, R1 autorizada com DEMO-AUTH-1, R2 pendente e anexar documento resolve, R3 tarefa humana com texto chegando aos poucos, derrubar Jardim + carga com Aurora e Horizonte fluindo e disjuntor abrindo, Aurora sem número e voltar, rodar 4 casos dando 4/4, linha do tempo, auditor, métricas. Zero erro no console.
4. Commit.

## FASE 3: PÁGINA DE ABERTURA (/)
Termine a abertura narrativa que a sessão anterior começou, seguindo o que já existe em ./web. Especificação:
- Lenis integrado ao GSAP ScrollTrigger (lenis.on('scroll', ScrollTrigger.update), lenis.raf no gsap.ticker, lagSmoothing(0)), destruído ao desmontar. Scrollbar personalizada fina na cor da marca (#0F5C63) e barra de progresso no topo.
- Cena 1: "Um convênio cai. A fila inteira para." revelado palavra por palavra; três círculos (convênios) orbitando e crescendo com o scroll; indicador "role pra começar".
- Cena 2: fila única de cartões; o Jardim fica vermelho e a fila congela atrás dele, ficando cinza. Texto: "Hoje, uma integração fora do ar segura todos os pedidos."
- Cena 3: a fila se divide em três trilhos; a chave do disjuntor do Jardim gira e abre; os pedidos dele desviam pro ícone de pessoa; Aurora e Horizonte seguem fluindo.
- Cena 4: "A IA sugere." "A regra decide." "O humano resolve a exceção." uma por vez.
- Cena 5: miniatura do painel cresce de scale 0.3 até cobrir a tela, com rotação 3D que endireita (sensação de entrar nela); botão "Abrir painel ao vivo" leva a /#/painel.
- Só transform e opacity; gsap.matchMedia com versão simples no celular; prefers-reduced-motion sem Lenis e sem scrub. Código da abertura carregado sob demanda (React.lazy), pra não pesar o painel. Fontes hospedadas localmente, no máximo 2 pesos.
- REGRA DE CORTE: se às 14:30 alguma cena não estiver lisa a 60 fps, simplifique essa cena (fade e escala sem pin). Nunca entregue cena travando.
- Commit.

## FASE 4: CHECKLIST DE 31 PONTOS
Implemente o que se aplica e documente o resto em docs/ESCALA.md como "pronto para escalar" (vira slide do pitch). Para cada ponto, escreva em docs/CHECKLIST.md: feito (onde, com prova), não se aplica (por quê) ou próximo passo.
1 skeleton; 2 imagens WebP/AVIF; 3 sem chamadas duplicadas; 4 debounce; 5 paginação da API; 6 estáticos por CDN; 7 tarefas lentas em fila; 8 sem N+1; 9 gzip/Brotli; 10 cache Redis; 11 remover dependências não usadas; 12 timeout em APIs externas; 13 IA token por token; 14 tela atualiza sem esperar o servidor; 15 lazy loading de imagens; 16 requisições independentes em paralelo; 17 índices; 18 OpenTelemetry; 19 servidor perto do banco; 20 renderizar no build; 21 scripts de terceiros depois; 22 dividir JS por página; 23 virtualizar listas longas; 24 só as colunas necessárias; 25 pool de conexões; 26 evitar re-render; 27 cache de estáticos no navegador; 28 várias instâncias; 29 fontes hospedadas e poucos pesos; 30 monitorar usuários reais; 31 testar no celular e em rede lenta.
Obrigatórios na demo: 1, 3, 4, 7, 8, 9, 11, 12, 13, 14, 16, 17, 20, 22, 24, 26, 27, 29, 31. Para o 31, rode o painel com Playwright emulando celular (390x844) e rede lenta (Slow 3G) e registre o resultado.
Commit.

## FASE 5: SEGURANÇA
Rode a revisão da skill secure-code em todo o projeto (Java e front). Corrija tudo de severidade alta ou média. Escreva docs/SEGURANCA.md com o que foi verificado, o que foi corrigido e os limites conhecidos. Rode o scanner da skill se o ambiente permitir (precisa de Bash 4 e GNU grep); se não permitir, registre isso. Commit.

## FASE 6: OPERAÇÃO DA DEMO
1. scripts/demo.sh: carrega env.sh, builda front e Java se necessário, sobe o jar, espera /api/saude responder, chama /api/fila/iniciar e imprime as URLs (local e https://autorizador.zagolabs.com.br).
2. scripts/tunel.sh: roda `~/cloudflared tunnel run --url http://localhost:3000 gubo` (o túnel gubo já existe e o DNS já aponta).
3. scripts/reset.sh: deixa o estado limpo pra próxima rodada da demo.
4. README.md: o que é, como rodar (um comando), arquitetura em 10 linhas, roteiro da demo em 8 passos, limites, próximos passos (adaptador por convênio no padrão TISS da ANS, editor de regras versionado), créditos da equipe (Gabriel Rodrigues, Guilherme Lima, Guilherme Zago).
5. docs/EVIDENCIAS.md: saída real de mvn test, paridade, testes/rodar 4/4, métricas de uma rodada (marcadas simuladas), auditoria. Nada inventado.
6. Rode o roteiro completo da demo 3 vezes seguidas com reset entre elas e confirme resultado idêntico. Commit.

## FASE 7: RELATÓRIO FINAL
Me mostre, curto:
- Saída de mvn test, paridade e build do front.
- Resultado das 3 rodadas da demo.
- docs/CHECKLIST.md resumido.
- O que ficou de fora e por quê.
- Comando único pra subir a demo.
