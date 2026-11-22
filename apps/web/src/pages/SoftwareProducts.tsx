import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { FormError } from '../components/FormError';
import { TextField, useApiData, type Product } from '../components/SoftwareFields';

export function SoftwareProducts() {
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const { data, error } = useApiData<Product[]>(`/software/products?${new URLSearchParams({ q: query })}`, revision);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  return <section><div className="page-heading"><h2>ソフトウェア製品</h2><button onClick={() => setEditing('new')}>製品を登録</button></div>
    <TextField label="製品名で検索" value={query} onChange={setQuery} />
    {notice && <p role="status">{notice}</p>}
    <FormError error={error} scope="mikke:read" />
    {editing && <ProductForm key={editing === 'new' ? 'new' : editing.id} product={editing === 'new' ? null : editing}
      onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision((v) => v + 1); setNotice('保存しました。'); }} />}
    {!data && !error && <p>読み込み中…</p>}
    {data && <table><thead><tr><th>製品</th><th>ベンダー</th><th>分類</th><th>操作</th></tr></thead><tbody>
      {data.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.vendor ?? '-'}</td><td>{p.category ?? '-'}</td><td>
        <button onClick={() => setEditing(p)}>編集</button>{' '}
        <Link to={`/software/installations?software_product_id=${p.id}`}>導入</Link>{' '}
        <Link to={`/software/release-cycles?software_product_id=${p.id}`}>リリース系列・イベント</Link>
      </td></tr>)}{!data.length && <tr><td colSpan={4}>該当なし</td></tr>}
    </tbody></table>}
  </section>;
}

function ProductForm({ product, onSaved, onCancel }: { product: Product | null; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [vendor, setVendor] = useState(product?.vendor ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <form className="resource-form" onSubmit={async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    try { await api(`/software/products${product ? `/${product.id}` : ''}`, {
      method: product ? 'PATCH' : 'POST', json: { name, vendor: vendor || null, category: category || null },
    }); onSaved(); } catch (e) { setError(e); } finally { setSaving(false); }
  }}><fieldset disabled={saving}><legend>{product ? '製品を編集' : '製品を登録'}</legend>
    <FormError error={error} /><TextField label="製品名" required value={name} onChange={setName} />
    <TextField label="ベンダー" value={vendor} onChange={setVendor} /><TextField label="分類" maxLength={50} value={category} onChange={setCategory} />
    <div className="form-actions"><button>保存</button><button type="button" onClick={onCancel}>キャンセル</button></div>
  </fieldset></form>;
}
