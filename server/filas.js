// Fila isolada por convênio: um worker por convênio, cada um com sua fila em memória
// alimentada pelo banco. O worker processa uma solicitação por vez (é o que faz a
// retentativa e o disjuntor terem sentido), e um worker travado NÃO bloqueia os outros,
// porque cada um roda seu próprio laço assíncrono.
import { processarSolicitacao } from './motor.js';
import { publicar } from './barramento.js';

class FilaDeConvenio {
  constructor(db, convenio) {
    this.db = db;
    this.convenio = convenio;
    this.pendentes = [];
    this.emExecucao = false;
    this.aguardando = [];
  }

  enfileirar(solicitacaoId) {
    if (this.pendentes.includes(solicitacaoId)) return;
    this.pendentes.push(solicitacaoId);
    publicar('solicitacao_atualizada', {
      id: solicitacaoId,
      convenio: this.convenio,
      status: 'na_fila',
      status_de: null,
      motivo: `aguardando o worker de ${this.convenio}`,
      regra_usada: null,
      numero_autorizacao: null,
      latencia_ms: null,
    });
    this.girar();
  }

  // Laço do worker. Nunca lança: uma solicitação problemática não para a fila do convênio.
  async girar() {
    if (this.emExecucao) return;
    this.emExecucao = true;
    try {
      while (this.pendentes.length > 0) {
        const solicitacaoId = this.pendentes.shift();
        try {
          await processarSolicitacao(this.db, solicitacaoId);
        } catch (erro) {
          console.error(`[erro] worker ${this.convenio} falhou em ${solicitacaoId}:`, erro.message);
        }
      }
    } finally {
      this.emExecucao = false;
      const esperando = this.aguardando;
      this.aguardando = [];
      esperando.forEach((resolver) => resolver());
    }
  }

  // Promessa que resolve quando a fila deste convênio esvazia.
  aguardarVazio() {
    if (!this.emExecucao && this.pendentes.length === 0) return Promise.resolve();
    return new Promise((resolver) => this.aguardando.push(resolver));
  }

  tamanho() {
    return this.pendentes.length + (this.emExecucao ? 1 : 0);
  }
}

export class GerenciadorDeFilas {
  constructor(db) {
    this.db = db;
    this.filas = new Map();
  }

  obterFila(convenio) {
    if (!this.filas.has(convenio)) {
      this.filas.set(convenio, new FilaDeConvenio(this.db, convenio));
    }
    return this.filas.get(convenio);
  }

  // Enfileira ids no worker do convênio de cada um (lido do banco).
  enfileirar(ids) {
    const buscar = this.db.prepare('SELECT id, convenio FROM solicitacoes WHERE id = ?');
    for (const id of ids) {
      const solicitacao = buscar.get(id);
      if (!solicitacao) continue;
      this.obterFila(solicitacao.convenio).enfileirar(solicitacao.id);
    }
  }

  // Espera TODAS as filas esvaziarem. Usado pela rota que devolve o resultado da rodada.
  async aguardarConclusao() {
    // Enquanto espera, um worker pode ter enfileirado mais: repete até todas estarem vazias.
    let rodadas = 0;
    while (rodadas < 50) {
      await Promise.all([...this.filas.values()].map((fila) => fila.aguardarVazio()));
      if ([...this.filas.values()].every((fila) => fila.tamanho() === 0)) return;
      rodadas += 1;
    }
  }

  situacao() {
    return Object.fromEntries(
      [...this.filas.entries()].map(([convenio, fila]) => [convenio, {
        na_fila: fila.pendentes.length,
        processando: fila.emExecucao,
      }]),
    );
  }
}
