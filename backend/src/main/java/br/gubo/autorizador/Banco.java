package br.gubo.autorizador;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Banco de dados: schema, indices e seed a partir do kit (REGRAS-DEMO-v1).
 *
 * Uma conexao por banco, com trava propria: toda consulta e escrita passa por aqui
 * serializada. O SQLite serializa escrita de qualquer forma, e assim os tres workers de
 * convenio nunca disputam a mesma conexao. A trava NUNCA e segurada durante chamada HTTP:
 * o motor faz uma operacao curta por vez.
 *
 * SQL sempre por PreparedStatement, nunca por concatenacao de texto.
 */
public final class Banco implements AutoCloseable {

  /** Teto de solicitacoes sinteticas no banco: acima disso as mais antigas saem. */
  public static final int LIMITE_SINTETICAS = 50;

  private final Connection conexao;
  private final Object trava = new Object();

  private Banco(Connection conexao) {
    this.conexao = conexao;
  }

  public static Banco abrir(String caminhoArquivo) {
    try {
      Connection conexao = DriverManager.getConnection("jdbc:sqlite:" + caminhoArquivo);
      Banco banco = new Banco(conexao);
      if (!":memory:".equals(caminhoArquivo)) {
        try (Statement comando = conexao.createStatement()) {
          comando.execute("PRAGMA journal_mode = WAL");
        }
      }
      banco.criarTabelas();
      return banco;
    } catch (SQLException erro) {
      throw new IllegalStateException("falha ao abrir o banco: " + erro.getMessage(), erro);
    }
  }

  @Override
  public void close() {
    synchronized (trava) {
      try {
        conexao.close();
      } catch (SQLException erro) {
        System.err.println("[erro] falha ao fechar o banco: " + erro.getMessage());
      }
    }
  }

  // --- acesso basico -------------------------------------------------------------------

  /** Consulta e devolve as linhas como mapas ordenados (nome da coluna -> valor). */
  public List<Map<String, Object>> consultar(String sql, Object... parametros) {
    synchronized (trava) {
      try (PreparedStatement comando = conexao.prepareStatement(sql)) {
        aplicarParametros(comando, parametros);
        try (ResultSet resultado = comando.executeQuery()) {
          ResultSetMetaData meta = resultado.getMetaData();
          int colunas = meta.getColumnCount();
          List<Map<String, Object>> linhas = new ArrayList<>();
          while (resultado.next()) {
            Map<String, Object> linha = new LinkedHashMap<>();
            for (int indice = 1; indice <= colunas; indice += 1) {
              linha.put(meta.getColumnLabel(indice), normalizar(resultado.getObject(indice)));
            }
            linhas.add(linha);
          }
          return linhas;
        }
      } catch (SQLException erro) {
        throw new IllegalStateException("falha na consulta: " + erro.getMessage(), erro);
      }
    }
  }

  public Map<String, Object> consultarUm(String sql, Object... parametros) {
    List<Map<String, Object>> linhas = consultar(sql, parametros);
    return linhas.isEmpty() ? null : linhas.get(0);
  }

  /** Primeiro valor da primeira linha, para COUNT(*) e afins. */
  public long contar(String sql, Object... parametros) {
    Map<String, Object> linha = consultarUm(sql, parametros);
    if (linha == null || linha.isEmpty()) {
      return 0L;
    }
    Object valor = linha.values().iterator().next();
    return valor instanceof Number numero ? numero.longValue() : 0L;
  }

  public int executar(String sql, Object... parametros) {
    synchronized (trava) {
      try (PreparedStatement comando = conexao.prepareStatement(sql)) {
        aplicarParametros(comando, parametros);
        return comando.executeUpdate();
      } catch (SQLException erro) {
        throw new IllegalStateException("falha ao executar: " + erro.getMessage(), erro);
      }
    }
  }

  /** Insere e devolve o id gerado (AUTOINCREMENT). */
  public long inserir(String sql, Object... parametros) {
    synchronized (trava) {
      try (PreparedStatement comando = conexao.prepareStatement(sql)) {
        aplicarParametros(comando, parametros);
        comando.executeUpdate();
        try (ResultSet chaves = comando.getGeneratedKeys()) {
          return chaves.next() ? chaves.getLong(1) : 0L;
        }
      } catch (SQLException erro) {
        throw new IllegalStateException("falha ao inserir: " + erro.getMessage(), erro);
      }
    }
  }

  private static void aplicarParametros(PreparedStatement comando, Object... parametros) throws SQLException {
    for (int indice = 0; indice < parametros.length; indice += 1) {
      comando.setObject(indice + 1, parametros[indice]);
    }
  }

