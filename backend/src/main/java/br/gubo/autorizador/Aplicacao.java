package br.gubo.autorizador;

import io.javalin.Javalin;
import io.javalin.compression.CompressionStrategy;
import io.javalin.compression.Gzip;
import io.javalin.http.staticfiles.Location;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Entrada do processo: abre o banco, monta o servidor e aquece o resultado dos casos do kit.
 *
 * Um processo so, servindo /mock (API ficticia), /api (publica) e o front de ./web/dist.
 */
public final class Aplicacao {

  /** Tudo que compoe o servidor, pra que o teste possa subir na porta 0. */
  public record Servidor(Javalin javalin, Banco banco, ApiSimulada apiSimulada, Motor motor,
      FilaPorConvenio filas, TempoReal tempoReal) {

    public void encerrar() {
      javalin.stop();
      filas.encerrar();
      tempoReal.encerrarTudo();
      banco.close();
    }
  }

  private Aplicacao() {
  }

  public static Servidor construir(Banco banco) {
    TempoReal tempoReal = new TempoReal();
    tempoReal.usarBanco(banco);
    ApiSimulada apiSimulada = new ApiSimulada();
    Disjuntor disjuntor = new Disjuntor(banco, tempoReal);
    Motor motor = new Motor(banco, disjuntor, tempoReal);
    FilaPorConvenio filas = new FilaPorConvenio(banco, motor, tempoReal);

    Javalin javalin = Javalin.create(configuracao -> {
      configuracao.showJavalinBanner = false;
      // Virtual threads: o SSE segura uma linha por cliente, e com virtual thread isso e
      // barato (e o heartbeat nao ocupa linha de pool).
      configuracao.useVirtualThreads = true;
      // bodyLimit apertado: nenhuma rota recebe payload grande, entao nao aceita.
      configuracao.http.maxRequestSize = 64L * 1024L;
      // gzip em tudo que for compressivel, menos text/event-stream: comprimir o SSE
      // quebraria a entrega incremental. Duas protecoes: o tipo esta na lista de excluidos
      // e o SSE escreve direto no socket, fora do caminho da compressao.
      CompressionStrategy compressao = new CompressionStrategy(null, new Gzip(6));
      List<String> excluidos = new ArrayList<>(compressao.getExcludedMimeTypes());
      if (!excluidos.contains("text/event-stream")) {
        excluidos.add("text/event-stream");
      }
      compressao.setExcludedMimeTypes(excluidos);
      // Mesmo limiar do backend Node (512 bytes): o padrao do Javalin e 1500 e deixaria
      // respostas intermediarias sem gzip.
      compressao.setDefaultMinSizeForCompression(512);
      configuracao.http.customCompression(compressao);
      // SSE fica aberto: sem timeout de requisicao assincrona.
      configuracao.http.asyncTimeout = 0L;
      configuracao.jetty.defaultHost = Config.texto("HOST", "127.0.0.1");

      if (Files.isDirectory(Caminhos.pastaDoFront())) {
        configuracao.staticFiles.add(estaticos -> {
          estaticos.hostedPath = "/";
          estaticos.directory = Caminhos.pastaDoFront().toString();
          estaticos.location = Location.EXTERNAL;
        });
      }
    });

    // Handler global: qualquer erro nao tratado responde mensagem curta, sem stack trace,
    // e o processo segue de pe.
    javalin.exception(Exception.class, (erro, contexto) -> {
      System.err.println("[erro] " + contexto.method() + " " + contexto.path() + ": " + erro.getMessage());
      contexto.status(500).json(Json.mapa("erro", "erro interno"));
    });

    apiSimulada.registrarRotas(javalin);
    new Rotas(banco, apiSimulada, motor, filas, tempoReal).registrar(javalin);

    return new Servidor(javalin, banco, apiSimulada, motor, filas, tempoReal);
  }

  /**
   * Roda os 4 casos do kit uma vez, em banco em memoria, so pra /api/metricas ja ter o
   * casos_kit preenchido quando a banca abrir o painel. Falhar aqui nao derruba o servidor.
   */
  static void aquecerCasosDoKit() {
    try (Banco bancoDosCasos = Banco.abrir(":memory:")) {
      bancoDosCasos.seed();
      TempoReal silencioso = new TempoReal(true);
      Motor motorDosCasos =
          new Motor(bancoDosCasos, new Disjuntor(bancoDosCasos, silencioso), silencioso);
      Map<String, Object> resultado = motorDosCasos.rodarCasosBasicos();
      Metricas.guardarResultadoDosCasos(resultado);
    } catch (RuntimeException erro) {
      System.err.println("[erro] falha ao aquecer os casos do kit: " + erro.getMessage());
    }
  }

  public static void main(String[] argumentos) {
    int porta = (int) Config.numero("PORT", 3000, 1);
    Banco banco = Banco.abrir(Config.texto("BANCO_ARQUIVO", "gubo_autorizador.db"));
    banco.seed();

    Servidor servidor = construir(banco);
    Runtime.getRuntime().addShutdownHook(new Thread(servidor::encerrar));

    servidor.javalin().start(porta);
    String host = Config.texto("HOST", "127.0.0.1");
    System.out.println("Autorizador Inteligente rodando em http://" + host + ":" + porta);

    // Aquecimento em segundo plano: nao atrasa o boot.
    Thread aquecimento = new Thread(Aplicacao::aquecerCasosDoKit, "aquecer-casos");
    aquecimento.setDaemon(true);
    aquecimento.start();
  }
}
