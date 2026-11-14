package br.gubo.autorizador;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Tempo real por SSE. O motor, o disjuntor e as filas publicam aqui; os clientes do
 * /api/stream recebem. Nao persiste nada: so avisa quem esta ouvindo.
 *
 * Tipos emitidos: solicitacao_atualizada, disjuntor_mudou, modo_mudou, tarefa_criada e
 * metricas (no maximo 1 por segundo).
 */
public final class TempoReal {

  public static final long INTERVALO_HEARTBEAT_MS = 15000;
  private static final long INTERVALO_MINIMO_DE_METRICAS_MS = 1000;

  private final List<Cliente> clientes = new CopyOnWriteArrayList<>();
  private final ScheduledExecutorService agendador =
      Executors.newSingleThreadScheduledExecutor(tarefa -> {
        Thread linha = new Thread(tarefa, "metricas-sse");
        linha.setDaemon(true);
        return linha;
      });

  private volatile Banco banco;
  private volatile long ultimoEnvioDeMetricas;
  private final AtomicBoolean metricasAgendadas = new AtomicBoolean(false);
  private final boolean silencioso;

  public TempoReal() {
    this(false);
  }

  /** Barramento silencioso: usado pela rodada hermetica dos casos do kit. */
  public TempoReal(boolean silencioso) {
    this.silencioso = silencioso;
  }

  public void usarBanco(Banco banco) {
    this.banco = banco;
  }

  public int quantidadeDeClientes() {
    return clientes.size();
  }

  /** Um cliente conectado: escreve direto no socket, uma escrita por vez. */
  public static final class Cliente {
    private final OutputStream saida;
    private final AtomicBoolean encerrado = new AtomicBoolean(false);

    Cliente(OutputStream saida) {
      this.saida = saida;
    }

    synchronized void escrever(String bloco) throws IOException {
      saida.write(bloco.getBytes(StandardCharsets.UTF_8));
      saida.flush();
    }

    public boolean encerrado() {
      return encerrado.get();
    }

    void encerrar() {
      encerrado.set(true);
    }
  }

  public Cliente conectar(OutputStream saida) {
    Cliente cliente = new Cliente(saida);
    clientes.add(cliente);
    return cliente;
  }

  public void desconectar(Cliente cliente) {
    cliente.encerrar();
    clientes.remove(cliente);
  }

  /** Monta o bloco SSE no mesmo formato do backend Node. */
  public static String blocoSse(String tipo, Object dados) {
    return "event: " + tipo + "\ndata: " + Json.paraTexto(dados) + "\n\n";
  }

  public void publicar(String tipo, Map<String, Object> dados) {
    if (silencioso) {
      return;
    }
    Map<String, Object> comHorario = new LinkedHashMap<>(dados);
    comHorario.put("horario", Tempo.agora());
    despachar(tipo, comHorario);

    if ("metricas".equals(tipo)) {
      return;
    }
    long desdeOUltimo = System.currentTimeMillis() - ultimoEnvioDeMetricas;
    if (desdeOUltimo >= INTERVALO_MINIMO_DE_METRICAS_MS) {
      publicarMetricas();
    } else if (metricasAgendadas.compareAndSet(false, true)) {
      agendador.schedule(this::publicarMetricas,
          INTERVALO_MINIMO_DE_METRICAS_MS - desdeOUltimo, TimeUnit.MILLISECONDS);
    }
  }

  private void publicarMetricas() {
    ultimoEnvioDeMetricas = System.currentTimeMillis();
    metricasAgendadas.set(false);
    if (clientes.isEmpty() || banco == null) {
      return;
    }
    try {
      despachar("metricas", Metricas.calcular(banco));
    } catch (RuntimeException erro) {
      System.err.println("[erro] falha ao calcular metricas para o stream: " + erro.getMessage());
    }
  }

  private void despachar(String tipo, Object dados) {
    if (clientes.isEmpty()) {
      return;
    }
    String bloco = blocoSse(tipo, dados);
    for (Cliente cliente : clientes) {
      try {
        cliente.escrever(bloco);
      } catch (IOException erro) {
        // Cliente caiu no meio da escrita: sai da lista sem derrubar nada.
        desconectar(cliente);
      }
    }
  }

  public void encerrarTudo() {
    for (Cliente cliente : clientes) {
      cliente.encerrar();
    }
    clientes.clear();
    agendador.shutdownNow();
  }
}
