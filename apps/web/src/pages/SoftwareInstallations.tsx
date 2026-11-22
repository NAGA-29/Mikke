import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { FormError } from '../components/FormError';
import { ResourcePicker } from '../components/ResourcePicker';
import { ProductSelect, ReleaseCycleAssignment, TextField, useApiData } from '../components/SoftwareFields';
import type { Installation } from '../components/referenceTypes';

export interface InstallationItem extends Installation {
  product_name: string; compute_name: string; compute_archived: boolean; release_cycle: string | null;
}

export function SoftwareInstallations() {
  const [sp, setSp] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const { data, error } = useApiData<InstallationItem[]>(`/software/installations?${sp}`, revision);
  const [editing, setEditing] = useState<InstallationItem | 'new' | null>(null);
  const [assigning, setAssigning] = useState<InstallationItem | null>(null);
  const [notice, setNotice] = useState('');
  function filter(key: string, value: string) {
    const next = new URLSearchParams(sp); if (value) next.set(key, value); else next.delete(key);
    setEditing(null); setAssigning(null); setSp(next);
  }
  function saved() { setEditing(null); setAssigning(null); setRevision((v) => v + 1); setNotice('保存しました。'); }
  return <section><div className="page-heading"><h2>ソフトウェア導入</h2>
    <button onClick={() => { setEditing('new'); setAssigning(null); }}>導入を登録</button></div>
    <div className="filters"><ProductSelect optional value={sp.get('software_product_id') ?? ''} onChange={(v) => filter('software_product_id', v)} />
      <TextField label="バージョン（完全一致）" value={sp.get('version') ?? ''} onChange={(v) => filter('version', v)} />
      <label><input type="checkbox" checked={sp.get('include_archived') === 'true'} onChange={(e) => filter('include_archived', e.target.checked ? 'true' : '')} />アーカイブを含む</label>
    </div>
    <ResourcePicker optional types={['compute']} label="コンピュートで絞り込み" value={sp.get('compute_asset_id') ?? ''} onChange={(v) => filter('compute_asset_id', v)} />
    {notice && <p role="status">{notice}</p>}<FormError error={error} scope="mikke:read" />
    <button onClick={() => { setRevision((v) => v + 1); setEditing(null); setAssigning(null); }}>再読み込み</button>
    {editing && <InstallationForm key={editing === 'new' ? 'new' : editing.id} installation={editing === 'new' ? null : editing}
      computeId={sp.get('compute_asset_id') ?? ''} productId={sp.get('software_product_id') ?? ''} onSaved={saved} onCancel={() => setEditing(null)} />}
    {assigning && <><h3>{assigning.compute_name} / {assigning.product_name} / {assigning.version ?? '版不明'}</h3>
      <ReleaseCycleAssignment key={assigning.id} path={`/software/installations/${assigning.id}/release-cycle`}
        productId={assigning.software_product_id} currentId={assigning.release_cycle_id} onSaved={saved} />
      <button onClick={() => setAssigning(null)}>キャンセル</button></>}
    {!data && !error && <p>読み込み中…</p>}
    {data && <div className="reference-table"><table><thead><tr><th>コンピュート</th><th>製品</th><th>バージョン</th><th>系列</th><th>導入方法・パス</th><th>設定パス</th><th>最終確認</th><th>操作</th></tr></thead><tbody>
      {data.map((i) => <tr key={i.id} className={i.compute_archived ? 'archived' : ''}>
        <td><Link to={`/resources/${i.compute_asset_id}`}>{i.compute_name}</Link>{i.compute_archived && '（アーカイブ）'}</td>
        <td>{i.product_name}</td><td>{i.version ?? '-'}</td><td><Link to={`/software/release-cycles?software_product_id=${i.software_product_id}`}>{i.release_cycle ?? '未割当'}</Link></td>
        <td>{i.install_method ?? '-'} / {i.install_path ?? '-'}</td><td>{i.config_path ?? '-'}</td><td>{i.last_verified_at ?? '-'}</td><td>
          <button disabled={i.compute_archived} onClick={() => { setEditing(i); setAssigning(null); }}>編集</button>{' '}
          <button disabled={i.compute_archived} onClick={() => { setAssigning(i); setEditing(null); }}>系列割当</button>
        </td></tr>)}{!data.length && <tr><td colSpan={8}>該当なし</td></tr>}
    </tbody></table></div>}
  </section>;
}

function InstallationForm({ installation: i, computeId, productId, onSaved, onCancel }: {
  installation: InstallationItem | null; computeId: string; productId: string; onSaved: () => void; onCancel: () => void;
}) {
  const [compute, setCompute] = useState(i?.compute_asset_id ?? computeId);
  const [product, setProduct] = useState(i?.software_product_id ?? productId);
  const [fields, setFields] = useState({ version: i?.version ?? '', install_method: i?.install_method ?? '',
    install_path: i?.install_path ?? '', config_path: i?.config_path ?? '', last_verified_at: i?.last_verified_at ?? '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <form className="resource-form" onSubmit={async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    const values = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v || null]));
    try { await api(`/software/installations${i ? `/${i.id}` : ''}`, { method: i ? 'PATCH' : 'POST',
      json: { ...(!i ? { compute_asset_id: compute, software_product_id: product } : {}), ...values },
    }); onSaved(); } catch (e) { setError(e); } finally { setSaving(false); }
  }}><fieldset disabled={saving}><legend>{i ? '導入を編集' : '導入を登録'}</legend><FormError error={error} />
    {i ? <p>{i.compute_name} / {i.product_name}（導入先と製品は変更不可）</p> : <>
      <ResourcePicker label="導入先" types={['compute']} value={compute} onChange={setCompute} />
      <ProductSelect value={product} onChange={setProduct} /></>}
    {([['version', 'バージョン', 255], ['install_method', '導入方法', 100], ['install_path', '導入パス', 2048],
      ['config_path', '設定パス', 2048], ['last_verified_at', '最終確認日時（ISO 8601・タイムゾーン必須）', 50]] as const).map(([key, label, max]) =>
      <TextField key={key} label={label} maxLength={max} value={fields[key]} onChange={(v) => setFields({ ...fields, [key]: v })} />)}
    <div className="form-actions"><button>保存</button><button type="button" onClick={onCancel}>キャンセル</button></div>
  </fieldset></form>;
}
