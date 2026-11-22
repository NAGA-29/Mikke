import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Resource, type ResourceType } from '../api';
import { enumLabel, fields, HIDDEN_DETAIL_FIELDS, REFERENCE_FIELDS } from '../lib/resourceFields';
import { Badge } from './ui';

/** ID から表示名を引いて表示する（UUID をそのまま見せない）。取得できない間・失敗時は短縮IDを出す */
function NamedReference({ kind, id }: { kind: 'resource' | 'product'; id: string }) {
  const [named, setNamed] = useState<{ name: string; archived: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ name: string; archived_at?: string | null }>(kind === 'resource' ? `/resources/${id}` : `/software/products/${id}`)
      .then((r) => { if (live) setNamed({ name: r.name, archived: !!r.archived_at }); })
      .catch(() => { if (live) setNamed(null); });
    return () => { live = false; };
  }, [kind, id]);
  const label = named?.name ?? `${id.slice(0, 8)}…`;
  return <>
    {kind === 'resource' ? <Link to={`/resources/${id}`}>{label}</Link> : <Link to={`/software/products`}>{label}</Link>}
    {named?.archived && <> <Badge status="archived" /></>}
  </>;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'object' && Object.keys(v as object).length === 0);

/** 種別ごとの詳細。項目名は日本語ラベル、ID は名前で表示し、値のある項目だけを定義順に並べる */
export function DetailList({ type, detail }: { type: ResourceType; detail: Resource['detail'] }) {
  const defs = fields[type];
  const known = new Set(defs.map((f) => f.name));
  const rows = [
    ...defs.map((f) => ({ key: f.name, label: f.label, field: f })),
    // 定義にない項目（将来の拡張）も、キー名のまま末尾に出して見落とさない
    ...Object.keys(detail ?? {}).filter((k) => !known.has(k) && !HIDDEN_DETAIL_FIELDS.has(k)).map((k) => ({ key: k, label: k, field: undefined })),
  ].filter((r) => !isEmpty(detail?.[r.key]));
  if (rows.length === 0) return <dl className="detail-card"><dd className="muted">登録されている詳細項目はありません。</dd></dl>;
  return <dl className="detail-card" data-testid="detail-list">
    {rows.map(({ key, label, field }) => {
      const v = detail?.[key];
      const ref = (REFERENCE_FIELDS as Record<string, 'resource' | 'product'>)[key];
      return <div key={key} style={{ display: 'contents' }}>
        <dt>{label.replace(/（JSONオブジェクト）$/, '')}</dt>
        <dd>{ref && typeof v === 'string' ? <NamedReference kind={ref} id={v} />
          : typeof v === 'boolean' ? (v ? 'はい' : 'いいえ')
          : typeof v === 'object' ? <pre>{JSON.stringify(v, null, 2)}</pre>
          : field?.options ? enumLabel(key, String(v)) : String(v)}</dd>
      </div>;
    })}
  </dl>;
}
