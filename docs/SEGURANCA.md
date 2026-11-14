# Revisão de segurança

14/11/2026. Escopo: Java 21/Javalin 6/SQLite, React/Vite, referência Node, scripts e HTTP local. Checklist secure-code aplicado com revisão de código e provas; não é auditoria do domínio público nem certificação de produção.

## Achados corrigidos ou mitigados

- **Alto, dependências**: Jackson 2.17.2 tinha alertas no OSV. Atualizado pelo BOM para 2.23.0 (annotations 2.23); nova consulta sem alertas nesses três artefatos. Jetty 11.0.23 atualizado para 11.0.26, corrigindo o alerta de ThreadLimitHandler. Nenhuma dependência de produto nova.
- **Alto, mitigado, parser legado**: GHSA-355h-qmc2-wpwf afeta o parser chunked de Jetty 11. A demo agora recusa Transfer-Encoding e fecha a conexão antes de executar rotas. Teste com o payload de extensão de chunk malformada exige uma única resposta 400 e confirma que nenhuma das duas ações foi executada. É mitigação no aplicativo, não patch da biblioteca.
- **Médio, headers**: CSP ausente confirmada por HTTP. Adicionados CSP, Permissions-Policy e HSTS; headers enviados também antes do SSE. `style-src 'unsafe-inline'` é necessário para os estilos GSAP/React atuais; scripts só da própria origem, sem unsafe-eval.
- **Médio, exposição/validação**: removido modo de detalhes de erro; log global não copia caminho/erro da request. JSON malformado/null/lista agora recebe 400; modo e booleano do mock validados. Arquivos ocultos e source maps recebem 404; realpath impede escape por symlink.
- **Médio, concorrência/abuso**: mutações de API serializadas com reserva não bloqueante (409 em disputa); carga/reset/reprocessamento/anexo recusados enquanto workers executam. Limite global de 120 ações/minuto. Texto continua com 10 gerações/minuto e uma geração por tarefa.

## Cobertura e evidências

- SQL parametrizado em Banco; esquema fixo. Projeções explícitas; concatenação de marcadores `?` no lote não contém valores do cliente.
- Front não usa innerHTML, dangerouslySetInnerHTML, eval nem token em localStorage. Texto chega como conteúdo React escapado.
- Documento vem de caminho fixo no kit, não de upload; mock HTTP usa endereço configurado no servidor e enum de convênio, não URL do visitante. Sem webhooks/pagamentos/sessões/JWT.
- API só tem dados sintéticos e é deliberadamente pública. IDs acessíveis não constituem quebra de isolamento entre usuários, pois não há usuários/tenants nesta demo.
- IA Java é exclusivamente template, sem chamadas a provedor, chave ou decisões automáticas baseadas em texto. Teste compara status/número antes e depois da geração.
- CORS somente Vite local fora de produção; produção usa mesma origem. API no-store; assets hash immutable. SSE sem gzip, com heartbeat e remoção ao desconectar.
- `npm audit` no front e na raiz: zero vulnerabilidades. A referência Node usa o lockfile da raiz (não possui lockfile próprio).
- OSV consultado por coordenadas dos 23 artefatos com pom.properties no jar. Kotlin não inclui esses metadados nessa varredura, portanto não está coberto por ela.
- Scanner dedicado da skill não existe nesta instalação; Bash disponível é 3.2, sem requisito Bash 4/GNU grep. Usados `rg`, inspeção manual, npm audit, OSV e testes HTTP/JUnit.
- Busca de padrões de segredo nos fontes não encontrou credenciais. A consulta ao histórico de arquivos de ambiente foi bloqueada pelo hook de segurança; não foi contornada nem declarada verificada.

## Alertas residuais e limites conhecidos

Jetty 11 é uma linha EOL exigida pela combinação Javalin 6 desta missão. OSV ainda lista cinco alertas em três artefatos: GHSA-355h-qmc2-wpwf (mitigação acima), GHSA-7p3p-8qv8-m2vh (HTTP/2/3 não habilitados), GHSA-qh8g-58pp-2wxh e GHSA-wjpw-4j6x-6rwh (aplicação não usa HttpURI para validar destinos/redirects) e GHSA-2fvj-hgj9-j2gr (Digest não usado). Migrar para Javalin/Jetty suportados antes de produção. Não se anuncia “zero vulnerabilidades Java”.

Sem autenticação, proteção distribuída, isolamento por organização ou limite global de conexões SSE. O histórico cresce até reset e SSE síncrono pode ser afetado por clientes lentos. Limites de CPU/conexões e retenção precisam ser tratados antes de exposição prolongada ou uso real. CORS não impede chamadas diretas à API. O link público não foi auditado nesta revisão.

Fontes de advisories: https://api.osv.dev/v1/querybatch e https://github.com/jetty/jetty.project/security/advisories. A prova local está nos testes 20 a 24 e no relatório EVIDENCIAS.
