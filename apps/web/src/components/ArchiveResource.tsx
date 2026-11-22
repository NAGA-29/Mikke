import { useState } from 'react';
import { api, type Resource } from '../api';
import { FormError } from './FormError';
import { ResourceReferences } from './ResourceReferences';

export function ArchiveResource({ resource, onSaved }: { resource: Resource; onSaved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const action = resource.archived_at ? 'restore' : 'archive';
  const label = resource.archived_at ? '復元' : 'アーカイブ';
  return <section><h3>管理者操作</h3><p>mikke:admin が必要です。</p>
    {!confirming ? <button onClick={() => { setReady(false); setError(null); setConfirming(true); }}>{label}の参照確認</button> : <>
      <h4>{resource.name} の{label}前の参照一覧</h4>
      <ResourceReferences resource={resource} readOnly onReadyChange={setReady} />
      <form className="resource-form" onSubmit={async (e) => {
        e.preventDefault(); if (!ready || saving) return; setSaving(true); setError(null);
        try { await api(`/resources/${resource.id}/${action}`, { method: 'POST' }); setConfirming(false); onSaved(); }
        catch (e) { setError(e); } finally { setSaving(false); }
      }}><fieldset disabled={saving}><legend>{label}を確定</legend>
        <p>関連レコードと監査履歴は保持されます。アーカイブした資産は通常のEOL集計から除外されます。</p>
        <FormError error={error} scope="mikke:admin" />
        <label><input key={String(ready)} type="checkbox" disabled={!ready} required />上記の参照一覧を確認しました</label>
        <div className="form-actions"><button disabled={!ready}>{saving ? '処理中…' : `${label}を実行`}</button>
          <button type="button" onClick={() => setConfirming(false)}>キャンセル</button></div>
      </fieldset></form>
    </>}
  </section>;
}
