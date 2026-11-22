import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, RESOURCE_TYPE_LABEL, type Resource } from '../api';
import { ResourceReferences } from '../components/ResourceReferences';

export function ResourceDetail() {
  const { id } = useParams();
  const [res, setRes] = useState<Resource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRes(null);
    setError(null);
    api<Resource>(`/resources/${id}`)
      .then((r) => { if (live) setRes(r); })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);

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
      <ResourceReferences key={res.id} resource={res} />
    </section>
  );
}
