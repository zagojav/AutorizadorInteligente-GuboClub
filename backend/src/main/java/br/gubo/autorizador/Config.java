package br.gubo.autorizador;

/**
 * Leitura de configuracao. Procura primeiro em propriedade de sistema e depois em variavel
 * de ambiente, pra que o teste possa apontar MOCK_URL para a porta efemera do servidor sem
 * precisar reexportar o ambiente do processo.
 */
public final class Config {

  private Config() {
  }

  public static String texto(String nome) {
    String daPropriedade = System.getProperty(nome);
    if (daPropriedade != null && !daPropriedade.isBlank()) {
      return daPropriedade.strip();
    }
    String doAmbiente = System.getenv(nome);
    if (doAmbiente != null && !doAmbiente.isBlank()) {
      return doAmbiente.strip();
    }
    return null;
  }

  public static String texto(String nome, String padrao) {
    String valor = texto(nome);
    return valor == null ? padrao : valor;
  }

  /** Numero inteiro, aceitando apenas valores a partir do minimo. */
  public static long numero(String nome, long padrao, long minimo) {
    String valor = texto(nome);
    if (valor == null) {
      return padrao;
    }
    try {
      long convertido = Long.parseLong(valor);
      return convertido >= minimo ? convertido : padrao;
    } catch (NumberFormatException erro) {
      return padrao;
    }
  }
}
