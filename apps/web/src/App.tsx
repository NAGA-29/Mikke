import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { clearToken, getToken, setToken } from './api';
import { ResourceList } from './pages/ResourceList';
import { ResourceDetail } from './pages/ResourceDetail';
import { ResourceForm } from './pages/ResourceForm';
import { SoftwareProducts } from './pages/SoftwareProducts';
import { SoftwareInstallations } from './pages/SoftwareInstallations';
import { ReleaseCycles } from './pages/ReleaseCycles';
import { EolDashboard } from './pages/EolDashboard';
import { EolChangeRequests } from './pages/EolChangeRequests';
import { AuditLogs } from './pages/AuditLogs';
import { Diagrams } from './pages/Diagrams';

const DiagramCanvas = lazy(() => import('./pages/DiagramCanvas').then((m) => ({ default: m.DiagramCanvas })));

export function App() {
  const [token, setTok] = useState(getToken());
  if (!token) return <Login onLogin={(t) => { setToken(t); setTok(t); }} />;
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Mikke</h1>
        <nav>
          <Link to="/resources">資産</Link>
          <Link to="/diagrams">構成図</Link>
          <Link to="/software/products">ソフトウェア製品</Link>
          <Link to="/software/installations">ソフトウェア導入</Link>
          <Link to="/software/release-cycles">系列・イベント</Link>
          <Link to="/eol">EOL ダッシュボード</Link>
          <Link to="/software/lifecycle-event-change-requests">EOL 承認キュー</Link>
          <Link to="/audit-logs">監査ログ</Link>
        </nav>
        <button className="link" onClick={() => { clearToken(); setTok(null); }}>ログアウト</button>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/resources" replace />} />
          <Route path="/resources" element={<ResourceList />} />
          <Route path="/resources/new" element={<ResourceForm key="new" />} />
          <Route path="/resources/:id/edit" element={<ResourceForm />} />
          <Route path="/resources/:id" element={<ResourceDetail />} />
          <Route path="/software/products" element={<SoftwareProducts />} />
          <Route path="/software/installations" element={<SoftwareInstallations />} />
          <Route path="/software/release-cycles" element={<ReleaseCycles />} />
          <Route path="/eol" element={<EolDashboard />} />
          <Route path="/software/lifecycle-event-change-requests" element={<EolChangeRequests />} />
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="/diagrams" element={<Diagrams />} />
          <Route path="/diagrams/:id" element={<Suspense fallback={<p role="status">Canvasを読み込み中…</p>}><DiagramCanvas /></Suspense>} />
        </Routes>
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (t: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form className="login" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onLogin(v.trim()); }}>
      <h1>Mikke</h1>
      <label>APIトークン<input type="password" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></label>
      <button type="submit">ログイン</button>
    </form>
  );
}
