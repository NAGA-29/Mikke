import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { clearToken, getToken, setToken, AUTH_EXPIRED_EVENT } from './api';
import { Button, ErrorState, LoadingState } from './components/ui';
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
import { Docs } from './pages/Docs';

const DiagramCanvas = lazy(() => import('./pages/DiagramCanvas').then((m) => ({ default: m.DiagramCanvas })));

export function App() {
  const [authenticated, setAuthenticated] = useState(() => !!getToken());
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const onExpired = () => { setExpired(true); setAuthenticated(false); };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);
  if (!authenticated) return <Login expired={expired} onLogin={() => { setExpired(false); setAuthenticated(true); }} />;
  const groups = [
    { label: '資産', items: [['/resources', '資産一覧', 'resources']] },
    { label: '関係・図', items: [['/diagrams', '構成図', 'diagrams']] },
    { label: 'ソフトウェア・EOL', items: [
      ['/software/products', 'ソフトウェア製品', 'products'], ['/software/installations', 'ソフトウェア導入', 'installations'],
      ['/software/release-cycles', 'サポート期限', 'release-cycles'], ['/eol', 'EOL 状況', 'eol'],
    ] },
    { label: '運用', items: [['/software/lifecycle-event-change-requests', '承認待ち', 'approvals'], ['/audit-logs', '監査ログ', 'audit-logs']] },
    { label: 'ヘルプ', items: [['/docs', 'ドキュメント', 'docs']] },
  ];
  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <aside className="sidebar">
        <div className="brand"><strong>Mikke<span className="brand-dot">.</span></strong><span>INTERNAL CMDB</span></div>
        <nav aria-label="メインナビゲーション">
          {groups.map((group) => <div className="nav-group" key={group.label}>
            <p className="nav-group-title">{group.label}</p>
            {group.items.map(([path, label, key]) => <NavLink key={key} to={path!} data-testid={`nav-${key}`}
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>{label}</NavLink>)}
          </div>)}
        </nav>
        <div className="sidebar-footer"><span>APIトークンで接続中</span>
          <Button variant="ghost" data-testid="logout" onClick={() => { clearToken(); setExpired(false); setAuthenticated(false); }}>ログアウト</Button></div>
      </aside>
      <main id="main-content" tabIndex={-1}>
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
          <Route path="/docs" element={<Docs />} />
          <Route path="/diagrams" element={<Diagrams />} />
          <Route path="/diagrams/:id" element={<Suspense fallback={<LoadingState>Canvasを読み込み中…</LoadingState>}><DiagramCanvas /></Suspense>} />
        </Routes>
      </main>
    </div>
  );
}

function Login({ onLogin, expired }: { onLogin: () => void; expired: boolean }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const token = String(new FormData(form).get('token') ?? '').trim();
    if (!token) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/resources?limit=1', { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        setError(response.status === 401 ? 'トークンが正しくありません'
          : response.status === 403 ? 'このトークンには閲覧権限（mikke:read）がありません'
          : 'ログインを確認できませんでした。時間をおいて再試行してください。');
        return;
      }
      setToken(token);
      form.reset();
      onLogin();
    } catch {
      setError('通信に失敗しました。接続を確認して再試行してください。');
    } finally { setBusy(false); }
  }
  return <main className="login-page">
    <form className="login" onSubmit={submit} aria-busy={busy}>
      <div className="login-brand">Mikke<span className="brand-dot">.</span></div>
      <p className="eyebrow">INTERNAL CMDB / PLUS9.inc</p>
      <h1>管理コンソールにログイン</h1>
      <p className="muted">資産・依存関係・ソフトウェアのライフサイクルを管理します。</p>
      {expired && <ErrorState>セッションが無効になりました。再度ログインしてください。</ErrorState>}
      <label htmlFor="login-token">APIトークン</label>
      <div className="token-input">
        <input id="login-token" data-testid="login-input" name="token" type={visible ? 'text' : 'password'}
          required disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus
          aria-describedby="token-hint" aria-invalid={!!error} />
        <Button type="button" variant="ghost" disabled={busy} aria-controls="login-token" aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}>{visible ? '隠す' : '表示'}</Button>
      </div>
      <small id="token-hint">トークンはこのタブのセッションにのみ保存されます。</small>
      {error && <ErrorState data-testid="login-error">{error}</ErrorState>}
      <Button variant="primary" type="submit" data-testid="login-button" disabled={busy}>{busy ? 'ログイン中…' : 'ログイン'}</Button>
      {busy && <LoadingState>トークンを確認しています…</LoadingState>}
    </form>
  </main>;
}
