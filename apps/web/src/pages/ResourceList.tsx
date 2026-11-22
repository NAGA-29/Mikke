import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, RESOURCE_TYPE_LABEL, type Resource, type ResourceType } from '../api';

export function ResourceList() {
  const [sp, setSp] = useSearchParams();
  const [items, setItems] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = sp.toString();

  useEffect(() => {
    let live = true;
    setItems(null);
    setError(null);
    api<{ items: Resource[] }>(`/resources?${qs}`)
      .then((r) => live && setItems(r.items))
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [qs]);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    n.delete('offset');
    setSp(n, { replace: true });
  };

  return (
    <section>
      <div className="page-heading"><h2>資産</h2><Link to="/resources/new">新規登録</Link></div>
      <div className="filters">
        <input placeholder="名前で検索" defaultValue={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} />
        <select value={sp.get('type') ?? ''} onChange={(e) => set('type', e.target.value)}>
          <option value="">種別: すべて</option>
          {(Object.keys(RESOURCE_TYPE_LABEL) as ResourceType[]).map((t) => (
            <option key={t} value={t}>{RESOURCE_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <input placeholder="環境" defaultValue={sp.get('environment') ?? ''} onChange={(e) => set('environment', e.target.value)} />
        <label>
          <input type="checkbox" checked={sp.get('include_archived') === 'true'} onChange={(e) => set('include_archived', e.target.checked ? 'true' : '')} />
          アーカイブを含む
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!items && !error && <p>読み込み中…</p>}
      {items && (
        <table>
          <thead><tr><th>名前</th><th>種別</th><th>環境</th><th>状態</th><th>更新</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className={r.archived_at ? 'archived' : ''}>
                <td><Link to={`/resources/${r.id}`}>{r.name}</Link></td>
                <td>{RESOURCE_TYPE_LABEL[r.resource_type]}</td>
                <td>{r.environment ?? '-'}</td>
                <td>{r.archived_at ? 'アーカイブ' : r.lifecycle_status}</td>
                <td>{r.updated_at.slice(0, 10)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5}>該当なし</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
