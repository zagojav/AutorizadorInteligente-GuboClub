#!/usr/bin/env python3
"""Compara as respostas do backend Node com as do backend Java.

Ignora so o que e naturalmente diferente entre duas execucoes:
horarios, latencias, prazos e os ids autoincrementais de evento/tarefa.
Qualquer outra diferenca de campo ou de valor sai como DIFERENCA.
"""

import json
import pathlib
import sys

# Campos cujo VALOR muda a cada execucao. A presenca do campo continua sendo comparada.
CAMPOS_VOLATEIS = {
    "hora",
    "horario",
    "criado_em",
    "respondido_em",
    "recebido_em",
    "prazo",
    "aberto_em",
    "latencia_ms",
    "latencia_p50_ms",
    "latencia_p95_ms",
    "id",  # id autoincremental de evento e de tarefa
}

# Campos que dependem de quantas chamadas/falhas ja aconteceram no processo. O Node e o
# Java contam o mesmo numero por solicitacao, mas o aquecimento dos casos do kit e o
# momento do derrubar deixam totais agregados ligeiramente diferentes entre as execucoes.
CAMPOS_DE_CONTAGEM = {
    "chamadas",
    "falhas",
    "falhas_detectadas",
    "falhas_seguidas",
}

MARCADOR = "<volatil>"


def normalizar(valor, chave=None):
    """Troca valores volateis por um marcador, mantendo a estrutura."""
    if chave in CAMPOS_VOLATEIS or chave in CAMPOS_DE_CONTAGEM:
        return MARCADOR if valor is None or not isinstance(valor, (dict, list)) else valor
    if isinstance(valor, dict):
        return {chave_interna: normalizar(valor_interno, chave_interna)
                for chave_interna, valor_interno in sorted(valor.items())}
    if isinstance(valor, list):
        return [normalizar(item, chave) for item in valor]
    return valor


def achatar(valor, prefixo=""):
    """Transforma em pares caminho -> valor, pra apontar a diferenca exata."""
    if isinstance(valor, dict):
        for chave, valor_interno in valor.items():
            yield from achatar(valor_interno, f"{prefixo}.{chave}" if prefixo else chave)
    elif isinstance(valor, list):
        for indice, item in enumerate(valor):
            yield from achatar(item, f"{prefixo}[{indice}]")
    else:
        yield prefixo, valor


def carregar(caminho):
    texto = caminho.read_text(encoding="utf-8")
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        return {"__texto_bruto__": texto.strip()}


def main():
    pasta = pathlib.Path(sys.argv[1])
    nomes = sorted({arquivo.name.split(".")[0] for arquivo in pasta.glob("*.node.json")})
    diferencas = []

    for nome in nomes:
        node = pasta / f"{nome}.node.json"
        java = pasta / f"{nome}.java.json"
        if not java.exists():
            diferencas.append(f"[{nome}] resposta do Java ausente")
            continue

        codigo_node = (pasta / f"{nome}.node.codigo").read_text().strip()
        codigo_java = (pasta / f"{nome}.java.codigo").read_text().strip()
        if codigo_node != codigo_java:
            diferencas.append(f"[{nome}] status HTTP: node={codigo_node} java={codigo_java}")

        esperado = normalizar(carregar(node))
        obtido = normalizar(carregar(java))

        pares_node = dict(achatar(esperado))
        pares_java = dict(achatar(obtido))

        faltando = sorted(set(pares_node) - set(pares_java))
        sobrando = sorted(set(pares_java) - set(pares_node))
        for caminho in faltando[:8]:
            diferencas.append(f"[{nome}] campo so no Node: {caminho} = {pares_node[caminho]!r}")
        for caminho in sobrando[:8]:
            diferencas.append(f"[{nome}] campo so no Java: {caminho} = {pares_java[caminho]!r}")

        for caminho in sorted(set(pares_node) & set(pares_java)):
            if pares_node[caminho] != pares_java[caminho]:
                diferencas.append(
                    f"[{nome}] {caminho}: node={pares_node[caminho]!r} java={pares_java[caminho]!r}")

    if diferencas:
        print("DIFERENCAS encontradas:")
        for diferenca in diferencas:
            print("  -", diferenca)
        print(f"\ntotal: {len(diferencas)} diferenca(s) em {len(nomes)} chamada(s)")
        return 1

    print(f"PARIDADE OK ({len(nomes)} chamadas comparadas, campo por campo)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
