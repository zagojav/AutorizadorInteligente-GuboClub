package br.gubo.autorizador;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Camada de IA: a IA SUGERE, a regra DECIDE, o humano RESOLVE.
 *
 * Esta classe so produz texto. Nao escreve status, nao autoriza, nao cria numero de
 * autorizacao e o Motor nao a conhece. A unica escrita que a rota faz com o resultado daqui
 * e texto_ia/origem_texto na propria tarefa.
 *
 * Nesta versao Java so existe o template deterministico (origem "template"). O provedor
 * externo ainda nao foi portado, e rotular template como IA seria mentira.
 */
public final class Ia {

  /** Limites de custo: uma geracao por tarefa ao mesmo tempo e 10 por minuto no total. */
  private static final int MAXIMO_POR_MINUTO = 10;
  private static final long JANELA_MS = 60000;

  private static final Set<String> geracoesEmAndamento = ConcurrentHashMap.newKeySet();
  private static final List<Long> iniciosRecentes = new ArrayList<>();

  private static final Pattern NOME = Pattern.compile("(?im)^\\s*Nome:\\s*(.+)$");
  private static final Pattern IDENTIFICADOR = Pattern.compile("(?im)^\\s*Identificador:\\s*(.+)$");

  private Ia() {
  }

  /** Estado do provedor pra mostrar no painel. NUNCA devolve chave, so o que esta em uso. */
  public static Map<String, Object> situacaoDoProvedor() {
    return Json.mapa(
        "provedor", "template",
        "modelo", null,
        "geracoes_em_andamento", (long) geracoesEmAndamento.size(),
        "limite_por_minuto", (long) MAXIMO_POR_MINUTO);
  }

  /** Vaga de geracao: {ok} ou {ok:false, codigo, motivo}. */
  public record Vaga(boolean ok, int codigo, String motivo) {
  }

  public static Vaga reservarGeracao(String chave) {
    long agora = System.currentTimeMillis();
    synchronized (iniciosRecentes) {
      iniciosRecentes.removeIf(inicio -> agora - inicio >= JANELA_MS);

      if (geracoesEmAndamento.contains(chave)) {
        return new Vaga(false, 409, "já existe uma geração em andamento para esta tarefa");
      }
      if (iniciosRecentes.size() >= MAXIMO_POR_MINUTO) {
        return new Vaga(false, 429, "limite de gerações por minuto atingido");
      }

      geracoesEmAndamento.add(chave);
      iniciosRecentes.add(agora);
      return new Vaga(true, 200, null);
    }
  }

  public static void liberarGeracao(String chave) {
    geracoesEmAndamento.remove(chave);
  }

  /** So pros testes: zera os contadores entre casos. */
  public static void resetarLimites() {
    geracoesEmAndamento.clear();
    synchronized (iniciosRecentes) {
      iniciosRecentes.clear();
    }
  }

  private static long atrasoDoTemplateMs() {
    return Config.numero("IA_ATRASO_TEMPLATE_MS", 15, 0);
  }

  /** Contexto da tarefa: SO os campos necessarios. O banco inteiro nunca entra aqui. */
  public static Map<String, Object> montarContextoDaTarefa(Banco banco, Map<String, Object> tarefa) {
    String solicitacaoId = (String) tarefa.get("solicitacao");
    Map<String, Object> solicitacao = banco.consultarUm("""
        SELECT s.id, s.paciente, s.procedimento, s.status, s.motivo, s.regra_usada, s.tentativas,
               COALESCE(c.nome, s.convenio) AS convenio
        FROM solicitacoes s
        LEFT JOIN convenios c ON c.id = s.convenio
        WHERE s.id = ?
        """, solicitacaoId);

    List<Map<String, Object>> eventos = banco.consultar("""
        SELECT status_de, status_para, motivo, ator
        FROM eventos WHERE solicitacao = ?
        ORDER BY id DESC LIMIT 5
        """, solicitacaoId);
    List<Map<String, Object>> emOrdem = new ArrayList<>(eventos);
    java.util.Collections.reverse(emOrdem);

    Map<String, Object> contexto = new LinkedHashMap<>();
    contexto.put("tarefa", Json.mapa(
        "motivo", tarefa.get("motivo"),
        "prioridade", tarefa.get("prioridade"),
        "prazo", tarefa.get("prazo")));
    contexto.put("solicitacao", solicitacao == null ? Json.mapa("id", solicitacaoId) : solicitacao);
    contexto.put("eventos", emOrdem);
    return contexto;
  }