  /**
   * O driver devolve INTEGER do SQLite como Integer ou Long dependendo do valor. O JSON do
   * Node sempre mostrava numero inteiro, entao normalizamos pra Long (o Jackson escreve
   * sem casa decimal) e deixamos texto e nulo como estao.
   */
  private static Object normalizar(Object valor) {
    if (valor instanceof Integer numero) {
      return numero.longValue();
    }
    return valor;
  }

  // --- schema --------------------------------------------------------------------------

  private void criarTabelas() {
    executarBloco("""
        CREATE TABLE IF NOT EXISTS convenios (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          status_integracao TEXT NOT NULL,
          status_padrao TEXT NOT NULL,
          disjuntor TEXT NOT NULL,
          falhas_seguidas INTEGER NOT NULL DEFAULT 0,
          aberto_em TEXT,
          tempo_limite_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS regras (
          convenio TEXT PRIMARY KEY,
          procedimento TEXT NOT NULL,
          exige_documento INTEGER NOT NULL,
          acao TEXT NOT NULL,
          fonte TEXT NOT NULL,
          versao INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS solicitacoes (
          id TEXT PRIMARY KEY,
          paciente TEXT NOT NULL,
          convenio TEXT NOT NULL,
          procedimento TEXT,
          status TEXT NOT NULL,
          numero_autorizacao TEXT,
          motivo TEXT,
          regra_usada TEXT,
          tentativas INTEGER NOT NULL DEFAULT 0,
          criado_em TEXT NOT NULL,
          respondido_em TEXT,
          latencia_ms INTEGER,
          status_esperado_kit TEXT,
          sintetica INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_solicitacoes_convenio_status ON solicitacoes(convenio, status);

        CREATE TABLE IF NOT EXISTS eventos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          solicitacao TEXT NOT NULL,
          status_de TEXT,
          status_para TEXT NOT NULL,
          motivo TEXT,
          regra_usada TEXT,
          ator TEXT NOT NULL,
          horario TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_eventos_solicitacao ON eventos(solicitacao);

        CREATE TABLE IF NOT EXISTS tarefas_humanas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          solicitacao TEXT NOT NULL,
          motivo TEXT NOT NULL,
          texto_ia TEXT,
          origem_texto TEXT,
          prioridade TEXT NOT NULL DEFAULT 'normal',
          responsavel TEXT,
          prazo TEXT,
          status TEXT NOT NULL DEFAULT 'aberta'
        );

        CREATE TABLE IF NOT EXISTS documentos (
          solicitacao TEXT NOT NULL,
          tipo TEXT NOT NULL,
          conteudo TEXT NOT NULL,
          recebido_em TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chamadas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          convenio TEXT NOT NULL,
          solicitacao TEXT NOT NULL,
          latencia_ms INTEGER NOT NULL,
          sucesso INTEGER NOT NULL,
          horario TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chamadas_convenio ON chamadas(convenio);

        CREATE TABLE IF NOT EXISTS pacientes (
          patient_id TEXT PRIMARY KEY,
          nome TEXT,
          documento TEXT,
          email TEXT,
          convenio TEXT,
          carteirinha TEXT,
          status_cadastro TEXT,
          consentimento_contato_simulado INTEGER
        );

        CREATE TABLE IF NOT EXISTS guias (
          os_id TEXT PRIMARY KEY,
          patient_id TEXT,
          autorizacao TEXT,
          assinatura TEXT,
          status TEXT
        );
        """);
  }

  private void executarBloco(String sqlComVariosComandos) {
    synchronized (trava) {
      try (Statement comando = conexao.createStatement()) {
        for (String parte : sqlComVariosComandos.split(";")) {
          String sql = parte.strip();
          if (!sql.isEmpty()) {
            comando.execute(sql);
          }
        }
      } catch (SQLException erro) {
        throw new IllegalStateException("falha ao criar o schema: " + erro.getMessage(), erro);
      }
    }
  }

  // --- seed do kit ---------------------------------------------------------------------

  /** "Aurora Demo" -> "aurora" */
  public static String normalizarConvenio(String nome) {
    if (nome == null) {
      return "";
    }
    String limpo = nome.strip();
    if (limpo.isEmpty()) {
      return "";
    }
    return limpo.split("\\s+")[0].toLowerCase();
  }

  /** "Procedimento DEMO-2" -> "DEMO-2" */
  public static String normalizarProcedimento(String nome) {
    if (nome == null) {
      return "";
    }
    return nome.replaceFirst("(?i)^Procedimento\\s+", "").strip();
  }

