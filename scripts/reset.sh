#!/usr/bin/env bash
# Para exclusivamente o jar cujo PID foi gravado pelo demo.sh; não mata por porta.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
if [ -f .runtime/demo.pid ]; then
  read -r PID_DEMO < .runtime/demo.pid
  case "$PID_DEMO" in ''|*[!0-9]*) echo 'PID inválido; nenhum processo foi parado.' >&2; exit 1;; esac
  if kill -0 "$PID_DEMO" 2>/dev/null; then
    COMANDO="$(ps -p "$PID_DEMO" -o command=)"
    if [ "$COMANDO" != "$RAIZ/.tools/jdk/Contents/Home/bin/java -jar $RAIZ/backend/target/autorizador.jar" ]; then
      echo 'PID pertence a outro comando; nenhum processo foi parado.' >&2
      exit 1
    fi
    kill "$PID_DEMO"
    for tentativa in {1..100}; do
      kill -0 "$PID_DEMO" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$PID_DEMO" 2>/dev/null; then
      echo 'Processo ainda encerrando; tente novamente.' >&2
      exit 1
    fi
  fi
  # Metadado do processo, não é dado do usuário.
  rm -f "$RAIZ/.runtime/demo.pid"
fi
if [ "${1:-}" = '--parar' ]; then
  echo 'Demo gerenciada parada.'
else
  exec bash scripts/demo.sh
fi
