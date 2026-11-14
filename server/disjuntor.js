// Disjuntor por convênio: fechado -> aberto -> meio_aberto -> fechado.
// Abre depois de 3 falhas seguidas. Aberto, bloqueia a chamada (não chega na API simulada).
// Depois da espera, vira meio_aberto e libera UMA chamada de teste: sucesso fecha, falha reabre.
import { registrarEvento } from './eventos.js';
import { publicar } from './barramento.js';

export const FALHAS_PARA_ABRIR = 3;

// 15 s na demo. Os testes encurtam por variável de ambiente pra não esperar de verdade.
export function esperaParaMeioAbertoMs() {
  const configurado = Number(process.env.DISJUNTOR_ESPERA_MS);
  return Number.isFinite(configurado) && configurado >= 0 ? configurado : 15000;
}

function anotarMudanca(db, convenio, de, para, motivo) {
  registrarEvento(db, {
    solicitacao: `convenio:${convenio.id}`,
    statusDe: `disjuntor_${de}`,
    statusPara: `disjuntor_${para}`,
    motivo,
    regraUsada: null,
    ator: 'sistema',
  });
  publicar('disjuntor_mudou', {
    convenio: convenio.id,
    nome: convenio.nome,
    de,
    para,
    motivo,
  });
}

function buscarConvenio(db, convenioId) {
  return db.prepare('SELECT * FROM convenios WHERE id = ?').get(convenioId);
}

// Decide se a chamada pode sair. Devolve { permitido, estado, motivo }.
// Também é aqui que o 'aberto' vence o tempo e vira 'meio_aberto'.
export function avaliarAntesDaChamada(db, convenioId) {
  const convenio = buscarConvenio(db, convenioId);
  if (!convenio) return { permitido: true, estado: 'fechado' };

  if (convenio.disjuntor === 'aberto') {
    const abertoDesde = convenio.aberto_em ? Date.parse(convenio.aberto_em) : 0;
    const tempoAberto = Date.now() - abertoDesde;
    if (tempoAberto >= esperaParaMeioAbertoMs()) {
      db.prepare("UPDATE convenios SET disjuntor = 'meio_aberto' WHERE id = ?").run(convenioId);
      anotarMudanca(db, convenio, 'aberto', 'meio_aberto', `${convenio.nome}: espera cumprida, liberando 1 chamada de teste`);
      return { permitido: true, estado: 'meio_aberto' };
    }
    return {
      permitido: false,
      estado: 'aberto',
      motivo: `disjuntor aberto: ${convenio.nome} indisponível`,
    };
  }

  return { permitido: true, estado: convenio.disjuntor };
}

// Sucesso: zera o contador, fecha o disjuntor e devolve o status_integracao padrão do kit.
export function registrarSucesso(db, convenioId) {
  const convenio = buscarConvenio(db, convenioId);
  if (!convenio) return;
  db.prepare(`
    UPDATE convenios
    SET falhas_seguidas = 0, disjuntor = 'fechado', aberto_em = NULL, status_integracao = status_padrao
    WHERE id = ?
  `).run(convenioId);
  if (convenio.disjuntor !== 'fechado') {
    anotarMudanca(db, convenio, convenio.disjuntor, 'fechado', `${convenio.nome}: chamada de teste deu certo, disjuntor fechado`);
  }
}

// Falha: soma no contador e abre o disjuntor na 3ª falha seguida (ou volta a abrir se a
// chamada de teste do meio_aberto falhou).
export function registrarFalha(db, convenioId) {
  const convenio = buscarConvenio(db, convenioId);
  if (!convenio) return { estado: 'fechado', falhas: 0 };

  const falhas = convenio.falhas_seguidas + 1;
  const deveAbrir = convenio.disjuntor === 'meio_aberto' || falhas >= FALHAS_PARA_ABRIR;
  const estado = deveAbrir ? 'aberto' : convenio.disjuntor;
  const statusIntegracao = deveAbrir || convenio.status_padrao === 'fora' ? 'fora' : 'degradado';

  db.prepare(`
    UPDATE convenios
    SET falhas_seguidas = ?, disjuntor = ?, status_integracao = ?, aberto_em = ?
    WHERE id = ?
  `).run(falhas, estado, statusIntegracao, deveAbrir ? new Date().toISOString() : convenio.aberto_em, convenioId);

  if (deveAbrir && convenio.disjuntor !== 'aberto') {
    const motivo = convenio.disjuntor === 'meio_aberto'
      ? `${convenio.nome}: chamada de teste falhou, disjuntor reaberto`
      : `${convenio.nome}: ${falhas} falhas seguidas, disjuntor aberto`;
    anotarMudanca(db, convenio, convenio.disjuntor, 'aberto', motivo);
  }

  return { estado, falhas };
}
