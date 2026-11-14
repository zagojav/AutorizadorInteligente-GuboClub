package br.gubo.autorizador;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Fila isolada por convenio: um worker por convenio, cada um com sua fila em memoria
 * alimentada pelo banco. O worker processa uma solicitacao por vez (e o que faz a
 * retentativa e o disjuntor terem sentido), e um worker travado NAO bloqueia os outros,
 * porque cada um roda no seu proprio executor.
 */
public final class FilaPorConvenio {

  /** Uma fila, com seu unico worker. */
  static final class Fila {
    private final String convenio;
    private final Motor motor;
    private final TempoReal tempoReal;
    private final ExecutorService executor;
    private final Deque<String> pendentes = new ArrayDeque<>();
    private boolean emExecucao;

    Fila(String convenio, Motor motor, TempoReal tempoReal) {
      this.convenio = convenio;
      this.motor = motor;
      this.tempoReal = tempoReal;
      this.executor = Executors.newSingleThreadExecutor(tarefa -> {
        Thread linha = new Thread(tarefa, "fila-" + convenio);
        linha.setDaemon(true);
        return linha;
      });
    }

    void enfileirar(String solicitacaoId) {
      synchronized (this) {
        if (pendentes.contains(solicitacaoId)) {
          return;
        }
        pendentes.addLast(solicitacaoId);
      }
      tempoReal.publicar("solicitacao_atualizada", Json.mapa(
          "id", solicitacaoId,
          "convenio", convenio,
          "status", "na_fila",
          "status_de", null,
          "motivo", "aguardando o worker de " + convenio,
          "regra_usada", null,
          "numero_autorizacao", null,
          "latencia_ms", null));
      girar();
    }

    private void girar() {
      synchronized (this) {
        if (emExecucao) {
          return;
        }
        emExecucao = true;
      }
      executor.submit(this::laco);
    }

    /** Laco do worker. Nunca lanca: uma solicitacao problematica nao para a fila. */
    private void laco() {
      try {
        while (true) {
          String solicitacaoId;
          synchronized (this) {
            solicitacaoId = pendentes.pollFirst();
            if (solicitacaoId == null) {
              emExecucao = false;
              notifyAll();
              return;
            }
          }
          try {
            motor.processarSolicitacao(solicitacaoId);
          } catch (RuntimeException erro) {
            System.err.println("[erro] worker " + convenio + " falhou em " + solicitacaoId
                + ": " + erro.getMessage());
          }
        }
      } catch (Throwable erro) {
        synchronized (this) {
          emExecucao = false;
          notifyAll();
        }
        System.err.println("[erro] worker " + convenio + " parou: " + erro.getMessage());
      }
    }

    /** Espera a fila deste convenio esvaziar. */
    void aguardarVazio(long limiteMs) {
      long prazo = System.currentTimeMillis() + limiteMs;
      synchronized (this) {
        while (emExecucao || !pendentes.isEmpty()) {
          long restante = prazo - System.currentTimeMillis();
          if (restante <= 0) {
            return;
          }
          try {
            wait(Math.min(restante, 200));
          } catch (InterruptedException erro) {
            Thread.currentThread().interrupt();
            return;
          }
        }
      }
    }

    synchronized int tamanho() {
      return pendentes.size() + (emExecucao ? 1 : 0);
    }

    synchronized Map<String, Object> situacao() {
      return Json.mapa("na_fila", (long) pendentes.size(), "processando", emExecucao);
    }

    void encerrar() {
      executor.shutdownNow();
    }
  }

  private final Banco banco;
  private final Motor motor;
  private final TempoReal tempoReal;
  private final Map<String, Fila> filas = new ConcurrentHashMap<>();

  public FilaPorConvenio(Banco banco, Motor motor, TempoReal tempoReal) {
    this.banco = banco;
    this.motor = motor;
    this.tempoReal = tempoReal;
  }

  Fila obterFila(String convenio) {
    return filas.computeIfAbsent(convenio, chave -> new Fila(chave, motor, tempoReal));
  }

  /** Enfileira ids no worker do convenio de cada um (lido do banco). */
  public void enfileirar(List<String> ids) {
    if (ids.isEmpty()) return;
    String marcadores = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
    for (Map<String, Object> solicitacao : banco.consultar(
        "SELECT id, convenio FROM solicitacoes WHERE id IN (" + marcadores + ") ORDER BY sintetica, id", ids.toArray())) {
      obterFila((String) solicitacao.get("convenio")).enfileirar((String) solicitacao.get("id"));
    }
  }

  /** Espera TODAS as filas esvaziarem. Usado pela rota que devolve o resultado da rodada. */
  public void aguardarConclusao() {
    aguardarConclusao(120000);
  }

  public void aguardarConclusao(long limiteMs) {
    long prazo = System.currentTimeMillis() + limiteMs;
    for (int rodadas = 0; rodadas < 50; rodadas += 1) {
      long restante = prazo - System.currentTimeMillis();
      if (restante <= 0) {
        return;
      }
      for (Fila fila : filas.values()) {
        fila.aguardarVazio(restante);
      }
      boolean tudoVazio = filas.values().stream().allMatch(fila -> fila.tamanho() == 0);
      if (tudoVazio) {
        return;
      }
    }
  }

  public Map<String, Object> situacao() {
    Map<String, Object> situacao = new LinkedHashMap<>();
    filas.keySet().stream().sorted().forEach(convenio -> situacao.put(convenio, filas.get(convenio).situacao()));
    return situacao;
  }

  public boolean temTrabalho() {
    return filas.values().stream().anyMatch(fila -> fila.tamanho() > 0);
  }

  public void encerrar() {
    filas.values().forEach(Fila::encerrar);
  }
}