  /** Parser simples: os CSV do kit nao tem virgula nem aspas dentro de campo. */
  static List<Map<String, String>> lerCsv(Path caminho) {
    try {
      List<String> linhas = Files.readAllLines(caminho, StandardCharsets.UTF_8);
      List<Map<String, String>> registros = new ArrayList<>();
      if (linhas.isEmpty()) {
        return registros;
      }
      String[] cabecalho = linhas.get(0).split(",", -1);
      for (int indice = 1; indice < linhas.size(); indice += 1) {
        String linha = linhas.get(indice);
        if (linha.isBlank()) {
          continue;
        }
        String[] valores = linha.split(",", -1);
        Map<String, String> registro = new LinkedHashMap<>();
        for (int coluna = 0; coluna < cabecalho.length; coluna += 1) {
          registro.put(cabecalho[coluna], coluna < valores.length ? valores[coluna] : "");
        }
        registros.add(registro);
      }
      return registros;
    } catch (IOException erro) {
      throw new IllegalStateException("falha ao ler " + caminho + ": " + erro.getMessage(), erro);
    }
  }

  private void limparTabelas() {
    executarBloco("""
        DELETE FROM documentos;
        DELETE FROM tarefas_humanas;
        DELETE FROM eventos;
        DELETE FROM chamadas;
        DELETE FROM solicitacoes;
        DELETE FROM regras;
        DELETE FROM convenios;
        DELETE FROM pacientes;
        DELETE FROM guias;
        """);
  }

  /** Reseta o banco e recarrega os dados fixos do kit. Usada no boot e nos testes. */
  public void seed() {
    limparTabelas();
    Path pastaDados = Caminhos.dadosDoKit();

    String inserirConvenio = """
        INSERT INTO convenios (id, nome, status_integracao, status_padrao, disjuntor, falhas_seguidas, aberto_em, tempo_limite_ms)
        VALUES (?, ?, ?, ?, 'fechado', 0, NULL, ?)
        """;
    executar(inserirConvenio, "aurora", "Aurora Demo", "ok", "ok", 2000);
    executar(inserirConvenio, "horizonte", "Horizonte Demo", "ok", "ok", 2000);
    executar(inserirConvenio, "jardim", "Jardim Demo", "fora", "fora", 2000);

    String inserirRegra = """
        INSERT INTO regras (convenio, procedimento, exige_documento, acao, fonte, versao)
        VALUES (?, ?, ?, ?, 'REGRAS-DEMO-v1', 1)
        """;
    executar(inserirRegra, "aurora", "DEMO-1", 0, "autorizar");
    executar(inserirRegra, "horizonte", "DEMO-2", 1, "pedir_documento");
    executar(inserirRegra, "jardim", "qualquer", 0, "humano");
    executar(inserirRegra, "fora_da_base", "qualquer", 0, "humano");

    for (Map<String, String> paciente : lerCsv(pastaDados.resolve("pacientes_sinteticos.csv"))) {
      executar("""
          INSERT INTO pacientes (patient_id, nome, documento, email, convenio, carteirinha, status_cadastro, consentimento_contato_simulado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """,
          paciente.get("patient_id"),
          paciente.get("nome"),
          paciente.get("documento"),
          paciente.get("email"),
          paciente.get("convenio"),
          paciente.get("carteirinha"),
          paciente.get("status_cadastro"),
          "true".equals(paciente.get("consentimento_contato_simulado")) ? 1 : 0);
    }

    for (Map<String, String> guia : lerCsv(pastaDados.resolve("os_guias_mock.csv"))) {
      executar("""
          INSERT INTO guias (os_id, patient_id, autorizacao, assinatura, status)
          VALUES (?, ?, ?, ?, ?)
          """,
          guia.get("os_id"),
          guia.get("patient_id"),
          guia.get("autorizacao"),
          guia.get("assinatura"),
          guia.get("status"));
    }

    // Mapa patient_id -> procedimento normalizado, usado pela fila de autorizacao.
    Map<String, String> procedimentoPorPaciente = new LinkedHashMap<>();
    for (Map<String, String> agendamento : lerCsv(pastaDados.resolve("agendamentos_sinteticos.csv"))) {
      procedimentoPorPaciente.put(
          agendamento.get("patient_id"),
          normalizarProcedimento(agendamento.get("procedimento")));
    }

    String agora = Tempo.agora();
    for (Map<String, String> linha : lerCsv(pastaDados.resolve("fila_autorizacao_mock.csv"))) {
      String id = linha.get("request_id");
      executar("""
          INSERT INTO solicitacoes (id, paciente, convenio, procedimento, status, numero_autorizacao, motivo, regra_usada, tentativas, criado_em, respondido_em, latencia_ms, status_esperado_kit, sintetica)
          VALUES (?, ?, ?, ?, 'recebida', NULL, NULL, NULL, 0, ?, NULL, NULL, ?, 0)
          """,
          id,
          linha.get("patient_id"),
          normalizarConvenio(linha.get("convenio")),
          procedimentoPorPaciente.get(linha.get("patient_id")),
          agora,
          linha.get("status"));
      Eventos.registrar(this, id, null, "recebida", "solicitacao recebida do kit (seed)", null, "sistema");
    }
  }

