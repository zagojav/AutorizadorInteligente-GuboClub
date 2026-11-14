// Bloco didático: os três conceitos que a banca precisa entender em 10 segundos.
import { memo } from 'react';
import { Dica } from './Dica.jsx';
import { IconeChave, IconeDocumento, IconeFila } from './Icones.jsx';

const CONCEITOS = [
  {
    nome: 'Disjuntor',
    Icone: IconeChave,
    texto: 'Depois de 3 falhas seguidas, para de chamar o convênio e manda direto pro humano.',
  },
  {
    nome: 'Trava de autorização',
    Icone: IconeDocumento,
    texto: 'Sem número de autorização, nunca vira autorizada.',
  },
  {
    nome: 'Fila isolada',
    Icone: IconeFila,
    texto: 'Cada convênio tem sua fila. Um caindo não trava os outros.',
  },
];

export const Conceitos = memo(function Conceitos() {
  return (
    <section className="secao" aria-labelledby="titulo-conceitos">
      <div className="secao__cabeca">
        <h2 className="secao__titulo" id="titulo-conceitos">Como ler esta tela</h2>
      </div>

      <ul className="conceitos">
        {CONCEITOS.map(({ nome, Icone, texto }) => (
          <li className="conceito" key={nome}>
            <span className="conceito__nome">
              <Icone tamanho={17} />
              {nome}
              <Dica rotulo={nome.toLowerCase()} texto={texto} />
            </span>
            <span className="conceito__texto">{texto}</span>
          </li>
        ))}
      </ul>
    </section>
  );
});
