import { useState } from 'react';
import { api, type Resource } from '../api';
import { Modal, Button } from './ui';
import { FormError } from './FormError';
import { ResourcePicker } from './ResourcePicker';

export type HostingSelection = { kind: 'host'; hostId: string; hostName?: string }
  | { kind: 'add-service' }
  | { kind: 'unset-service'; serviceId: string; serviceName: string };

export function HostingEditor({ resource, selection, onSaved, onCancel }: {
  resource: Resource; selection: HostingSelection; onSaved: () => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(selection.kind === 'host' ? selection.hostId : '');
  const [confirming, setConfirming] = useState(selection.kind === 'unset-service');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const title = selection.kind === 'host' ? 'ホスト先を設定/変更/解除'
    : selection.kind === 'add-service' ? 'サービスを追加' : 'ホスト先の解除';
  return <Modal title={title} size="md" busy={saving} onClose={onCancel}><form className="resource-form reference-editor" data-testid="hosting-editor" onSubmit={async (e) => {
    e.preventDefault();
    if (!confirming) { setConfirming(true); return; }
    if (saving || resource.archived_at) return;
    setSaving(true); setError(null);
    const serviceId = selection.kind === 'host' ? resource.id
      : selection.kind === 'unset-service' ? selection.serviceId : value;
    const hostId = selection.kind === 'host' ? value || null
      : selection.kind === 'add-service' ? resource.id : null;
    try {
      await api(`/resources/${serviceId}`, { method: 'PATCH', json: { detail: { host_compute_id: hostId } } });
      onSaved();
    } catch (e) { setError(e); } finally { setSaving(false); }
  }}><fieldset disabled={saving}>
    <legend>{title}</legend>
    {selection.kind === 'add-service' && <p>選択したサービスに既存のホスト先がある場合、このコンピュートに上書きします。</p>}
    {selection.kind === 'unset-service' && <p>{selection.serviceName}のホスト先を解除します。</p>}
    <fieldset disabled={confirming} aria-label="ホスト先の選択">
      {selection.kind === 'host' && <ResourcePicker label="ホスト先" optional types={['compute']} value={value}
        onChange={setValue} currentLabel={value === selection.hostId ? selection.hostName : undefined} testId="hosting-host" />}
      {selection.kind === 'add-service' && <ResourcePicker label="サービス" types={['service_instance']} value={value}
        onChange={setValue} testId="hosting-service" />}
    </fieldset>
    {confirming && <p role="status">このホスト先の変更を保存します。すべての図にも反映されます。</p>}
    <FormError error={error} />
    <div className="form-actions">
      <Button type="submit" variant="primary" data-testid={confirming ? 'hosting-confirm' : 'hosting-review'}
        disabled={selection.kind === 'add-service' && !value}>{saving ? '保存中…' : confirming ? '変更を確定' : '変更内容を確認'}</Button>
      {confirming && selection.kind !== 'unset-service' && <Button type="button" data-testid="hosting-back" onClick={() => { setConfirming(false); setError(null); }}>選択に戻る</Button>}
      <Button type="button" data-testid="hosting-cancel" onClick={onCancel}>キャンセル</Button>
    </div>
  </fieldset></form></Modal>;
}