  /** Reinicia uma solicitacao para 'recebida', limpando resultado, tarefas e documentos. */
  public void reiniciarSolicitacao(String id) {
    Map<String, Object> atual = consultarUm("SELECT status FROM solicitacoes WHERE id = ?", id);
    if (atual == null) {
      return;
    }
    executar("""
        UPDATE solicitacoes
        SET status = 'recebida', numero_autorizacao = NULL, motivo = NULL, regra_usada = NULL,
            respondido_em = NULL, latencia_ms = NULL, tentativas = 0
        WHERE id = ?
        """, id);
    executar("DELETE FROM tarefas_humanas WHERE solicitacao = ?", id);
    // Documentos anexados tambem saem: o estado inicial do kit nao tem documento, entao
    // reiniciar a fila sempre reproduz os mesmos tres resultados na demo.
    executar("DELETE FROM documentos WHERE solicitacao = ?", id);

    Eventos.registrar(this, id, (String) atual.get("status"), "recebida",
        "solicitacao reiniciada para novo processamento", null, "sistema");
  }

  /** Volta um convenio ao estado do kit: disjuntor fechado, sem falhas, status padrao. */
  public boolean restaurarConvenio(String convenioId) {
    return executar("""
        UPDATE convenios
        SET disjuntor = 'fechado', falhas_seguidas = 0, aberto_em = NULL, status_integracao = status_padrao
        WHERE id = ?
        """, convenioId) > 0;
  }

  public void restaurarTodosOsConvenios() {
    executar("""
        UPDATE convenios
        SET disjuntor = 'fechado', falhas_seguidas = 0, aberto_em = NULL, status_integracao = status_padrao
        """);
  }

  /** Uma solicitacao sintetica criada pela carga. */
  public record Sintetica(String id, String convenio) {
  }

  /**
   * Cria N sinteticas por convenio, copiando o procedimento do caso do kit daquele
   * convenio (nada fixo no codigo: o procedimento vem da propria base).
   */
  public List<Sintetica> criarSolicitacoesSinteticas(int porConvenio) {
    List<Map<String, Object>> basePorConvenio = consultar("""
        SELECT convenio, paciente, procedimento
        FROM solicitacoes
        WHERE sintetica = 0
        GROUP BY convenio
        ORDER BY convenio
        """);

    Map<String, Object> ultimo = consultarUm(
        "SELECT id FROM solicitacoes WHERE id LIKE 'DEMO-S%' ORDER BY id DESC LIMIT 1");
    int proximoNumero = 1;
    if (ultimo != null) {
      proximoNumero = Integer.parseInt(String.valueOf(ultimo.get("id")).replace("DEMO-S", "")) + 1;
    }

    List<Sintetica> criadas = new ArrayList<>();
    String agora = Tempo.agora();
    for (Map<String, Object> base : basePorConvenio) {
      String convenio = (String) base.get("convenio");
      for (int indice = 0; indice < porConvenio; indice += 1) {
        String id = "DEMO-S" + String.format("%03d", proximoNumero);
        proximoNumero += 1;
        executar("""
            INSERT INTO solicitacoes (id, paciente, convenio, procedimento, status, tentativas, criado_em, sintetica)
            VALUES (?, ?, ?, ?, 'recebida', 0, ?, 1)
            """, id, base.get("paciente"), convenio, base.get("procedimento"), agora);
        Eventos.registrar(this, id, null, "recebida",
            "solicitacao sintetica de carga (" + convenio + ")", null, "sistema");
        criadas.add(new Sintetica(id, convenio));
      }
    }

    apararSinteticas(LIMITE_SINTETICAS);
    return criadas;
  }

  /**
   * Mantem no maximo o limite de sinteticas: as mais antigas saem junto com suas tarefas,
   * documentos e chamadas. Os eventos NAO sao apagados: o log e append-only.
   */
  public int apararSinteticas(int limite) {
    List<Map<String, Object>> excedentes = consultar("""
        SELECT id FROM solicitacoes
        WHERE sintetica = 1
        ORDER BY criado_em DESC, id DESC
        LIMIT -1 OFFSET ?
        """, limite);

    for (Map<String, Object> linha : excedentes) {
      String id = (String) linha.get("id");
      executar("DELETE FROM tarefas_humanas WHERE solicitacao = ?", id);
      executar("DELETE FROM documentos WHERE solicitacao = ?", id);
      executar("DELETE FROM chamadas WHERE solicitacao = ?", id);
      executar("DELETE FROM solicitacoes WHERE id = ?", id);
    }
    return excedentes.size();
  }
}
