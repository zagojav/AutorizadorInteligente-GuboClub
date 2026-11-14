#!/usr/bin/env bash
# Prova de paridade entre o backend Node (referencia) e o backend Java (novo).
#
# Sobe os dois, roda a MESMA sequencia nos dois e compara os JSONs campo por campo,
# ignorando so o que e naturalmente diferente entre duas execucoes: horarios, latencias,
# ids gerados e contadores derivados de tempo.
#
# Uso: scripts/paridade.sh
# Saida: "PARIDADE OK" ou a lista de DIFERENCAS.

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

PORTA_NODE=3001
PORTA_JAVA=3000
TRABALHO="$(mktemp -d)"
NODE_PID=""
JAVA_PID=""

# Latencia fixa e espera curta nos dois: a sequencia roda rapido e o diff nao sofre com
# variacao aleatoria de tempo.
export MOCK_LATENCIA_MS=20
export ESPERAS_RETENTATIVA_MS=5,5,5
export IA_ATRASO_TEMPLATE_MS=0

limpar() {
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  [ -n "$JAVA_PID" ] && kill "$JAVA_PID" 2>/dev/null
  wait 2>/dev/null
  rm -f "$RAIZ/paridade_node.db" "$RAIZ/paridade_node.db-wal" "$RAIZ/paridade_node.db-shm"
  rm -f "$RAIZ/paridade_java.db" "$RAIZ/paridade_java.db-wal" "$RAIZ/paridade_java.db-shm"
}
trap limpar EXIT

esperar_no_ar() {
  local porta="$1" nome="$2"
  for _ in $(seq 1 100); do
    if curl -s -m 1 -o /dev/null "http://127.0.0.1:$porta/api/saude" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  echo "ERRO: $nome nao subiu na porta $porta" >&2
  return 1
}

# Espera os dois terminarem de aquecer os casos do kit, senao casos_kit sai "pendente"
# em um e "4/4" no outro so por corrida de boot.
esperar_casos_aquecidos() {
  local porta="$1"
  for _ in $(seq 1 100); do
    if ! curl -s -m 2 "http://127.0.0.1:$porta/api/metricas" | grep -q '"casos_kit":"pendente"'; then
      return 0
    fi
    sleep 0.2
  done
  return 0
}

if [ ! -d "$RAIZ/referencia-node" ] && [ ! -d "$RAIZ/server" ]; then
  echo "ERRO: backend Node de referencia nao encontrado (./server ou ./referencia-node)" >&2
  exit 1
fi

ENTRADA_NODE="$RAIZ/server/index.js"
[ -f "$ENTRADA_NODE" ] || ENTRADA_NODE="$RAIZ/referencia-node/server/index.js"

JAR="$RAIZ/backend/target/autorizador.jar"
if [ ! -f "$JAR" ]; then
  echo "ERRO: $JAR nao existe. Rode: mvn -f backend package" >&2
  exit 1
fi

echo "== subindo Node (referencia) na porta $PORTA_NODE =="
PORT=$PORTA_NODE BANCO_ARQUIVO="$RAIZ/paridade_node.db" MOCK_URL="http://127.0.0.1:$PORTA_NODE/mock" \
  node "$ENTRADA_NODE" > "$TRABALHO/node.log" 2>&1 &
NODE_PID=$!

echo "== subindo Java na porta $PORTA_JAVA =="
PORT=$PORTA_JAVA BANCO_ARQUIVO="$RAIZ/paridade_java.db" MOCK_URL="http://127.0.0.1:$PORTA_JAVA/mock" \
  java -jar "$JAR" > "$TRABALHO/java.log" 2>&1 &
JAVA_PID=$!

esperar_no_ar "$PORTA_NODE" "Node" || exit 1
esperar_no_ar "$PORTA_JAVA" "Java" || exit 1
esperar_casos_aquecidos "$PORTA_NODE"
esperar_casos_aquecidos "$PORTA_JAVA"

# A sequencia: cada linha e "nome|metodo|caminho".
SEQUENCIA=(
  "01-iniciar-fila|POST|/api/fila/iniciar"
  "02-fila|GET|/api/fila"
  "03-saude|GET|/api/saude"
  "04-linha-do-tempo-r2|GET|/api/solicitacoes/DEMO-R2/linha-do-tempo"
  "05-anexar-documento-r2|POST|/api/solicitacoes/DEMO-R2/documentos"
  "06-tarefas|GET|/api/tarefas"
  "07-derrubar-jardim|POST|/api/convenios/jardim/derrubar"
  "08-carga|POST|/api/simulacao/carga"
  "09-fila-apos-carga|GET|/api/fila"
  "10-auditoria|GET|/api/auditoria"
  "11-metricas|GET|/api/metricas"
  "12-aurora-sem-numero|POST|/api/convenios/aurora/modo"
  "13-reprocessar-r1|POST|/api/solicitacoes/DEMO-R1/reprocessar"
  "14-testes-rodar|POST|/api/testes/rodar"
  "15-restaurar-jardim|POST|/api/convenios/jardim/restaurar"
  "16-id-invalido|GET|/api/solicitacoes/DEMO-X1/linha-do-tempo"
  "17-tarefa-inexistente|GET|/api/tarefas/999999/texto-ia/stream"
)

chamar() {
  local porta="$1" metodo="$2" caminho="$3" arquivo="$4"
  local corpo=()
  if [ "$caminho" = "/api/convenios/aurora/modo" ]; then
    corpo=(-H "content-type: application/json" -d '{"modo":"sem_numero"}')
  fi
  local codigo
  codigo=$(curl -s -m 30 -o "$arquivo" -w "%{http_code}" -X "$metodo" "${corpo[@]+"${corpo[@]}"}" \
    "http://127.0.0.1:$porta$caminho")
  echo "$codigo"
}

for item in "${SEQUENCIA[@]}"; do
  NOME="${item%%|*}"
  RESTO="${item#*|}"
  METODO="${RESTO%%|*}"
  CAMINHO="${RESTO#*|}"

  CODIGO_NODE=$(chamar "$PORTA_NODE" "$METODO" "$CAMINHO" "$TRABALHO/$NOME.node.json")
  CODIGO_JAVA=$(chamar "$PORTA_JAVA" "$METODO" "$CAMINHO" "$TRABALHO/$NOME.java.json")
  echo "$CODIGO_NODE" > "$TRABALHO/$NOME.node.codigo"
  echo "$CODIGO_JAVA" > "$TRABALHO/$NOME.java.codigo"
  printf "  %-26s node=%s java=%s\n" "$NOME" "$CODIGO_NODE" "$CODIGO_JAVA"

  # Depois da carga, espera as filas esvaziarem nos dois antes de comparar a fila.
  if [ "$NOME" = "08-carga" ]; then
    sleep 3
  fi
done

echo "== comparando =="
python3 "$RAIZ/scripts/comparar_paridade.py" "$TRABALHO"
RESULTADO=$?

if [ "$RESULTADO" -ne 0 ]; then
  echo "(logs em $TRABALHO)"
  trap - EXIT
  limpar
  exit "$RESULTADO"
fi

exit 0
