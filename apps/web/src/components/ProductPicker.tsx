import { useEffect, useId, useState } from 'react';
import { Button } from './ui';
import { api } from '../api';
import { FormError } from './FormError';
import { type Product, useApiData } from './SoftwareFields';

export function ProductPicker({ label, value, onChange, testId, descriptionId }: {
  label: string; value: string; onChange: (id: string) => void; testId: string; descriptionId?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [lookupError, setLookupError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const { data, error } = useApiData<Product[]>(`/software/products?${new URLSearchParams({ q: search })}`, attempt);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setSelected(null); setLookupError(null);
    if (value) api<Product>(`/software/products/${value}`, { signal: controller.signal })
      .then((product) => { if (!controller.signal.aborted) setSelected(product); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setLookupError(e); });
    return () => controller.abort();
  }, [value, attempt]);
  return <div className="resource-picker" data-testid={testId}>
    <label htmlFor={`${id}-search`}>{label}：名前で検索</label>
    <input id={`${id}-search`} aria-describedby={descriptionId} data-testid={`${testId}-search`} type="search" maxLength={255} autoComplete="off"
      value={query} onChange={(e) => setQuery(e.target.value)} />
    <label htmlFor={`${id}-select`}>{label}</label>
    <select id={`${id}-select`} aria-describedby={descriptionId} data-testid={`${testId}-select`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">指定なし</option>
      {value && !data?.some((p) => p.id === value) && <option value={value}>{selected?.id === value ? selected.name : lookupError ? '製品名を取得できません' : '製品名を読み込み中…'}（選択中）</option>}
      {data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.vendor ? ` / ${p.vendor}` : ''}</option>)}
    </select>
    {!data && !error && <small role="status">検索中…</small>}
    <FormError error={error ?? lookupError} scope="mikke:read" />
    {!!(error || lookupError) && <Button type="button" data-testid={`${testId}-retry`} onClick={() => setAttempt((n) => n + 1)}>再試行</Button>}
  </div>;
}
