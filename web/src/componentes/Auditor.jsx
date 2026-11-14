// Auditor de consistência: divergências encontradas nos dados do kit, por tipo.
// Nenhum alerta muda a decisão do motor (muda_resultado é sempre false no backend).
import { memo } from 'react';
import { Bloco, Esqueleto } from './Estado.jsx';
import { Dica } from './Dica.jsx';
import { IconeAlerta } from './Icones.jsx';

// Nome legível de cada tipo que o auditor emite (server/auditor.js).
const NOME_DO_TIPO = {
  convenio_divergente: 'Convênio divergente',
  procedimento_fora_da_regra: 'Procedimento fora da regra',
  guia_conflitante: 'Guia conflitante',
  cadastro_irregular: 'Cadastro irregular',
  sem_consentimento: 'Sem consentimento de contato',
};

export const Auditor = memo(function Auditor({ auditoria, carregando, erro }) {
  const porTipo = Object.entries(auditoria?.por_tipo ?? {});
  const alertas = auditoria?.alertas ?? [];

  return (
    <section className="secao" aria-labelledby="titulo-auditor">
      <div className="secao__cabeca">
        <h2 className="secao__titulo" id="titulo-auditor">
          <IconeAlerta tamanho={17} /> Auditor de consistência
          <Dica
            rotulo="o auditor"
            texto="Cruza fila, cadastro, guias e regras do kit procurando contradição. Mostra o que achou; não interfere na decisão."
          />
        </h2>
        <span className="secao__nota">
          {auditoria ? `${auditoria.total} alerta${auditoria.total === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div className="cartao auditor">
        <p className="auditor__frase">
          Divergências nos dados do kit. Não mudam a decisão; vão pra revisão humana.
        </p>

        <Bloco
          carregando={carregando}
          erro={erro}
          vazio={porTipo.length === 0}
          esqueleto={<Esqueleto altura={70} raio="10px" />}
          tituloVazio="Nenhuma divergência encontrada"
          dicaVazio="O auditor rodou e não achou contradição nos dados carregados."
        >
          <>
            <ul className="tipos">
              {porTipo.map(([tipo, contagem]) => (
                <li className="tipo" key={tipo}>
                  <span className="tipo__contagem num">{contagem}</span>
                  <span className="tipo__nome">{NOME_DO_TIPO[tipo] ?? tipo.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>

            <ul className="alertas">
              {alertas.map((alerta, indice) => (
                <li className="alerta" key={`${alerta.tipo}-${alerta.referencia}-${indice}`}>
                  <span className="alerta__ref num">{alerta.referencia}</span>
                  <span className="alerta__descricao">
                    {alerta.descricao}
                    <span className="alerta__fonte">fonte: {alerta.fonte}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        </Bloco>
      </div>
    </section>
  );
});
