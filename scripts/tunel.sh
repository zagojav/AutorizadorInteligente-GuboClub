#!/usr/bin/env bash
# Usa o túnel existente. Não lê nem altera credenciais/configuração manualmente.
set -euo pipefail
exec "$HOME/cloudflared" tunnel run --url http://localhost:3000 gubo
