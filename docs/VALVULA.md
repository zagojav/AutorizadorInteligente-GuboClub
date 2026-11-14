# VÁLVULA DE ESCAPE: continuar o projeto em outra IA

Use se o limite do Claude acabar. Funciona em qualquer agente de código que leia arquivos e rode terminal (Codex CLI, Gemini CLI, Cursor, Copilot, Windsurf etc.). Abra o agente dentro de ~/gubo-autorizador e cole o prompt abaixo.

```
Você está assumindo um projeto de hackathon que outra IA estava construindo. Não recomece do zero.

CONTEXTO
Projeto: Autorizador Inteligente, equipe Gubo Club, Hack Inova Health AI, Desafio 3. Fila observável de autorizações com 3 convênios fictícios (Aurora autoriza, Horizonte exige documento, Jardim fora do ar vira tarefa humana). Diferenciais: fila isolada por convênio, disjuntor, retentativa, trava (sem número de autorização nunca vira autorizada), auditor de divergências do kit, métricas simuladas (p50, p95), tempo real por SSE, IA que só redige texto pro humano.
A organização EXIGE backend em Java (Java 21, Maven, Javalin, SQLite). Front em React + Vite em ./web.
Prazo: código congela às 15:00 de São Paulo. Rode `date` agora.

COMO CONTINUAR
1. Leia, nesta ordem: docs/ESTADO.md (onde parou), docs/MISSAO_FINAL.md (o plano completo em fases), README.md se existir.
2. Rode `git log --oneline | head -20` e `git status`. O último commit "fase N concluída" diz onde parou.
3. Continue a partir da primeira fase não concluída do MISSAO_FINAL.md, seguindo exatamente o que está lá.
4. Ambiente Java: `source scripts/env.sh` (JDK e Maven ficam em ./.tools). Não use Homebrew.

REGRAS QUE NÃO PODEM SER QUEBRADAS
- ./kit é a fonte da verdade e nunca é alterado. Só dados sintéticos.
- Os 4 casos de kit/scenarios/03-casos.md dão exatamente o resultado esperado. Divergências viram alerta do auditor, sem mudar o resultado.
- Nenhuma métrica inventada; tudo que é simulado aparece como "simulado". IA nunca muda status nem cria número de autorização; template nunca é rotulado como IA.
- Não mude o visual nem o comportamento do painel (/#/painel); só corrija bug.
- Código comentado em português. Teste antes de afirmar que funciona.
- No fim de cada fase: atualize docs/ESTADO.md e faça commit "fase N concluída".

ENTREGA
Ao terminar, mostre: saída dos testes, resultado da demo rodada 3 vezes e o comando único pra subir tudo (scripts/demo.sh).
```

## Se nem o ESTADO.md existir
O agente deve começar pela FASE 0 do MISSAO_FINAL.md (inventário), que reconstrói o estado a partir do código e do git.

## Último recurso (sem IA nenhuma)
O backend Node original funciona e tem 21 testes passando. Para rodar a demo com ele:
cd ~/gubo-autorizador && (cd web && npm run build) && npm start
(ou, se já movido: cd referencia-node e npm start). Abrir http://127.0.0.1:3000/#/painel.
