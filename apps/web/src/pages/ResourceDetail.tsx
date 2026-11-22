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

  if (error) return <p className="error">{error}</p>;
  if (!res || res.id !== id) return <p>読み込み中…</p>;

  return (
    <section>
      <p><Link to="/resources">← 一覧</Link></p>
      <h2>{res.name} {res.archived_at && <span className="badge">アーカイブ済み</span>}</h2>
      {!res.archived_at && <p><Link to={`/resources/${res.id}/edit`}>編集</Link></p>}
      <dl>
        <dt>種別</dt><dd>{RESOURCE_TYPE_LABEL[res.resource_type]}</dd>
        <dt>環境</dt><dd>{res.environment ?? '-'}</dd>
        <dt>状態</dt><dd>{res.lifecycle_status}</dd>
        <dt>説明</dt><dd>{res.description ?? '-'}</dd>
        <dt>最終確認</dt><dd>{res.last_verified_at ?? '-'}</dd>
      </dl>
      <h3>種別ごとの詳細</h3>
      <pre>{JSON.stringify(res.detail, null, 2)}</pre>
      <div className="form-actions">
        <Link to="/software/products">ソフトウェア製品</Link>
        {res.resource_type === 'compute' && <Link to={`/software/installations?compute_asset_id=${res.id}`}>ソフトウェア導入・系列割当</Link>}
        <Link to={`/eol?resource_id=${res.id}`}>この資産のEOL</Link>
        <Link to={`/audit-logs?entity_type=resource&entity_id=${res.id}`}>監査ログ</Link>
      </div>
      {!res.archived_at && (res.resource_type === 'compute' || res.resource_type === 'service_instance') && <ReleaseCycleAssignment
        key={`${res.id}-${res.updated_at}`} path={res.resource_type === 'compute' ? `/compute/${res.id}/os-release-cycle` : `/services/${res.id}/release-cycle`}
        productId={typeof res.detail?.[res.resource_type === 'compute' ? 'os_software_product_id' : 'software_product_id'] === 'string'
          ? String(res.detail?.[res.resource_type === 'compute' ? 'os_software_product_id' : 'software_product_id']) : null}
        currentId={typeof res.detail?.[res.resource_type === 'compute' ? 'os_release_cycle_id' : 'release_cycle_id'] === 'string'
          ? String(res.detail?.[res.resource_type === 'compute' ? 'os_release_cycle_id' : 'release_cycle_id']) : null}
        onSaved={() => setRevision((n) => n + 1)} />}
      <ResourceReferences key={res.id} resource={res} />
      <ArchiveResource key={`${res.id}-${res.archived_at}`} resource={res} onSaved={() => setRevision((n) => n + 1)} />
    </section>
  );
}
