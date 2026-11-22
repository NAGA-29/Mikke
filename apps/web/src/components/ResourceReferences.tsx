import { Badge, Button, DataTable, EmptyState, LoadingState, ErrorState, Time } from './ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Resource } from '../api';
import { FormError } from './FormError';
import { ReferenceEditor, type EditorSelection } from './ReferenceEditor';
import { HostingEditor, type HostingSelection } from './HostingEditor';
import type { Deployment, ResourceReferencesData } from './referenceTypes';

function ReferenceTable<T>({ caption, items, headings, cells }: {
  caption: string; items: T[]; headings: string[]; cells: (item: T) => ReactNode[];
}) {
  return <div className="reference-table"><DataTable aria-label={caption}>
    <caption>{caption}</caption>
    <thead><tr>{headings.map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
    <tbody>{items.map((item, i) => <tr key={i}>{cells(item).map((cell, j) => <td key={j}>{cell ?? '-'}</td>)}</tr>)}
      {items.length === 0 && <tr><td colSpan={headings.length}><EmptyState>参照なし</EmptyState></td></tr>}
    </tbody>
  </DataTable></div>;
}

function DeleteReference({ path, label, onDeleted }: { path: string; label: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!confirming) return <Button variant="danger" type="button" onClick={() => setConfirming(true)}>削除</Button>;
  return <form onSubmit={async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try { await api(path, { method: 'DELETE' }); onDeleted(); setConfirming(false); }
    catch (e) { setError(e); }
    finally { setSaving(false); }
  }}>
    <fieldset disabled={saving}>
      <legend>{label}の削除確認</legend>
      <p>この関係を削除します。すべての図にも反映されます。</p>
      <FormError error={error} />
      <div className="form-actions"><Button data-testid="dialog-confirm" variant="danger" type="submit">{saving ? '削除中…' : '削除を確定'}</Button>
        <Button data-testid="dialog-cancel" type="button" onClick={() => { setConfirming(false); setError(null); }}>キャンセル</Button></div>
    </fieldset>
  </form>;
}

