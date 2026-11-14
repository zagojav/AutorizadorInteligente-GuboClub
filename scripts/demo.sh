#!/usr/bin/env bash
# Sobe apenas o servidor desta demonstração, com estado sintético descartável.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"
mkdir -p .runtime
if ! mkdir .runtime/iniciando 2>/dev/null; then
  echo 'Outra inicialização está em andamento.' >&2
  exit 1
fi
trap 'rmdir "$RAIZ/.runtime/iniciando"' EXIT
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'Porta 3000 ocupada. Para a demo gerenciada: bash scripts/reset.sh' >&2
  exit 1
fi
source scripts/env.sh
if [ ! -d web/node_modules ]; then
  echo 'Dependências do front ausentes. Execute npm ci --prefix web antes.' >&2
  exit 1
fi
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/public web/index.html web/package-lock.json web/vite.config.js -type f -newer web/dist/index.html 2>/dev/null)" ]; then
  (cd web && npm run build)
fi
if [ ! -f backend/target/autorizador.jar ] || [ -n "$(find backend/src backend/pom.xml -type f -newer backend/target/autorizador.jar)" ]; then
  mvn -B -ntp -f backend package
fi
# Não reutiliza nem apaga bancos existentes. Reiniciar este processo limpa a rodada.
HOST=127.0.0.1 PORT=3000 BANCO_ARQUIVO=:memory: NODE_ENV=production \
  nohup "$JAVA_HOME/bin/java" -jar "$RAIZ/backend/target/autorizador.jar" > .runtime/demo.log 2>&1 < /dev/null &
PID_DEMO=$!
printf '%s\n' "$PID_DEMO" > .runtime/demo.pid
PRONTO=0
for tentativa in {1..100}; do
  if ! kill -0 "$PID_DEMO" 2>/dev/null; then
    echo 'Servidor encerrou; consulte .runtime/demo.log.' >&2
    exit 1
  fi
  if curl -fsS --max-time 1 http://127.0.0.1:3000/api/saude >/dev/null 2>&1; then
    PRONTO=1
    break
  fi
  sleep 0.2
done
if [ "$PRONTO" != 1 ]; then
  echo 'Servidor não ficou saudável. Pare com bash scripts/reset.sh --parar.' >&2
  exit 1
fi
curl -fsS --max-time 120 -X POST http://127.0.0.1:3000/api/fila/iniciar >/dev/null
echo 'DEMO PRONTA: http://127.0.0.1:3000/'
echo 'Painel: http://127.0.0.1:3000/#/painel'
echo 'Público (somente com túnel ativo): https://autorizador.zagolabs.com.br'
echo 'Reset: bash scripts/reset.sh | Parar: bash scripts/reset.sh --parar'
