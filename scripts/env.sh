# Ambiente Java do projeto. Use com: source scripts/env.sh
# JDK e Maven ficam em ./.tools (fora do git). Nada de Homebrew: este Mac e Intel e
# compilar do zero levaria muito tempo.

RAIZ_DO_PROJETO="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"

export JAVA_HOME="$RAIZ_DO_PROJETO/.tools/jdk/Contents/Home"
export MAVEN_HOME="$RAIZ_DO_PROJETO/.tools/maven"
export PATH="$JAVA_HOME/bin:$MAVEN_HOME/bin:$PATH"

# Repositorio local do Maven dentro do projeto: nao suja o ~/.m2 da maquina.
export MAVEN_OPTS="-Dmaven.repo.local=$RAIZ_DO_PROJETO/.tools/m2"

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "AVISO: JDK nao encontrado em $JAVA_HOME" >&2
fi

echo "JAVA_HOME=$JAVA_HOME"
java -version 2>&1 | head -1
mvn -version 2>&1 | head -1
