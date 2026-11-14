# Checklist de 31 pontos

Verificação em 14/11/2026. Feito significa implementado; limites e divergências ficam explícitos.

| # | Ponto | Situação e prova |
|---|---|---|
| 1 | Skeleton | Feito: `Estado.jsx`, blocos do painel durante carga. |
| 2 | WebP/AVIF | Não se aplica: interface usa CSS/SVG, sem fotografias. |
| 3 | Chamadas duplicadas | Feito na demo: SSE incremental, reconciliação com debounce, botões ocupados. StrictMode pode duplicar efeitos apenas em desenvolvimento. |
| 4 | Debounce | Feito: `usePainel.js`, fila, saúde e tarefas; cancelamento no desmonte. |
| 5 | Paginação | Próximo passo: fila limitada a 50 sintéticas + 3 do kit; eventos ainda crescem, ver ESCALA. |
| 6 | CDN | Próximo passo: assets com hash e cache preparados, CDN não provisionada. |
| 7 | Fila | Feito: `FilaPorConvenio`, executor isolado por convênio; teste de carga do painel. |
| 8 | Sem N+1 | Feito nas listagens/auditor e métricas; enfileiramento em lote e métricas agrupadas. Motor consulta por trabalho, não por renderização da lista. Paridade 17 chamadas. |
| 9 | Gzip | Feito: `Aplicacao`, testes JUnit; SSE excluído. |
| 10 | Redis | Não se aplica à instância única e ao volume sintético. Plano em ESCALA. |
| 11 | Dependências usadas | Feito: React/Router/GSAP/Lenis em uso; Playwright/Vite no desenvolvimento. Dependências da raiz atendem à referência Node e à paridade. |
| 12 | Timeout | Feito: `Motor`, limite por convênio em cada HTTP request. |
| 13 | Texto incremental | Feito: eventos `trecho`, `origem`, `fim`; template rotulado corretamente. Provedor LLM ficou fora por decisão registrada. |
| 14 | Atualização imediata | Feito: estado ocupado e SSE durante processamento; status final continua vindo do servidor. |
| 15 | Lazy de imagens | Não se aplica: não há imagens raster na interface. |
| 16 | Paralelismo | Feito: `Promise.all` na carga inicial e workers independentes. |
| 17 | Índices | Feito: `Banco.criarTabelas`, índices de convênio/status, eventos e chamadas. |
| 18 | OpenTelemetry | Próximo passo: métricas da demo são locais, sem exportador distribuído. |
| 19 | Servidor perto do banco | Feito: SQLite no mesmo processo/máquina. |
| 20 | Renderizar no build | Parcial: Vite gera assets estáticos; React renderiza no cliente. Pré-renderização HTML fica como próximo passo para preservar a abertura aprovada. Não confundir bundle com SSR/SSG. |
| 21 | Terceiros depois | Não se aplica: zero requests a terceiros, ver teste da abertura. |
| 22 | JS por página | Feito: `React.lazy` para abertura e painel; chunks separados no build. |
| 23 | Virtualização | Não se aplica ao volume atual de até 53 cartões; reavaliar ao paginar. |
| 24 | Colunas necessárias | Feito: projeções explícitas no Java, preservando contrato da paridade; contexto textual minimizado. |
| 25 | Pool | Não se aplica ao SQLite da demo: uma conexão com trava curta, sem HTTP dentro da trava. |
| 26 | Re-render | Feito: `memo`, `useMemo` e preservação de identidade dos cartões. |
| 27 | Cache | Feito: assets hash immutable 1 ano; HTML no-cache; API no-store; JUnit. |
| 28 | Várias instâncias | Próximo passo: fila, disjuntor e SSE estão em memória. Não anunciar suporte atual. |
| 29 | Fonte local | Feito com divergência: um WOFF2 Inter variável de 48,43 kB, não dois pesos fixos. Preservada a tipografia aprovada. Zero Google Fonts. |
| 30 | Monitorar usuários | Próximo passo: não há RUM/telemetria externa. |
| 31 | Celular/rede lenta | Roteiro Playwright 390x844, 400 kbps e 400 ms. Resultado final registrado em EVIDENCIAS. |

O item obrigatório 20 permanece parcial; 13 usa template incremental e 29 usa fonte variável única. Não se declara cumprimento literal de todos os obrigatórios.
