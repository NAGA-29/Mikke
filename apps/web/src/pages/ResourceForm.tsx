import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, RESOURCE_TYPE_LABEL, type Resource, type ResourceType } from '../api';

type Field = { name: string; label: string; max?: number; required?: boolean; options?: string[]; kind?: 'attributes' | 'boolean'; hint?: string };
// 入力項目の正本: apps/api/src/services/resources.ts の各 detail スキーマ。
const fields: Record<ResourceType, Field[]> = {
  compute: [
    { name: 'asset_kind', label: '資産種別', required: true, options: ['vps', 'vm', 'ec2', 'baremetal', 'container_host'] },
    { name: 'hostname', label: 'ホスト名', max: 255 },
    { name: 'display_alias', label: '管理用別名', max: 255 },
    { name: 'provider', label: 'プロバイダー', max: 100 },
    { name: 'region', label: 'リージョン / DC', max: 100 },
    { name: 'os_name', label: 'OS名', max: 100 },
    { name: 'os_version', label: 'OSバージョン', max: 100 },
    { name: 'os_software_product_id', label: 'OS製品ID', hint: 'ソフトウェア製品のUUID' },
    { name: 'architecture', label: 'アーキテクチャ', max: 32 },
    { name: 'public_ip', label: '公開IP', hint: 'IPv4 / IPv6' },
    { name: 'private_ip', label: '内部IP', hint: 'IPv4 / IPv6' },
    { name: 'attributes', label: '属性（JSONオブジェクト）', kind: 'attributes' },
  ],
  application: [
    { name: 'framework', label: 'フレームワーク', max: 100 },
    { name: 'framework_version', label: 'フレームワークバージョン', max: 100 },
    { name: 'runtime', label: 'ランタイム', max: 100 },
    { name: 'runtime_requirement', label: '要求バージョン範囲', max: 100 },
    { name: 'build_tool', label: 'ビルドツール', max: 100 },
    { name: 'attributes', label: '属性（JSONオブジェクト）', kind: 'attributes' },
  ],
  service_instance: [
    { name: 'service_kind', label: 'サービス種別', required: true, options: ['database', 'cache', 'queue', 'storage', 'hosting', 'other'] },
    { name: 'engine', label: 'エンジン', max: 100 },
    { name: 'engine_version', label: 'エンジンバージョン', max: 100 },
    { name: 'software_product_id', label: 'ソフトウェア製品ID', hint: 'ソフトウェア製品のUUID' },
    { name: 'provider', label: 'プロバイダー', max: 100 },
    { name: 'is_managed', label: 'マネージドサービス', kind: 'boolean' },
    { name: 'host_compute_id', label: 'ホストCompute ID', hint: 'アーカイブされていないコンピュート資産のUUID' },
    { name: 'endpoint', label: 'エンドポイント', max: 1024 },
    { name: 'attributes', label: '属性（JSONオブジェクト）', kind: 'attributes' },
  ],
  repository: [
    { name: 'provider', label: 'プロバイダー', max: 50 },
    { name: 'repository_url', label: 'リポジトリURL', max: 2048, required: true, hint: 'HTTPS / HTTP / SSH / Git URL または git@host:owner/repo.git' },
    { name: 'default_branch', label: '既定ブランチ', max: 255 },
  ],
};

const secretKey = /pass(word|wd)?|secret|token|private[_-]?key|api[_-]?key|credential|auth/i;
function hasSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretKey);
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, v]) => secretKey.test(key) || hasSecretKey(v));
}
function hasUrlCredentials(value: string, repository: boolean): boolean {
  const query = value.indexOf('?');
  if (query >= 0 && [...new URLSearchParams(value.slice(query + 1).split('#')[0]).keys()]
    .some((key) => /pass(word|wd)?|pwd|secret|token|key|credential|auth|sig(nature)?/i.test(key))) return true;
  if (!repository) return /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(value);
  try {
    const url = new URL(value);
    return !!url.password || (!!url.username && url.protocol.startsWith('http'));
  } catch { return false; } // scp形式など、URLの妥当性・正規化はAPIが判定する。
}

export function ResourceForm() {
  const { id } = useParams();
  const [resource, setResource] = useState<Resource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setResource(null);
    setLoadError(null);
    if (id) api<Resource>(`/resources/${id}`)
      .then((r) => { if (live) setResource(r); })
      .catch((e: Error) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [id]);
  if (loadError) return <p role="alert" className="error">{loadError}</p>;
  if (id && (!resource || resource.id !== id)) return <p>読み込み中…</p>;
  if (resource?.archived_at) return <section><p role="alert">アーカイブ済み資産は編集できません。</p><Link to={`/resources/${id}`}>詳細へ戻る</Link></section>;
  return <Editor key={id ?? 'new'} resource={resource} />;
}

