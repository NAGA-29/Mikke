import { Button, ErrorState } from './ui';
import { useEffect, useId, useState } from 'react';
import { FormError } from './FormError';
import { api, RESOURCE_TYPE_LABEL, type Resource, type ResourceType } from '../api';

const PAGE_SIZE = 50;

export function ResourcePicker({ label, value, onChange, types, hostingOnly = false, excludeId, optional = false, currentLabel, testId, descriptionId }: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  types?: ResourceType[];
  hostingOnly?: boolean;
  excludeId?: string;
  optional?: boolean;
  currentLabel?: string;
  testId?: string;
  descriptionId?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [lookupError, setLookupError] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSelected(null); setLookupError(null);
    if (value && !currentLabel) api<Resource>(`/resources/${value}`, { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) setSelected(r); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setLookupError(e); });
    return () => controller.abort();
  }, [value, currentLabel]);
  const typeKey = types?.join(',') ?? '';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ q: query, include_archived: 'false', limit: String(PAGE_SIZE), offset: String(offset) });
      // 複数種別はAPIに配列フィルタがないため、このページの結果から絞る。
      if (typeKey && !typeKey.includes(',')) qs.set('type', typeKey);
      api<{ items: Resource[] }>(`/resources?${qs}`, { signal: controller.signal })
        .then(({ items: rows }) => {
          if (controller.signal.aborted) return;
          setItems(rows.filter((r) => !r.archived_at && r.id !== excludeId
            && (!typeKey || typeKey.split(',').includes(r.resource_type))
            && (!hostingOnly || r.resource_type === 'compute' || r.detail?.service_kind === 'hosting')));
          setHasMore(rows.length === PAGE_SIZE);
          setLoading(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) { setError('資産検索に失敗しました。検索条件を変更して再試行してください。'); setLoading(false); }
        });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, offset, typeKey, hostingOnly, excludeId]);

  return <div className="resource-picker" data-testid={testId}>
    <label htmlFor={`${id}-search`}>{label}：名前で検索</label>
    <input id={`${id}-search`} aria-describedby={descriptionId} data-testid={testId ? `${testId}-search` : undefined} type="search" maxLength={255} autoComplete="off" value={query}
      onChange={(e) => { setQuery(e.target.value); setOffset(0); }} />
    <label htmlFor={`${id}-select`}>{label}{!optional && '（必須）'}</label>
    <select id={`${id}-select`} aria-describedby={descriptionId} data-testid={testId ? `${testId}-select` : undefined} value={value} required={!optional} onChange={(e) => onChange(e.target.value)}>
      <option value="">{optional ? '指定なし' : '選択してください'}</option>
      {value && (loading || !items.some((r) => r.id === value)) && <option value={value}>{currentLabel ?? (selected?.id === value ? selected.name : lookupError ? '名前を取得できません' : '名前を読み込み中…')}（選択中）</option>}
      {!loading && items.map((r) => <option key={r.id} value={r.id}>{r.name} / {RESOURCE_TYPE_LABEL[r.resource_type]} / {r.environment ?? '-'} / {r.id}</option>)}
    </select>
    {loading && <small role="status">検索中…</small>}
    {!loading && !items.length && !error && <small>このページに候補はありません。</small>}
    <FormError error={lookupError} scope="mikke:read" />
    {error && <ErrorState>{error}</ErrorState>}
    <div className="form-actions">
      <Button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>前の候補</Button>
      <span>{offset + 1}件目から</span>
      <Button type="button" disabled={loading || !hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>次の候補</Button>
    </div>
  </div>;
}
