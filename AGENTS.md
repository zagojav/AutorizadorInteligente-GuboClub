# AGENTS.md: Autorizador Inteligente (Gubo Club, Hack Inova, Desafio 3)

Este arquivo é lido automaticamente pelo Codex. Ele vale para QUALQUER IA que assumir este projeto.

## O que é
Fila observável de autorizações de convênios, com 3 convênios fictícios do kit: Aurora (autoriza), Horizonte (exige documento) e Jardim (fora do ar, vira tarefa humana). Diferenciais: fila isolada por convênio, disjuntor, retentativa com espera crescente, trava (sem número de autorização nunca vira autorizada), auditor de divergências do kit, métricas simuladas (p50 e p95), tempo real por SSE, e IA que só redige texto pro humano.

Princípio do pitch: a IA sugere, a regra decide, o humano resolve a exceção.

## Prazo
O código congela às 15:00 de São Paulo. Rode `date` agora. Depois das 15:00 só se corrige bug. Nada de recurso novo.

## Como retomar o trabalho (nesta ordem)
1. Leia docs/ESTADO.md (onde parou). Se não existir, comece pela FASE 0 do docs/MISSAO_FINAL.md.
2. Leia docs/MISSAO_FINAL.md inteiro. Ele tem as fases 0 a 7.
3. Rode `git log --oneline | head -20` e `git status`. O último commit "fase N concluída" mostra o progresso. Houve um commit "checkpoint antes de trocar de IA".
4. ANTES de mudar qualquer coisa, rode os testes pra saber a linha de base e me diga o resultado.
5. Continue da primeira fase não concluída. Não refaça o que está certo.
6. No fim de cada fase: atualize docs/ESTADO.md (fase concluída, o que funciona, próximo passo exato) e faça commit "fase N concluída".

## Onde o MISSAO_FINAL.md fala em "skill"
O Claude Code usava skills. Você é outra IA, então:
- Onde estiver "carregue a skill secure-code", leia ~/.claude/skills/secure-code/SKILL.md e siga como checklist de segurança (se o arquivo não existir, aplique boas práticas: prepared statements, validação de entrada, sem segredo em log, sem caminho vindo do usuário).
- Ignore a skill "hackathon". Não crie worktrees nem branches.

## Regras que NÃO podem ser quebradas
- A ORGANIZAÇÃO EXIGE O BACKEND EM JAVA (./backend). O front é React em ./web. O Node antigo em ./referencia-node é só referência de comportamento.
- ./kit é a fonte da verdade e NUNCA é alterado. Só dados sintéticos.
- Os 4 casos de kit/scenarios/03-casos.md dão exatamente o resultado esperado. Divergências entre arquivos viram alerta do auditor e nunca mudam o resultado.
- Nenhuma métrica inventada. Todo número na tela vem da API. Tudo que é simulado aparece marcado como "simulado".
- A IA nunca muda status e nunca cria número de autorização. Texto de template NUNCA é rotulado como IA.
- Não mude o visual nem o comportamento do painel (/#/painel) e da abertura (/). Só corrija bug.
- Código comentado em português, com nomes em português quando possível.
- Teste antes de afirmar que funciona e mostre a saída real do teste.
- Segredo (.env, chaves) nunca vai pra log, resposta, front ou commit.
- Nunca mexa fora desta pasta: ~/.ssh, ~/.cloudflared e ~/chaves são proibidos. Nunca sirva a pasta pessoal por HTTP.
- Nunca duas IAs na pasta ao mesmo tempo. Se houver um processo do Claude Code aberto, pare e avise.

## Comandos
- Ambiente Java: `source scripts/env.sh` (JDK e Maven ficam em ./.tools; não use Homebrew, o Mac é Intel).
- Testes do backend: `mvn -f backend test`
- Gerar o jar: `mvn -f backend package` e rodar com `java -jar backend/target/autorizador.jar` (porta 3000, host 127.0.0.1)
- Front: `cd web && npm run build` (o Java serve web/dist em /)
- Paridade Java x Node: `scripts/paridade.sh` (resultado esperado: PARIDADE OK)
- Demo completa: `scripts/demo.sh` (se ainda não existir, é tarefa da FASE 6)
- Link público: `~/cloudflared tunnel run --url http://localhost:3000 gubo` (domínio autorizador.zagolabs.com.br)
- Telas: http://127.0.0.1:3000/ (abertura) e http://127.0.0.1:3000/#/painel (painel)

## Plano B se tudo falhar
O backend Node antigo funciona e tem 33 testes passando: `cd referencia-node && npm start`, depois abrir http://127.0.0.1:3000/#/painel.

## Entrega final (FASE 7)
Mostre: saída de mvn test, paridade, build do front, resultado de 3 rodadas seguidas da demo com reset entre elas, docs/CHECKLIST.md resumido, o que ficou de fora e o comando único pra subir a demo.
