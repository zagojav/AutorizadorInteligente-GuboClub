# Pronto para escalar: desenho do próximo passo

Este documento descreve a evolução, não capacidade já entregue.

O isolamento por convênio permite distribuir workers mantendo ordem e retentativas por integração. Para várias instâncias, persistir trabalhos e idempotência no PostgreSQL, usar leases com expiração e mover estado do disjuntor e broadcast SSE para serviço compartilhado. Não basta executar dois jars contra o mesmo SQLite.

Paginar fila/eventos por cursor e limitar retenção de chamadas; virtualizar cartões após medir o volume. Hoje a fila tem teto de 50 sintéticas, mas o histórico cresce até resetar o processo/banco da demonstração.

Servir assets com hash em CDN, pré-renderizar apenas a abertura e manter o painel ao vivo via API. Redis só entra para estado compartilhado ou consultas medidas como caras; não substitui o registro de decisões.

Adicionar OpenTelemetry em chamadas, filas e SQL; dashboards de disponibilidade por convênio, p50/p95 reais separados da simulação; RUM com consentimento e sem dados de pacientes. Banco e serviço na mesma região, pool limitado e orçamento de conexões por réplica.

Antes de dados reais: autenticação, autorização por organização e ownership, trilha imutável com retenção, políticas de proteção de dados, limites de abuso e teste de carga. A demo atual é pública e sintética, não um autorizador clínico de produção.

Próximos produtos: adaptador por convênio no padrão TISS da ANS e editor de regras versionado com aprovação humana. Nenhuma saída de IA altera status nem cria número de autorização.
