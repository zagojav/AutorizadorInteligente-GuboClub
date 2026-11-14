// Selo de estado. Regra da identidade: cor NUNCA aparece sozinha, sempre com texto e ícone.
import { memo } from 'react';
import { IconeAlerta, IconeCerto, IconeDocumento, IconeFila, IconeGirando, IconePessoa, IconeRelogio } from './Icones.jsx';

// Mapa status do motor -> aparência. Os status vêm de server/motor.js.
const APARENCIA = {
  autorizada: { rotulo: 'Autorizada', tom: 'verde', Icone: IconeCerto },
  pendente_documento: { rotulo: 'Pendente de documento', tom: 'ambar', Icone: IconeDocumento },
  tarefa_humana: { rotulo: 'Tarefa humana', tom: 'vermelho', Icone: IconePessoa },
  erro_integracao: { rotulo: 'Erro de integração', tom: 'vermelho', Icone: IconeAlerta },
  em_analise: { rotulo: 'Em análise', tom: 'marca', Icone: IconeGirando },
  na_fila: { rotulo: 'Na fila', tom: 'neutro', Icone: IconeFila },
  recebida: { rotulo: 'Recebida', tom: 'neutro', Icone: IconeRelogio },
};

export function aparenciaDoStatus(status) {
  return APARENCIA[status] ?? { rotulo: status ?? 'desconhecido', tom: 'neutro', Icone: IconeRelogio };
}

export const SeloDeStatus = memo(function SeloDeStatus({ status, tamanho = 13 }) {
  const { rotulo, tom, Icone } = aparenciaDoStatus(status);
  return (
    <span className={`selo selo--${tom}`}>
      <Icone tamanho={tamanho} />
      {rotulo}
    </span>
  );
});

// Selo genérico, usado pra "simulado", origem do texto da IA, modo do convênio etc.
export const Selo = memo(function Selo({ tom = 'contorno', Icone, children }) {
  return (
    <span className={`selo selo--${tom}`}>
      {Icone ? <Icone tamanho={13} /> : null}
      {children}
    </span>
  );
});