export function ResourceReferences({ resource, readOnly = false, onReadyChange, onChanged }: {
  resource: Resource; readOnly?: boolean; onReadyChange?: (ready: boolean) => void; onChanged?: () => void;
}) {
  const [refs, setRefs] = useState<ResourceReferencesData | null>(null);
  const [names, setNames] = useState<Record<string, { name: string; archived_at: string | null }>>({ [resource.id]: resource });
  const [installations, setInstallations] = useState<Record<string, { product_name: string; release_cycle: string | null }>>({});
  const [error, setError] = useState<unknown>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<EditorSelection | null>(null);
  const [hosting, setHosting] = useState<HostingSelection | null>(null);
  const [notice, setNotice] = useState('');
  const reload = () => setRevision((n) => n + 1);

  useEffect(() => {
    let live = true;
    setLoading(true);
    onReadyChange?.(false);
    setError(null);
    setLookupFailed(false);
    api<ResourceReferencesData>(`/resources/${resource.id}/references`).then(async (data) => {
      if (!live) return;
      setRefs(data);
      setLoading(false);
      onReadyChange?.(true);
      const known = Object.fromEntries([resource, ...data.hosted_services, ...(data.host ? [data.host] : [])].map((r) => [r.id, r]));
      setNames(known);
      const deployments = [...data.deployments_as_application, ...data.deployments_as_target, ...data.deployments_as_repository];
      const ids = new Set([
        ...deployments.flatMap((d) => [d.application_id, d.target_resource_id, ...(d.repository_id ? [d.repository_id] : [])]),
        ...[...data.relations_out, ...data.relations_in].flatMap((r) => [r.source_resource_id, r.target_resource_id]),
        ...data.application_repositories.flatMap((r) => [r.application_id, r.repository_id]),
        ...data.software_installations.map((i) => i.compute_asset_id),
      ]);
      const lookups = await Promise.allSettled([...ids].filter((id) => !known[id]).map(async (id) => {
        const r = await api<Resource>(`/resources/${id}`);
        return [id, { name: r.name, archived_at: r.archived_at }] as const;
      }));
      if (!live) return;
      setNames({ ...known, ...Object.fromEntries(lookups.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])) });
      if (lookups.some((result) => result.status === 'rejected')) setLookupFailed(true);
    }).catch((e: unknown) => { if (live) { setError(e); setLoading(false); } });
    return () => { live = false; };
  }, [resource, revision, onReadyChange]);

  useEffect(() => {
    let live = true;
    setInstallations({});
    if (!refs?.software_installations.length) return;
    api<{ id: string; product_name: string; release_cycle: string | null }[]>(`/software/installations?compute_asset_id=${resource.id}&include_archived=true`)
      .then((rows) => { if (live) setInstallations(Object.fromEntries(rows.map((r) => [r.id, r]))); })
      .catch(() => { if (live) setLookupFailed(true); });
    return () => { live = false; };
  }, [resource.id, refs]);

  function resourceLink(id: string | null) {
    if (!id) return '-';
    const r = names[id];
    return <><Link to={`/resources/${id}`}>{r?.name ?? id}</Link>{r?.archived_at && <Badge status="archived" />}</>;
  }
  function saved() { setEditor(null); setNotice('保存しました。'); reload(); }
  function deleted() { setNotice('削除しました。'); reload(); }
  function deploymentTable(caption: string, rows: Deployment[]) {
    return <ReferenceTable caption={caption} items={rows}
      headings={['アプリケーション', '配置先', '使用Repo', '環境', '状態', '配置パス', '方法', 'リビジョン', 'デプロイ日時', '操作']}
      cells={(d) => [resourceLink(d.application_id), resourceLink(d.target_resource_id), resourceLink(d.repository_id), d.environment,
        <Badge status={d.status} />, d.deploy_path, d.deploy_method, d.revision, <Time key="deployed" value={d.deployed_at} />,
        !readOnly && <Button type="button" disabled={!!editor || !!hosting || loading} onClick={() => setEditor({ kind: 'deployment', deployment: d })}>編集</Button>]} />;
  }
  const canCreate = !readOnly && !resource.archived_at && !loading && !error && !editor && !hosting;
  return <section aria-label="参照">
    <div className="page-heading"><h3>参照</h3><Button type="button" disabled={loading} onClick={reload}>再読み込み</Button></div>
    {notice && <p role="status">{notice}</p>}
    {loading && <LoadingState>参照を読み込み中…</LoadingState>}
    <FormError error={error} scope="mikke:read" />
    {lookupFailed && <ErrorState>一部の名前を取得できませんでした。IDで表示しています。再読み込みで再試行できます。</ErrorState>}
    {editor && <ReferenceEditor key={editor.kind === 'deployment' ? `deployment-${editor.deployment?.id ?? 'new'}` : editor.kind === 'relation' ? `relation-${editor.direction}` : 'app-repo'}
      selection={editor} resource={resource} onSaved={saved} onCancel={() => setEditor(null)} />}
    {hosting && <HostingEditor resource={resource} selection={hosting} onCancel={() => setHosting(null)} onSaved={() => {
      setHosting(null); setNotice('ホスト先を更新しました。');
      if (onChanged) onChanged(); else reload();
    }} />}
    {refs && <>
      <h4>デプロイ</h4>
      <Button variant="primary" data-testid="create-deployment" type="button" disabled={!canCreate} onClick={() => setEditor({ kind: 'deployment' })}>デプロイを登録</Button>
      {deploymentTable('アプリケーション側', refs.deployments_as_application)}
      {deploymentTable('配置先側', refs.deployments_as_target)}
      {deploymentTable('リポジトリ側', refs.deployments_as_repository)}
      {resource.resource_type === 'compute' && !readOnly && !resource.archived_at && <Button type="button" data-testid="hosting-add-service" disabled={!canCreate}
        onClick={() => setHosting({ kind: 'add-service' })}>サービスを追加</Button>}
      <ReferenceTable caption="ホストしているサービス" items={refs.hosted_services} headings={['サービス', '操作']} cells={(s) => [resourceLink(s.id),
        resource.resource_type === 'compute' && !readOnly && !resource.archived_at && !s.archived_at && <Button type="button" data-testid={`hosting-unset-${s.id}`} disabled={!canCreate}
          onClick={() => setHosting({ kind: 'unset-service', serviceId: s.id, serviceName: s.name })}>ホスト先を解除</Button>]} />
      {resource.resource_type === 'service_instance' && !readOnly && !resource.archived_at && <Button type="button" data-testid="hosting-edit" disabled={!canCreate}
        onClick={() => setHosting({ kind: 'host', hostId: refs.host?.id ?? '', hostName: refs.host?.name })}>ホスト先を設定/変更/解除</Button>}
      <ReferenceTable caption="ホスト先" items={refs.host ? [refs.host] : []} headings={['コンピュート']} cells={(host) => [resourceLink(host.id)]} />
      <h4>依存関係</h4>
      <div className="form-actions">
        <Button variant="primary" data-testid="create-relation-out" type="button" disabled={!canCreate} onClick={() => setEditor({ kind: 'relation', direction: 'out' })}>この資産からの関係を登録</Button>
        <Button variant="primary" data-testid="create-relation-in" type="button" disabled={!canCreate} onClick={() => setEditor({ kind: 'relation', direction: 'in' })}>この資産への関係を登録</Button>
      </div>
      {(['out', 'in'] as const).map((direction) => <ReferenceTable key={direction} caption={direction === 'out' ? '出方向（関係元 → 関係先）' : '入方向（関係元 → 関係先）'}
        items={direction === 'out' ? refs.relations_out : refs.relations_in} headings={['関係元', '種別', '関係先', '説明', '操作']}
        cells={(r) => [resourceLink(r.source_resource_id), r.relation_type, resourceLink(r.target_resource_id), r.description,
          !readOnly && <DeleteReference key={r.id} path={`/relations/${r.id}`} label="依存関係" onDeleted={deleted} />]} />)}
      <h4>アプリケーション↔リポジトリ</h4>
      {['application', 'repository'].includes(resource.resource_type) && <Button variant="primary" data-testid="create-app-repo" type="button" disabled={!canCreate} onClick={() => setEditor({ kind: 'app-repo' })}>リンクを登録</Button>}
      <ReferenceTable caption="アプリケーション↔リポジトリのリンク" items={refs.application_repositories} headings={['アプリケーション', 'リポジトリ', '用途', '操作']}
        cells={(r) => [resourceLink(r.application_id), resourceLink(r.repository_id), r.purpose,
          !readOnly && <DeleteReference key={r.id} path={`/application-repositories/${r.id}`} label="アプリ↔Repoリンク" onDeleted={deleted} />]} />
      <ReferenceTable caption="ソフトウェア導入" items={refs.software_installations}
        headings={['コンピュート', '製品', 'バージョン', 'リリース系列', '導入方法', '導入パス', '設定パス', '最終確認']}
        cells={(i) => [resourceLink(i.compute_asset_id), installations[i.id]?.product_name ?? i.software_product_id, i.version,
          installations[i.id]?.release_cycle ?? i.release_cycle_id, i.install_method, i.install_path, i.config_path, <Time key="verified" value={i.last_verified_at} />]} />
      <ReferenceTable caption="図への配置" items={refs.diagram_ids} headings={['図']} cells={(id) => [<Link key={id} to={`/diagrams/${id}`}>{id}</Link>]} />
    </>}
  </section>;
}
