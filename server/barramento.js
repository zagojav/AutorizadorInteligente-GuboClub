// Barramento de eventos em memória. O motor e as filas publicam aqui; a rota /api/stream
// assina. Fica isolado do banco de propósito: não persiste nada, só avisa quem está ouvindo.
import { EventEmitter } from 'node:events';

export const TIPOS_DE_EVENTO = Object.freeze([
  'solicitacao_atualizada',
  'disjuntor_mudou',
  'modo_mudou',
  'tarefa_criada',
  'metricas',
]);

const barramento = new EventEmitter();
// Vários clientes SSE ao mesmo tempo na demo: sem isso o Node avisa de "leak" a partir de 10.
barramento.setMaxListeners(100);

export function publicar(tipo, dados) {
  // Publicar nunca pode derrubar o processo: se um ouvinte explodir, só loga.
  try {
    barramento.emit('evento', { tipo, dados, horario: new Date().toISOString() });
  } catch (erro) {
    console.error('[erro] falha ao publicar evento no barramento:', erro.message);
  }
}

// Devolve a função de cancelamento: quem assina é responsável por chamar no disconnect.
export function assinar(ouvinte) {
  barramento.on('evento', ouvinte);
  return () => barramento.off('evento', ouvinte);
}

export function contarAssinantes() {
  return barramento.listenerCount('evento');
}
