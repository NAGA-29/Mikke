import { Badge, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, SummaryCard, Time } from '../components/ui';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, RESOURCE_TYPE_LABEL, type Resource, type ResourceType } from '../api';

type Summary = { by_type: Record<ResourceType, { active: number; archived: number }>; total: { active: number; archived: number } };

export function ResourceList() {
  const [sp, setSp] = useSearchParams();
  const [items, setItems] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = sp.toString();
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    let live = true;
    api<Summary>('/resources/summary').then((s) => live && setSummary(s)).catch(() => live && setSummary(null));
    return () => { live = false; };
  }, []);
  const typeFilter = sp.get('type');

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
      <PageHeader title="資産" actions={<Link className="button button-primary" data-testid="create-resource" to="/resources/new">新規登録</Link>} />
      <div className="summary" role="group" aria-label="種別ごとの件数（クリックで絞り込み）">
        <SummaryCard testId="summary-all" label="すべて" count={summary?.total.active ?? null} active={!typeFilter} onClick={() => set('type', '')} />
        {(Object.keys(RESOURCE_TYPE_LABEL) as ResourceType[]).map((t) =>
          <SummaryCard key={t} testId={`summary-${t}`} label={RESOURCE_TYPE_LABEL[t]} count={summary?.by_type[t].active ?? null}
            active={typeFilter === t} onClick={() => set('type', typeFilter === t ? '' : t)} />)}
        <SummaryCard testId="summary-archived" label="アーカイブ済み" count={summary?.total.archived ?? null}
          active={sp.get('include_archived') === 'true'} onClick={() => set('include_archived', sp.get('include_archived') === 'true' ? '' : 'true')} />
      </div>
      <div className="filters">
        <input aria-label="名前で検索" placeholder="名前で検索" defaultValue={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} />
        <select aria-label="資産種別" value={sp.get('type') ?? ''} onChange={(e) => set('type', e.target.value)}>
          <option value="">種別: すべて</option>
          {(Object.keys(RESOURCE_TYPE_LABEL) as ResourceType[]).map((t) => (
            <option key={t} value={t}>{RESOURCE_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <input aria-label="環境" placeholder="環境" defaultValue={sp.get('environment') ?? ''} onChange={(e) => set('environment', e.target.value)} />
        <label>
          <input type="checkbox" checked={sp.get('include_archived') === 'true'} onChange={(e) => set('include_archived', e.target.checked ? 'true' : '')} />
          アーカイブを含む
        </label>
      </div>
      {error && <ErrorState>{error}</ErrorState>}
      {!items && !error && <LoadingState />}
      {items && (
        <DataTable aria-label="資産一覧">
          <thead><tr><th scope="col">名前</th><th scope="col">種別</th><th scope="col">環境</th><th scope="col">状態</th><th scope="col">更新</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className={r.archived_at ? 'archived' : ''}>
                <td><Link to={`/resources/${r.id}`}>{r.name}</Link></td>
                <td>{RESOURCE_TYPE_LABEL[r.resource_type]}</td>
                <td>{r.environment ?? '-'}</td>
                <td><Badge status={r.archived_at ? 'archived' : r.lifecycle_status} /></td>
                <td><Time value={r.updated_at} /></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5}><EmptyState>該当なし</EmptyState></td></tr>}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}
