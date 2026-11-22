import { Button } from './ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { connectionCommand, EDGE_LABEL, suggestedConnectionKind, type EdgeKind, type GraphNode } from '../lib/graph';
import type { RelationType } from './referenceTypes';
import { ResourcePicker } from './ResourcePicker';
import { CanvasError } from './CanvasError';

export function ConnectionDialog({ source, target, onSaved, onClose }: {
  source: GraphNode; target: GraphNode; onSaved: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<EdgeKind>(suggestedConnectionKind(source.resource_type, target.resource_type));
  const [types, setTypes] = useState<RelationType[]>([]);
  const [relationType, setRelationType] = useState('');
  const [environment, setEnvironment] = useState('');
  const [purpose, setPurpose] = useState('source');
  const [repositoryId, setRepositoryId] = useState('');
  const [status, setStatus] = useState('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [host, setHost] = useState<string | null | undefined>(undefined);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null); setHost(undefined);
    if (kind === 'relation') {
      api<RelationType[]>('/relation-types', { signal: controller.signal }).then((rows) => {
        if (!controller.signal.aborted) setTypes(rows.filter((t) => t.is_active));
      }).catch((e) => { if (!controller.signal.aborted) setLoadError(e); });
    } else if (kind === 'hosting' && source.resource_type === 'service_instance') {
      // Keep only the non-secret field needed to describe the replacement.
      api<{ detail: { host_compute_id?: string | null } }>(`/resources/${source.resource_id}`, { signal: controller.signal }).then((row) => {
        if (!controller.signal.aborted) setHost(row.detail?.host_compute_id ?? null);
      }).catch((e) => { if (!controller.signal.aborted) setLoadError(e); });
    }
    return () => controller.abort();
  }, [kind, source.resource_id, source.resource_type, attempt]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const command = connectionCommand(kind, source.resource_id, target.resource_id, { relationType, environment, purpose, repositoryId, status });
      await api(command.path, command);
      onSaved();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="canvas-dialog" aria-labelledby="connection-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <form className="resource-form" onSubmit={submit}><h3 id="connection-title">正本の接続を作成</h3>
      <p>{source.name} → {target.name}</p><p>保存すると全図・MCPに反映されます。接続方向はこの順序です。</p>
      <fieldset disabled={busy}><legend>接続の種類と登録内容</legend>
        <label>種類<select value={kind} onChange={(e) => { setKind(e.target.value as EdgeKind); setError(null); }}>
          {(Object.keys(EDGE_LABEL) as EdgeKind[]).map((k) => <option key={k} value={k}>{EDGE_LABEL[k]} ({k})</option>)}
        </select></label>
        <p>種別・配置先の条件や権限はAPIが検証します。</p>
        {kind === 'relation' && <label>関係種別<select required value={relationType} onChange={(e) => setRelationType(e.target.value)}>
          <option value="">選択してください</option>{types.map((t) => <option key={t.code} value={t.code}>{t.label} ({t.code})</option>)}
        </select></label>}
        {kind === 'deployment' && <>
          <label>環境（必須）<input required maxLength={32} pattern="[a-z][a-z0-9_-]{0,31}" placeholder="prod / stg / dev" value={environment} onChange={(e) => setEnvironment(e.target.value)} /></label>
          <label>状態<select value={status} onChange={(e) => setStatus(e.target.value)}><option>active</option><option>inactive</option></select></label>
          <ResourcePicker label="使用Repo（先にアプリとのリンクが必要）" optional types={['repository']} value={repositoryId} onChange={setRepositoryId} />
          <p>登録後の詳細なデプロイ情報は資産詳細画面から編集できます。</p>
        </>}
        {kind === 'app_repository' && <label>用途<select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {['source', 'config', 'infra', 'other'].map((v) => <option key={v}>{v}</option>)}
        </select></label>}
        {kind === 'hosting' && <p>サービスの host_compute_id を更新します。{host ? `現在のホスト（${host}）を置き換えます。` : 'ホストは1台のみ指定できます。'}</p>}
        <CanvasError error={loadError} />{!!loadError && <Button type="button" onClick={() => setAttempt((n) => n + 1)}>取得を再試行</Button>}
        <CanvasError error={error} />
        <div className="form-actions"><Button variant="primary" data-testid="dialog-confirm" disabled={!!loadError || (kind === 'hosting' && source.resource_type === 'service_instance' && host === undefined)}>接続を保存</Button>
          <Button data-testid="dialog-cancel" type="button" onClick={onClose}>キャンセル</Button></div>
      </fieldset>
    </form>
  </dialog>;
}
