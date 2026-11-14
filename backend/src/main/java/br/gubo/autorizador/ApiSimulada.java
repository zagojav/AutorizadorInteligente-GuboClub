package br.gubo.autorizador;

import io.javalin.Javalin;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

/**
 * API ficticia dos convenios. Nao depende do banco: so conhece o convenio pelo id da rota.
 * Modo por convenio, trocavel em tempo real (ex: botao "derrubar Jardim" na demo).
 */
public final class ApiSimulada {

  /** Allowlist: so esses convenios e modos existem. Usada tambem na validacao das rotas. */
  public static final List<String> CONVENIOS_CONHECIDOS = List.of("aurora", "horizonte", "jardim");
  public static final List<String> MODOS_VALIDOS = List.of("normal", "caos", "sem_numero");

  private final Map<String, String> modosPorConvenio = new ConcurrentHashMap<>();

  public void definirModo(String convenio, String modo) {
    if (!CONVENIOS_CONHECIDOS.contains(convenio)) {
      throw new IllegalArgumentException("convenio desconhecido");
    }
    if (!MODOS_VALIDOS.contains(modo)) {
      throw new IllegalArgumentException("modo invalido");
    }
    modosPorConvenio.put(convenio, modo);
  }

  public String obterModo(String convenio) {
    return modosPorConvenio.getOrDefault(convenio, "normal");
  }

  public void resetarModos() {
    modosPorConvenio.clear();
  }

  /**
   * Modo padrao do kit: aurora e horizonte normais; jardim tambem 'normal', porque o
   * indisponivel dele ja e o comportamento nativo da API simulada (responde 503).
   */
  public void restaurarModoPadrao(String convenio) {
    modosPorConvenio.remove(convenio);
  }

  public Map<String, Object> listarModos() {
    Map<String, Object> modos = new LinkedHashMap<>();
    for (String convenio : CONVENIOS_CONHECIDOS) {
      modos.put(convenio, obterModo(convenio));
    }
    return modos;
  }

  /** Latencia aleatoria de 100 a 800 ms. Nos testes, fixa por MOCK_LATENCIA_MS. */
  private static long calcularLatenciaMs() {
    long fixa = Config.numero("MOCK_LATENCIA_MS", -1, 0);
    if (fixa >= 0) {
      return fixa;
    }
    return 100 + ThreadLocalRandom.current().nextLong(701);
  }

  private static void aguardar(long milissegundos) {
    try {
      Thread.sleep(milissegundos);
    } catch (InterruptedException erro) {
      Thread.currentThread().interrupt();
    }
  }

  public void registrarRotas(Javalin servidor) {
    servidor.post("/mock/{convenio}/autorizar", contexto -> {
      try {
        String convenio = contexto.pathParam("convenio");
        if (!CONVENIOS_CONHECIDOS.contains(convenio)) {
          contexto.status(400).json(Json.mapa("erro", "requisição inválida"));
          return;
        }

        Map<String, Object> corpo = Json.lerMapa(contexto.body());
        Object modoDaChamada = corpo.get("modo_simulado");
        // Modo so desta chamada. Os casos do kit usam isso pra rodar sem mexer no modo
        // global do convenio (senao rodar os testes mudaria o comportamento da demo).
        String modo = modoDaChamada instanceof String texto && MODOS_VALIDOS.contains(texto)
            ? texto
            : obterModo(convenio);

        if ("caos".equals(modo)) {
          boolean vaiEstourarTimeout = ThreadLocalRandom.current().nextBoolean();
          // Demora proposital maior que qualquer tempo_limite_ms da demo (2000 ms).
          aguardar(vaiEstourarTimeout ? 3000 : calcularLatenciaMs());
          contexto.status(503).json(Json.mapa("status", "servico_indisponivel"));
          return;
        }

        aguardar(calcularLatenciaMs());

        // Responde autorizado SEM numero: existe pra provar que o motor nao inventa
        // autorizacao.
        if ("sem_numero".equals(modo)) {
          contexto.json(Json.mapa("status", "autorizado"));
          return;
        }

        if ("aurora".equals(convenio)) {
          contexto.json(Json.mapa("status", "autorizado", "numero_autorizacao", "DEMO-AUTH-1"));
          return;
        }

        if ("horizonte".equals(convenio)) {
          if (Boolean.TRUE.equals(corpo.get("tem_documento"))) {
            contexto.json(Json.mapa("status", "autorizado", "numero_autorizacao", "DEMO-AUTH-2-SIMULADO"));
            return;
          }
          contexto.json(Json.mapa("status", "pendente_documento"));
          return;
        }

        // jardim: servico simulado indisponivel.
        contexto.status(503).json(Json.mapa("status", "servico_indisponivel"));
      } catch (RuntimeException erro) {
        System.err.println("[erro] falha na api simulada: " + erro.getMessage());
        contexto.status(500).json(Json.mapa("status", "erro_interno"));
      }
    });
  }
}
