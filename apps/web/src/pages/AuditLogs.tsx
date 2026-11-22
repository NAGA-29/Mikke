import { Button, DataTable, EmptyState, LoadingState, PageHeader, Time } from '../components/ui';
import { auditActionLabel, auditEntityLabel } from '../lib/labels';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FormError } from '../components/FormError';
import { TextField, useApiData } from '../components/SoftwareFields';

interface AuditEntry { id: string; created_at: string; actor_id: string; action: string; entity_type: string; entity_id: string }

export function AuditLogs() {
  const [sp, setSp] = useSearchParams();
  const [revision, setRevision] = useState(0);
  // Only metadata is rendered; arbitrary before_data / after_data is never printed.
  const { data, error } = useApiData<AuditEntry[]>(`/audit-logs?${sp}`, revision);
  const [fields, setFields] = useState({ entity_type: sp.get('entity_type') ?? '', entity_id: sp.get('entity_id') ?? '',
    actor_id: sp.get('actor_id') ?? '', limit: sp.get('limit') ?? '100' });
  return <section><PageHeader title="監査ログ" /><p>実行日時・主体・操作・対象を表示します。変更前後の任意データは表示しません。新しい順で最大500件まで取得できます。</p>
    <form className="filters" onSubmit={(e) => {
      e.preventDefault(); setSp(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ''))); setRevision((n) => n + 1);
    }}>
      <TextField label="対象種別（例: resource）" maxLength={100} value={fields.entity_type} onChange={(v) => setFields({ ...fields, entity_type: v })} />
      <TextField label="対象ID（UUID）" maxLength={36} value={fields.entity_id} onChange={(v) => setFields({ ...fields, entity_id: v })} />
      <TextField label="実行主体" value={fields.actor_id} onChange={(v) => setFields({ ...fields, actor_id: v })} />
      <label>取得件数<input type="number" min={1} max={500} required value={fields.limit} onChange={(e) => setFields({ ...fields, limit: e.target.value })} /></label>
      <Button variant="primary" data-testid="form-submit">検索・再読み込み</Button>
    </form>
    <FormError error={error} scope="mikke:read" />{!data && !error && <LoadingState />}
    {data && <><p>{data.length}件{data.length === Number(sp.get('limit') ?? 100) && '（上限に達しています。対象や主体で絞り込んでください）'}</p>
      <div className="reference-table"><DataTable aria-label="監査ログ一覧"><thead><tr><th scope="col">日時</th><th scope="col">実行主体</th><th scope="col">操作</th><th scope="col">対象種別</th><th scope="col">対象ID</th><th scope="col">監査ID</th></tr></thead><tbody>
        {data.map((r) => <tr key={r.id}><td><Time value={r.created_at} /></td><td>{r.actor_id}</td><td>{auditActionLabel(r.action)}</td><td>{auditEntityLabel(r.entity_type)}</td><td>{r.entity_id}</td><td>{r.id}</td></tr>)}
        {!data.length && <tr><td colSpan={6}><EmptyState>該当なし</EmptyState></td></tr>}
      </tbody></DataTable></div>
    </>}
  </section>;
}