function Editor({ resource }: { resource: Resource | null }) {
  const navigate = useNavigate();
  const [type, setType] = useState<ResourceType>(resource?.resource_type ?? 'compute');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; issues?: { path: string; message: string }[] } | null>(null);
  const cancelPath = resource ? `/resources/${resource.id}` : '/resources';

  // 入力値はDOMだけに置き、ストレージ・URL・ログには保存しない。
  function checkSensitive(input: HTMLInputElement | HTMLTextAreaElement): boolean {
    let unsafe = false;
    if (input.name === 'attributes') {
      try { unsafe = hasSecretKey(JSON.parse(input.value)); } catch { /* JSONの構文は送信時に検証 */ }
    } else if (input.name === 'endpoint' || input.name === 'repository_url') {
      unsafe = hasUrlCredentials(input.value.trim(), input.name === 'repository_url');
    }
    if (unsafe) {
      input.value = '';
      input.setCustomValidity('認証情報を含まない値を入力してください。');
      setError({ message: '認証情報らしい入力を消去しました。URLに認証情報・認証クエリを含めず、属性に秘密情報のキーを指定しないでください。' });
    } else input.setCustomValidity('');
    return !unsafe;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || resource?.archived_at) return;
    const form = event.currentTarget;
    setError(null);
    let safe = true;
    for (const input of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      if (!checkSensitive(input)) safe = false;
    }
    if (!safe) return;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const detail: Record<string, unknown> = {};
    for (const field of fields[type]) {
      if (field.kind === 'attributes') {
        try {
          const value: unknown = JSON.parse(text(field.name) || '{}');
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          detail[field.name] = value;
        } catch {
          const input = form.elements.namedItem(field.name);
          if (input instanceof HTMLTextAreaElement) input.value = '';
          setError({ message: '属性はJSONオブジェクトで入力してください。' });
          return;
        }
      } else if (field.kind === 'boolean') detail[field.name] = data.has(field.name);
      else detail[field.name] = text(field.name) || (field.required ? '' : null);
    }
    const body = {
      ...(!resource && { resource_type: type }),
      name: text('name'),
      description: String(data.get('description') ?? '') || null,
      environment: text('environment') || null,
      lifecycle_status: text('lifecycle_status'),
      last_verified_at: text('last_verified_at') || null,
      detail,
    };
    setSaving(true);
    try {
      const saved = await api<Resource>(resource ? `/resources/${resource.id}` : '/resources', {
        method: resource ? 'PATCH' : 'POST', json: body,
      });
      navigate(`/resources/${saved.id}`);
    } catch (e) {
      // APIが入力値を含める可能性があるメッセージは表示しない。
      if (e instanceof ApiError) {
        const issues = Array.isArray(e.details) ? e.details.flatMap((issue: unknown) => {
          if (!issue || typeof issue !== 'object' || !('path' in issue) || !('message' in issue)) return [];
          const path = String(issue.path);
          return [{ path, message: /attributes|endpoint|repository_url/.test(path) ? '入力値の形式を確認してください。' : String(issue.message) }];
        }) : undefined;
        setError({ message: `${e.status} ${e.code}: ${e.code === 'invalid_repository_url' ? 'リポジトリURLを確認してください。' : e.message}`, issues });
      } else setError({ message: '通信に失敗しました。接続を確認して再試行してください。' });
    } finally { setSaving(false); }
  }

  return <section>
    <p><Link to={cancelPath}>← {resource ? '詳細' : '一覧'}</Link></p>
    <h2>{resource ? '資産の編集' : '新規登録'}</h2>
    <p>必須項目は * で表示しています。認証情報や秘密情報は入力しないでください。</p>
    <form className="resource-form" autoComplete="off" onSubmit={submit}>
      <fieldset disabled={saving}>
        <legend>共通項目</legend>
        <label>種別 *<select value={type} disabled={!!resource} onChange={(e) => { setType(e.target.value as ResourceType); setError(null); }}>
          {(Object.keys(RESOURCE_TYPE_LABEL) as ResourceType[]).map((t) => <option key={t} value={t}>{RESOURCE_TYPE_LABEL[t]}</option>)}
        </select></label>
        <label>名前 *<input name="name" required maxLength={255} defaultValue={resource?.name ?? ''} /></label>
        <label>説明<textarea name="description" maxLength={10000} rows={3} defaultValue={resource?.description ?? ''} /></label>
        <label>環境<input name="environment" maxLength={32} pattern="[a-z][a-z0-9_\-]{0,31}" placeholder="prod / stg / dev" defaultValue={resource?.environment ?? ''} /></label>
        <label>状態 *<select name="lifecycle_status" defaultValue={resource?.lifecycle_status ?? 'active'}>
          {['active', 'maintenance', 'retired'].map((v) => <option key={v} value={v}>{v}</option>)}
        </select></label>
        <label>最終確認日時<input name="last_verified_at" placeholder="2026-11-22T09:00:00+09:00" defaultValue={resource?.last_verified_at ?? ''} /><small>タイムゾーン付きISO 8601形式。空欄は未確認。</small></label>
      </fieldset>
      <fieldset key={type} disabled={saving}>
        <legend>{RESOURCE_TYPE_LABEL[type]}の詳細</legend>
        {fields[type].map((field) => {
          const value = resource?.detail?.[field.name];
          return <label key={field.name}>{field.label}{field.required && ' *'}
            {field.kind === 'boolean' ? <input type="checkbox" name={field.name} defaultChecked={value === true} />
              : field.options ? <select name={field.name} required={field.required} defaultValue={typeof value === 'string' ? value : ''}>
                <option value="">選択してください</option>
                {field.options.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              : field.kind === 'attributes' ? <textarea name={field.name} rows={5} defaultValue={JSON.stringify(value ?? {}, null, 2)} onChange={(e) => checkSensitive(e.currentTarget)} />
              : <input name={field.name} maxLength={field.max} required={field.required} defaultValue={typeof value === 'string' ? value : ''} onChange={(e) => checkSensitive(e.currentTarget)} />}
            {field.hint && <small>{field.hint}</small>}
          </label>;
        })}
      </fieldset>
      {error && <div className="error" role="alert" tabIndex={-1}>
        <p>{error.message}</p>
        {!!error.issues?.length && <ul>{error.issues.map((issue, i) => <li key={i}>{issue.path || '入力'}: {issue.message}</li>)}</ul>}
      </div>}
      <p className="form-actions"><button type="submit" disabled={saving}>{saving ? '保存中…' : resource ? '変更を保存' : '登録'}</button><Link to={cancelPath}>キャンセル</Link></p>
    </form>
  </section>;
}
