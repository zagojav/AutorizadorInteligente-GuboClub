// Duas rotas: / (abertura narrativa) e /painel (tela ao vivo).
// HashRouter de propósito: o backend serve ./web/dist como estático, sem fallback
// pra index.html. Com hash, abrir /#/painel direto funciona sem configurar o servidor.
import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

// A abertura carrega gsap e lenis: fica num chunk separado pra o painel abrir leve.
const Abertura = lazy(() => import('./paginas/Abertura.jsx'));
const Painel = lazy(() => import('./paginas/Painel.jsx'));

function Carregando() {
  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--tinta-3)' }}>
      <span>carregando...</span>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={<Carregando />}>
        <Routes>
          <Route path="/" element={<Abertura />} />
          <Route path="/painel" element={<Painel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
