package br.gubo.autorizador;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * Horario no mesmo formato que o backend Node gravava (ISO 8601 com milissegundos e Z).
 * Formatador explicito de proposito: Instant.toString() omite a fracao quando ela e zero,
 * e isso mudaria o formato de alguns registros.
 */
public final class Tempo {

  private static final DateTimeFormatter FORMATO =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

  private Tempo() {
  }

  public static String agora() {
    return FORMATO.format(Instant.now());
  }

  public static String daquiA(long milissegundos) {
    return FORMATO.format(Instant.now().plusMillis(milissegundos));
  }

  public static long paraMilissegundos(String horario) {
    if (horario == null || horario.isBlank()) {
      return 0L;
    }
    return Instant.parse(horario).toEpochMilli();
  }
}
