import { Button } from './ui';
import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { FormError } from './FormError';

export interface Product { id: string; name: string; vendor: string | null; category: string | null }
export interface LifecycleEvent {
  id: string; release_cycle_id: string; event_type: string; event_date: string;
  source_url: string; source_title: string | null; checked_at: string; notes: string | null; updated_at: string;
}
export interface ReleaseCycle {
  id: string; software_product_id: string; product_name: string; cycle: string; match_pattern: string | null;
  verification_status: string; verified_at: string | null; verified_by: string | null;
  notes: string | null; updated_at: string; events: LifecycleEvent[]; in_service_assignments: number;
}

// Clear old results during loading; abort superseded requests and never display server payload errors.
export function useApiData<T>(path: string, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null);
    api<T>(path, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setData(value);
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error };
}

export function ProductSelect({ value, onChange, optional = false, disabled = false }: {
  value: string; onChange: (value: string) => void; optional?: boolean; disabled?: boolean;
}) {
  const { data, error } = useApiData<Product[]>('/software/products');
  return <><label>製品<select required={!optional} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{optional ? 'すべて' : '選択してください'}</option>
    {value && !data?.some((p) => p.id === value) && <option value={value}>{value}（選択中）</option>}
    {data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.vendor ? ` / ${p.vendor}` : ''}</option>)}
  </select></label><FormError error={error} scope="mikke:read" /></>;
}

export function urlHasCredentials(value: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(value)) return true;
  const query = value.indexOf('?');
  return query >= 0 && [...new URLSearchParams(value.slice(query + 1).split('#')[0]).keys()]
    .some((key) => /pass(word|wd)?|pwd|secret|token|key|credential|auth|sig(nature)?/i.test(key));
}

export function displaySourceUrl(value: string | null | undefined) {
  return value && urlHasCredentials(value) ? '認証情報を含むURLは表示できません' : value ?? '-';
}

export function TextField({ label, value, onChange, required = false, maxLength = 255, type = 'text', credentialFreeUrl = false }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; maxLength?: number; type?: string; credentialFreeUrl?: boolean;
}) {
  const [unsafe, setUnsafe] = useState(false);
  const errorId = useId();
  return <label>{label}<input aria-invalid={unsafe} aria-describedby={unsafe ? errorId : undefined} type={type} value={value} required={required} maxLength={maxLength}
    autoComplete="off" onChange={(e) => {
      const invalid = credentialFreeUrl && urlHasCredentials(e.target.value.trim());
      setUnsafe(invalid);
      if (invalid) { e.currentTarget.value = ''; onChange(''); }
      else onChange(e.target.value);
    }} />{unsafe && <small id={errorId} className="error" role="alert">認証情報らしい入力を消去しました。URLに認証情報・認証クエリを含めないでください。</small>}</label>;
}

export function ReleaseCycleAssignment({ path, productId, currentId, onSaved }: {
  path: string; productId: string | null; currentId: string | null; onSaved: () => void;
}) {
  const { data: cycles, error: loadError } = useApiData<ReleaseCycle[]>(`/software/release-cycles${productId ? `?software_product_id=${productId}` : ''}`);
  const [cycleId, setCycleId] = useState(currentId ?? '');
  const [allow, setAllow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <form className="resource-form" onSubmit={async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      await api(path, { method: 'PUT', json: { release_cycle_id: cycleId || null, allow_version_mismatch: allow } });
      onSaved();
    } catch (e) { setError(e); } finally { setSaving(false); }
  }}><fieldset disabled={saving}>
    <legend>リリース系列の割当・解除</legend>
    {!productId && <p>割当には、先に資産編集で製品を設定してください。</p>}
    <FormError error={loadError} scope="mikke:read" /><FormError error={error} />
    <label>リリース系列<select value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
      <option value="">割当なし（解除）</option>
      {cycleId && !cycles?.some((c) => c.id === cycleId) && <option value={cycleId}>{cycleId}（現在の割当）</option>}
      {productId && cycles?.map((c) => <option key={c.id} value={c.id}>{c.cycle} / {c.verification_status}</option>)}
    </select></label>
    <label><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />バージョン不一致を確認のうえ許可する（EOL判定は不明になります）</label>
    <Button variant="primary" data-testid="form-submit" disabled={!cycles || !!loadError || (!!cycleId && !productId)}>割当を保存</Button>
  </fieldset></form>;
}
