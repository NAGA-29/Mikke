import { Button, DataTable, EmptyState, LoadingState, PageHeader } from '../components/ui';
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
  return <section><PageHeader title="構成図" actions={<Button variant="primary" data-testid="create-diagram" disabled={busy} onClick={() => { setEditing('new'); setName(''); setRemoving(null); }}>図を作成</Button>} />
    <FormError error={error} />
    {editing && <form className="resource-form" onSubmit={save}><fieldset disabled={busy}>
      <legend>{editing === 'new' ? '図を作成' : '図の名前を変更'}</legend>
      <label>名前<input autoFocus required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-actions"><Button variant="primary" data-testid="form-submit" disabled={!name.trim()}>保存</Button><Button data-testid="dialog-cancel" type="button" onClick={() => setEditing(null)}>キャンセル</Button></div>
    </fieldset></form>}
    {removing && <div className="canvas-confirm" role="region" aria-label="図の削除確認">
      <p>「{removing.name}」とこの図の配置・非表示設定を削除します。資産と正本の関係は保持されます。</p>
      <Button variant="danger" data-testid="dialog-confirm" disabled={busy} onClick={() => void remove()}>この図を削除</Button>{' '}
      <Button data-testid="dialog-cancel" disabled={busy} onClick={() => setRemoving(null)}>キャンセル</Button></div>}
    {loading ? <LoadingState /> : <DataTable aria-label="構成図一覧"><thead><tr><th scope="col">名前</th><th scope="col">操作</th></tr></thead><tbody>
      {items.map((d) => <tr key={d.id}><td><Link to={`/diagrams/${d.id}`}>{d.name}</Link></td><td>
        <Button disabled={busy} onClick={() => { setEditing(d); setName(d.name); setRemoving(null); }}>名前を変更</Button>{' '}
        <Button variant="danger" disabled={busy} onClick={() => { setRemoving(d); setEditing(null); }}>図を削除</Button></td></tr>)}
      {!items.length && <tr><td colSpan={2}><EmptyState>図はありません。</EmptyState></td></tr>}
    </tbody></DataTable>}
    <div className="form-actions"><Button disabled={busy || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>前へ</Button>
      <span>{offset + 1}件目から</span><Button disabled={busy || loading || items.length < 50} onClick={() => setOffset(offset + 50)}>次へ</Button>
      <Button disabled={busy || loading} onClick={() => setRevision((n) => n + 1)}>再読み込み</Button></div>
  </section>;
}
