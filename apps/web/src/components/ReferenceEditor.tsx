import { Button, ErrorState, DateTimeField } from './ui';
import { deploymentStatusLabel, purposeLabel } from '../lib/labels';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Resource } from '../api';
import { FormError } from './FormError';
import { ResourcePicker } from './ResourcePicker';
import type { Deployment, RelationType } from './referenceTypes';

export type EditorSelection = { kind: 'relation'; direction: 'out' | 'in' }
  | { kind: 'app-repo' }
  | { kind: 'deployment'; deployment?: Deployment };

export function ReferenceEditor({ selection, resource, onSaved, onCancel }: {
  selection: EditorSelection;
  resource: Resource;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'start' });
    formRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')?.focus({ preventScroll: true });
  }, []);
  const deployment = selection.kind === 'deployment' ? selection.deployment : undefined;
  const [sourceId, setSourceId] = useState(deployment?.application_id
    ?? (selection.kind === 'relation' ? (selection.direction === 'out' ? resource.id : '')
      : resource.resource_type === 'application' ? resource.id : ''));
  const [targetId, setTargetId] = useState(deployment?.target_resource_id
    ?? (selection.kind === 'relation' ? (selection.direction === 'in' ? resource.id : '')
      : selection.kind === 'app-repo' ? (resource.resource_type === 'repository' ? resource.id : '')
        : resource.resource_type === 'compute' || resource.detail?.service_kind === 'hosting' ? resource.id : ''));
  const [repositoryId, setRepositoryId] = useState(deployment?.repository_id
    ?? (selection.kind === 'deployment' && resource.resource_type === 'repository' ? resource.id : ''));
  const [relationType, setRelationType] = useState('');
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [typeError, setTypeError] = useState(false);
  const [typeAttempt, setTypeAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (selection.kind !== 'relation') return;
    let live = true;
    setTypeError(false);
    api<RelationType[]>('/relation-types').then((types) => {
      if (live) setRelationTypes(types.filter((t) => t.is_active));
    }).catch(() => { if (live) setTypeError(true); });
    return () => { live = false; };
  }, [selection.kind, typeAttempt]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '');
    let body: Record<string, unknown>;
    let path: string;
    if (selection.kind === 'relation') {
      if (sourceId === targetId) { setError(new Error('self_relation')); return; }
      path = '/relations';
      body = { source_resource_id: sourceId, target_resource_id: targetId, relation_type: relationType, description: text('description') || null };
    } else if (selection.kind === 'app-repo') {
      path = '/application-repositories';
      body = { application_id: sourceId, repository_id: targetId, purpose: text('purpose') };
    } else {
      path = deployment ? `/deployments/${deployment.id}` : '/deployments';
      const fields = {
        target_resource_id: targetId, repository_id: repositoryId || null,
        environment: text('environment'), deploy_path: text('deploy_path') || null,
        deploy_method: text('deploy_method').trim() || null, revision: text('revision').trim() || null,
        status: text('status'), deployed_at: text('deployed_at') || null,
      };
      // 既存のアーカイブ済み端点や日時を維持し、変更したフィールドのみPATCHする。
      body = deployment ? Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== deployment[key as keyof Deployment]))
        : { application_id: sourceId, ...fields };
    }
    setSaving(true);
    try {
      await api(path, { method: deployment ? 'PATCH' : 'POST', json: body });
      onSaved();
    } catch (e) { setError(e); }
    finally { setSaving(false); }
  }

  const title = selection.kind === 'relation' ? '依存関係の登録'
    : selection.kind === 'app-repo' ? 'アプリ↔Repoリンクの登録' : deployment ? 'デプロイの編集' : 'デプロイの登録';
  const selectedType = relationTypes.find((t) => t.code === relationType);
  return <form ref={formRef} className="resource-form reference-editor" onSubmit={submit} autoComplete="off">
    <fieldset disabled={saving}>
      <legend>{title}</legend>
      <p>認証情報・秘密情報は入力しないでください。新しい参照先はアーカイブされていない資産から選択します。</p>
      {deployment ? <p>アプリケーション: {deployment.application_id}（変更不可）</p>
        : <ResourcePicker label={selection.kind === 'relation' ? '関係元' : 'アプリケーション'} value={sourceId} onChange={setSourceId}
          types={selection.kind === 'relation' ? undefined : ['application']} excludeId={selection.kind === 'relation' ? targetId : undefined}
          currentLabel={sourceId === resource.id ? resource.name : undefined} />}
      <ResourcePicker label={selection.kind === 'relation' ? '関係先' : selection.kind === 'app-repo' ? 'リポジトリ' : '配置先'}
        value={targetId} onChange={setTargetId}
        types={selection.kind === 'relation' ? undefined : selection.kind === 'app-repo' ? ['repository'] : ['compute', 'service_instance']}
        hostingOnly={selection.kind === 'deployment'} excludeId={selection.kind === 'relation' ? sourceId : undefined}
        currentLabel={targetId === resource.id ? resource.name : undefined} />
      {selection.kind === 'relation' && <>
        <label>関係の種別（必須）<select required value={relationType} onChange={(e) => setRelationType(e.target.value)}>
          <option value="">選択してください</option>
          {relationTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select></label>
        {selectedType && <small>{selectedType.description} / {selectedType.is_directed ? '関係元 → 関係先' : '方向なし'}</small>}
        {typeError && <ErrorState>関係種別を取得できません。<Button type="button" onClick={() => setTypeAttempt((n) => n + 1)}>再試行</Button></ErrorState>}
        {sourceId && sourceId === targetId && <ErrorState>関係元と関係先は別の資産を選択してください。</ErrorState>}
        <label>説明<textarea name="description" maxLength={10000} /></label>
      </>}
      {selection.kind === 'app-repo' && <label>用途<select name="purpose" defaultValue="source">
        {['source', 'config', 'infra', 'other'].map((purpose) => <option key={purpose} value={purpose}>{purposeLabel(purpose)}</option>)}
      </select></label>}
      {selection.kind === 'deployment' && <>
        <ResourcePicker label="使用リポジトリ" optional types={['repository']} value={repositoryId} onChange={setRepositoryId}
          currentLabel={repositoryId === resource.id ? resource.name : undefined} />
        <small>使用リポジトリは、先にアプリケーションとのリンクを登録してください。配置先サービスは hosting のみ選択できます。</small>
        <label>環境（必須）<input name="environment" required maxLength={32} pattern="[a-z][a-z0-9_\-]{0,31}" defaultValue={deployment?.environment ?? resource.environment ?? ''} /></label>
        <small>prod / stg / dev など、英小文字で始まる英小文字・数字・_・-（最大32文字）</small>
        <label>配置パス / サービス名<input name="deploy_path" maxLength={2048} defaultValue={deployment?.deploy_path ?? ''} /></label>
        <label>デプロイ方法<input name="deploy_method" maxLength={100} defaultValue={deployment?.deploy_method ?? ''} /></label>
        <label>リビジョン<input name="revision" maxLength={255} defaultValue={deployment?.revision ?? ''} /></label>
        <label>状態<select name="status" defaultValue={deployment?.status ?? 'active'}><option value="active">{deploymentStatusLabel('active')}</option><option value="inactive">{deploymentStatusLabel('inactive')}</option></select></label>
        <small>デプロイを停止扱いにする場合は inactive に変更します。</small>
        <DateTimeField label="デプロイ日時" name="deployed_at" value={deployment?.deployed_at} />
        <small>任意項目を空欄にすると未指定（編集時はクリア）になります。</small>
      </>}
      <FormError error={error} />
      <div className="form-actions">
        <Button data-testid="form-submit" variant="primary" type="submit" disabled={selection.kind === 'relation' && (!relationType || sourceId === targetId)}>{saving ? '保存中…' : '保存'}</Button>
        <Button data-testid="dialog-cancel" type="button" onClick={onCancel}>キャンセル</Button>
      </div>
    </fieldset>
  </form>;
}
