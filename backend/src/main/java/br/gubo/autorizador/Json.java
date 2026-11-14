package br.gubo.autorizador;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * JSON do projeto. Um unico ObjectMapper e mapas ordenados, pra resposta sair com os
 * mesmos nomes e na mesma ordem de campos que o backend Node devolvia.
 */
public final class Json {

  private static final ObjectMapper MAPEADOR = new ObjectMapper();

  private Json() {
  }

  public static ObjectMapper mapeador() {
    return MAPEADOR;
  }

  public static String paraTexto(Object valor) {
    try {
      return MAPEADOR.writeValueAsString(valor);
    } catch (Exception erro) {
      throw new IllegalStateException("falha ao serializar JSON: " + erro.getMessage(), erro);
    }
  }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> lerMapa(String texto) {
    if (texto == null || texto.isBlank()) {
      return new LinkedHashMap<>();
    }
    try {
      return MAPEADOR.readValue(texto, LinkedHashMap.class);
    } catch (Exception erro) {
      throw new IllegalArgumentException("corpo JSON invalido", erro);
    }
  }

  /** Mapa ordenado a partir de pares chave/valor, pra montar resposta na ordem certa. */
  public static Map<String, Object> mapa(Object... paresChaveValor) {
    Map<String, Object> mapa = new LinkedHashMap<>();
    for (int indice = 0; indice < paresChaveValor.length; indice += 2) {
      mapa.put(String.valueOf(paresChaveValor[indice]), paresChaveValor[indice + 1]);
    }
    return mapa;
  }
}
