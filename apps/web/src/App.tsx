import { useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { clearToken, getToken, setToken } from './api';
import { ResourceList } from './pages/ResourceList';
import { ResourceDetail } from './pages/ResourceDetail';

export function App() {
  const [token, setTok] = useState(getToken());
  if (!token) return <Login onLogin={(t) => { setToken(t); setTok(t); }} />;
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Mikke</h1>
        <nav>
          <Link to="/resources">資産</Link>
        </nav>
        <button className="link" onClick={() => { clearToken(); setTok(null); }}>ログアウト</button>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/resources" replace />} />
          <Route path="/resources" element={<ResourceList />} />
          <Route path="/resources/:id" element={<ResourceDetail />} />
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