  private static String ou(Object valor, String padrao) {
    if (valor == null) {
      return padrao;
    }
    String texto = String.valueOf(valor);
    return texto.isBlank() ? padrao : texto;
  }

  /** Template deterministico: a rede de seguranca. Mesmo conteudo, sem depender de provedor. */
  @SuppressWarnings("unchecked")
  public static String textoDoTemplate(Map<String, Object> contexto) {
    Map<String, Object> solicitacao = (Map<String, Object>) contexto.get("solicitacao");
    Map<String, Object> tarefa = (Map<String, Object>) contexto.get("tarefa");
    List<Map<String, Object>> eventos = (List<Map<String, Object>>) contexto.get("eventos");
    Map<String, Object> ultimoEvento = eventos.isEmpty() ? null : eventos.get(eventos.size() - 1);

    String ultimo = ultimoEvento == null
        ? "sem eventos"
        : ultimoEvento.get("status_para") + ": " + ou(ultimoEvento.get("motivo"), "sem motivo");

    String procedimento = ou(solicitacao.get("procedimento"), "não informado");
    return String.join("\n", List.of(
        "Solicitação " + solicitacao.get("id") + " (" + ou(solicitacao.get("convenio"), "convênio não informado")
            + ", procedimento " + procedimento + ") parou em " + ou(solicitacao.get("status"), "status não informado") + ".",
        "Veio para a equipe porque: " + tarefa.get("motivo") + ".",
        "Regra aplicada: " + ou(solicitacao.get("regra_usada"), "não informada")
            + "; tentativas de integração: " + ou(solicitacao.get("tentativas"), "0") + ".",
        "O que fazer agora: conferir a solicitação no portal do convênio e responder manualmente, "
            + "sem emitir autorização sem número devolvido pelo convênio.",
        "Conferir: paciente " + ou(solicitacao.get("paciente"), "não informado") + ", procedimento "
            + procedimento + " e o último evento (" + ultimo + ")."));
  }

  /**
   * Gera o texto da tarefa e entrega aos poucos. Devolve o texto completo; cada trecho vai
   * pelo consumidor, que e quem escreve no SSE.
   */
  public static String gerarTextoDaTarefa(Map<String, Object> contexto, Consumer<String> aoReceberTrecho) {
    String texto = textoDoTemplate(contexto);
    long atraso = atrasoDoTemplateMs();
    // Mesma quebra do Node: divide mantendo os espacos como trechos proprios.
    for (String parte : texto.split("(?<=\\s)|(?=\\s)")) {
      if (parte.isEmpty()) {
        continue;
      }
      aoReceberTrecho.accept(parte);
      if (atraso > 0) {
        try {
          Thread.sleep(atraso);
        } catch (InterruptedException erro) {
          Thread.currentThread().interrupt();
          break;
        }
      }
    }
    return texto;
  }

  // --- resumo do documento anexado -----------------------------------------------------

  /** Achados do documento. Lidos do arquivo, nunca gerados por modelo. */
  public static Map<String, Object> lerAchadosDoDocumento(String conteudo) {
    String texto = conteudo == null ? "" : conteudo;
    Matcher nome = NOME.matcher(texto);
    Matcher identificador = IDENTIFICADOR.matcher(texto);
    return Json.mapa(
        "nome", nome.find() ? nome.group(1).strip() : null,
        "identificador", identificador.find() ? identificador.group(1).strip() : null,
        "tem_marca_demo", texto.contains("DEMO"));
  }

  /** Resumo do documento. Devolve sempre {texto, origem, achados}: nunca lanca. */
  public static Map<String, Object> resumirDocumento(String conteudo) {
    Map<String, Object> achados = lerAchadosDoDocumento(conteudo);
    boolean temMarca = Boolean.TRUE.equals(achados.get("tem_marca_demo"));
    String texto = String.join("\n", List.of(
        "Documento lido: nome \"" + ou(achados.get("nome"), "não encontrado") + "\", identificador \""
            + ou(achados.get("identificador"), "não encontrado") + "\".",
        temMarca
            ? "Traz a marca DEMO, ou seja, é documento fictício de demonstração."
            : "Não traz a marca DEMO: conferir a origem do arquivo antes de seguir.",
        "Sugestão para conferência humana; a decisão continua sendo da regra do convênio."));

    return Json.mapa("texto", texto, "origem", "template", "achados", achados);
  }
}
