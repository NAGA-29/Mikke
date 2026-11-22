import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { FormError } from '../components/FormError';
import type { Diagram } from '../lib/graph';

export function Diagrams() {
  const [items, setItems] = useState<Diagram[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Diagram | 'new' | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<Diagram | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    api<Diagram[]>(`/diagrams?limit=50&offset=${offset}`, { signal: controller.signal })
      .then((rows) => { if (!controller.signal.aborted) setItems(rows); })
      .catch((e) => { if (!controller.signal.aborted) setError(e); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, revision]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (!editing) return;
    setBusy(true); setError(null);
    try {
      await api(editing === 'new' ? '/diagrams' : `/diagrams/${editing.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH', json: { name: name.trim() },
      });
      setEditing(null); setRevision((n) => n + 1);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true); setError(null);
    try {
      await api(`/diagrams/${removing.id}`, { method: 'DELETE' });
      setRemoving(null); setRevision((n) => n + 1);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <section><div className="page-heading"><h2>構成図</h2>
    <button disabled={busy} onClick={() => { setEditing('new'); setName(''); setRemoving(null); }}>図を作成</button></div>
    <FormError error={error} />
    {editing && <form className="resource-form" onSubmit={save}><fieldset disabled={busy}>
      <legend>{editing === 'new' ? '図を作成' : '図の名前を変更'}</legend>
      <label>名前<input autoFocus required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-actions"><button disabled={!name.trim()}>保存</button><button type="button" onClick={() => setEditing(null)}>キャンセル</button></div>
    </fieldset></form>}
    {removing && <div className="canvas-confirm" role="region" aria-label="図の削除確認">
      <p>「{removing.name}」とこの図の配置・非表示設定を削除します。資産と正本の関係は保持されます。</p>
      <button disabled={busy} onClick={() => void remove()}>この図を削除</button>{' '}
      <button disabled={busy} onClick={() => setRemoving(null)}>キャンセル</button></div>}
    {loading ? <p role="status">読み込み中…</p> : <table><thead><tr><th>名前</th><th>操作</th></tr></thead><tbody>
      {items.map((d) => <tr key={d.id}><td><Link to={`/diagrams/${d.id}`}>{d.name}</Link></td><td>
        <button disabled={busy} onClick={() => { setEditing(d); setName(d.name); setRemoving(null); }}>名前を変更</button>{' '}
        <button disabled={busy} onClick={() => { setRemoving(d); setEditing(null); }}>図を削除</button></td></tr>)}
      {!items.length && <tr><td colSpan={2}>図はありません。</td></tr>}
    </tbody></table>}
    <div className="form-actions"><button disabled={busy || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>前へ</button>
      <span>{offset + 1}件目から</span><button disabled={busy || loading || items.length < 50} onClick={() => setOffset(offset + 50)}>次へ</button>
      <button disabled={busy || loading} onClick={() => setRevision((n) => n + 1)}>再読み込み</button></div>
  </section>;
}
