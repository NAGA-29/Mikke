import { Badge, ErrorState, LinkButton, LoadingState, PageHeader, Time } from '../components/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, RESOURCE_TYPE_LABEL, type Resource } from '../api';
import { ResourceReferences } from '../components/ResourceReferences';
import { ArchiveResource } from '../components/ArchiveResource';
import { HostingEditor } from '../components/HostingEditor';
import { DetailList } from '../components/DetailList';
import { ReleaseCycleAssignment } from '../components/SoftwareFields';

export function ResourceDetail() {
  const { id } = useParams();
  const [res, setRes] = useState<Resource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [hostEditing, setHostEditing] = useState(false);
  const [hostName, setHostName] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    setRes(null);
    setError(null);
    api<Resource>(`/resources/${id}`)
      .then((r) => { if (live) setRes(r); })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [id, revision]);

  const hostId = typeof res?.detail?.host_compute_id === 'string' ? res.detail.host_compute_id : null;
  useEffect(() => {
    setHostName(undefined);
    if (!hostId) return;
    let live = true;
    api<{ name: string }>(`/resources/${hostId}`).then((h) => { if (live) setHostName(h.name); }).catch(() => undefined);
    return () => { live = false; };
  }, [hostId]);

  if (error) return <ErrorState>{error}</ErrorState>;
  if (!res || res.id !== id) return <LoadingState />;

  return (
    <section>
      <p><Link to="/resources">← 一覧</Link></p>
      <PageHeader title={<>{res.name} {res.archived_at && <Badge status="archived" />}</>} actions={!res.archived_at && <Link className="button button-primary" to={`/resources/${res.id}/edit`}>編集</Link>} />
      <h3>基本情報</h3><dl className="detail-card">
        <dt>種別</dt><dd>{RESOURCE_TYPE_LABEL[res.resource_type]}</dd>
        <dt>環境</dt><dd>{res.environment ?? '-'}</dd>
        <dt>状態</dt><dd><Badge status={res.lifecycle_status} /></dd>
        <dt>説明</dt><dd>{res.description ?? '-'}</dd>
        <dt>最終確認</dt><dd><Time value={res.last_verified_at} /></dd>
      </dl>
      <h3>種別ごとの詳細</h3>
      <DetailList type={res.resource_type} detail={res.detail}
        onEditHost={res.resource_type === 'service_instance' && !res.archived_at ? () => setHostEditing(true) : undefined} />
      {hostEditing && <HostingEditor resource={res} selection={{ kind: 'host', hostId: hostId ?? '', hostName }}
        onCancel={() => setHostEditing(false)} onSaved={() => { setHostEditing(false); setRevision((n) => n + 1); }} />}
      <div className="form-actions">
        <LinkButton icon="package" to="/software/products">ソフトウェア製品</LinkButton>
        {res.resource_type === 'compute' && <LinkButton icon="server" to={`/software/installations?compute_asset_id=${res.id}`}>ソフトウェア導入・系列割当</LinkButton>}
        <LinkButton icon="calendar" to={`/eol?resource_id=${res.id}`}>この資産のEOL</LinkButton>
        <LinkButton icon="clipboard" to={`/audit-logs?entity_type=resource&entity_id=${res.id}`}>監査ログ</LinkButton>
      </div>
      {!res.archived_at && (res.resource_type === 'compute' || res.resource_type === 'service_instance') && <ReleaseCycleAssignment
        key={`${res.id}-${res.updated_at}`} path={res.resource_type === 'compute' ? `/compute/${res.id}/os-release-cycle` : `/services/${res.id}/release-cycle`}
        productId={typeof res.detail?.[res.resource_type === 'compute' ? 'os_software_product_id' : 'software_product_id'] === 'string'
          ? String(res.detail?.[res.resource_type === 'compute' ? 'os_software_product_id' : 'software_product_id']) : null}
        currentId={typeof res.detail?.[res.resource_type === 'compute' ? 'os_release_cycle_id' : 'release_cycle_id'] === 'string'
          ? String(res.detail?.[res.resource_type === 'compute' ? 'os_release_cycle_id' : 'release_cycle_id']) : null}
        onSaved={() => setRevision((n) => n + 1)} />}
      <ResourceReferences key={res.id} resource={res} onChanged={() => setRevision((n) => n + 1)} />
      <ArchiveResource key={`${res.id}-${res.archived_at}`} resource={res} onSaved={() => setRevision((n) => n + 1)} />
    </section>
  );
}
