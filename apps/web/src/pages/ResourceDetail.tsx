import { Badge, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, RESOURCE_TYPE_LABEL, type Resource } from '../api';
import { ResourceReferences } from '../components/ResourceReferences';
import { ArchiveResource } from '../components/ArchiveResource';
import { ReleaseCycleAssignment } from '../components/SoftwareFields';

export function ResourceDetail() {
  const { id } = useParams();
  const [res, setRes] = useState<Resource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    setRes(null);
    setError(null);
    api<Resource>(`/resources/${id}`)
      .then((r) => { if (live) setRes(r); })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [id, revision]);

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
        <dt>最終確認</dt><dd>{res.last_verified_at ?? '-'}</dd>
      </dl>
      <h3>種別ごとの詳細</h3>
      <DetailList detail={res.detail} />
      <div className="form-actions">
        <Link className="button" to="/software/products">ソフトウェア製品</Link>
        {res.resource_type === 'compute' && <Link className="button" to={`/software/installations?compute_asset_id=${res.id}`}>ソフトウェア導入・系列割当</Link>}
        <Link className="button" to={`/eol?resource_id=${res.id}`}>この資産のEOL</Link>
        <Link className="button" to={`/audit-logs?entity_type=resource&entity_id=${res.id}`}>監査ログ</Link>
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

/** 種別ごとの詳細。値のある項目だけを一覧にし、object（attributes）は整形JSONで示す */
function DetailList({ detail }: { detail: Record<string, unknown> | null }) {
  const entries = Object.entries(detail ?? {}).filter(([, v]) => v !== null && v !== '' && !(typeof v === 'object' && Object.keys(v as object).length === 0));
  if (entries.length === 0) return <dl className="detail-card"><dd className="muted">登録されている詳細項目はありません。</dd></dl>;
  return <dl className="detail-card" data-testid="detail-list">
    {entries.map(([k, v]) => <div key={k} style={{ display: 'contents' }}>
      <dt>{k}</dt>
      <dd>{typeof v === 'object' ? <pre>{JSON.stringify(v, null, 2)}</pre> : typeof v === 'boolean' ? (v ? 'はい' : 'いいえ') : String(v)}</dd>
    </div>)}
  </dl>;
}
