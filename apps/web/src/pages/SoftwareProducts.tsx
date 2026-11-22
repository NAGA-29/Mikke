import { Button, DataTable, EmptyState, LoadingState, PageHeader } from '../components/ui';
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
  return <section><PageHeader title="ソフトウェア製品" actions={<Button variant="primary" data-testid="create-product" onClick={() => setEditing('new')}>製品を登録</Button>} />
    <TextField label="製品名で検索" value={query} onChange={setQuery} />
    {notice && <p role="status">{notice}</p>}
    <FormError error={error} scope="mikke:read" />
    {editing && <ProductForm key={editing === 'new' ? 'new' : editing.id} product={editing === 'new' ? null : editing}
      onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision((v) => v + 1); setNotice('保存しました。'); }} />}
    {!data && !error && <LoadingState />}
    {data && <DataTable aria-label="ソフトウェア製品一覧"><thead><tr><th scope="col">製品</th><th scope="col">ベンダー</th><th scope="col">分類</th><th scope="col">操作</th></tr></thead><tbody>
      {data.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.vendor ?? '-'}</td><td>{p.category ?? '-'}</td><td>
        <Button onClick={() => setEditing(p)}>編集</Button>{' '}
        <Link to={`/software/installations?software_product_id=${p.id}`}>導入</Link>{' '}
        <Link to={`/software/release-cycles?software_product_id=${p.id}`}>リリース系列・イベント</Link>
      </td></tr>)}{!data.length && <tr><td colSpan={4}><EmptyState>該当なし</EmptyState></td></tr>}
    </tbody></DataTable>}
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
    <div className="form-actions"><Button data-testid="form-submit" variant="primary">保存</Button><Button data-testid="dialog-cancel" type="button" onClick={onCancel}>キャンセル</Button></div>
  </fieldset></form>;
}
