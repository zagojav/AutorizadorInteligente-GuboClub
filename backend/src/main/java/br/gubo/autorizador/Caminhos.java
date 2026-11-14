package br.gubo.autorizador;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Caminhos do projeto. O kit e a fonte da verdade e nada e lido fora dele: o caminho do
 * documento mock e fixo no servidor, nunca montado com valor vindo do usuario.
 */
public final class Caminhos {

  private Caminhos() {
  }

  /**
   * Raiz do projeto. Procura a pasta que contem ./kit subindo a partir do diretorio de
   * trabalho, pra funcionar tanto rodando o jar da raiz quanto o teste de dentro de
   * ./backend.
   */
  public static Path raiz() {
    Path atual = Paths.get("").toAbsolutePath().normalize();
    for (Path candidato = atual; candidato != null; candidato = candidato.getParent()) {
      if (Files.isDirectory(candidato.resolve("kit").resolve("data"))) {
        return candidato;
      }
    }
    return atual;
  }

  public static Path dadosDoKit() {
    return raiz().resolve("kit").resolve("data");
  }

  public static Path documentoMock() {
    return raiz().resolve("kit").resolve("docs").resolve("documento_mock.txt");
  }

  public static Path pastaDoFront() {
    return raiz().resolve("web").resolve("dist");
  }
}
