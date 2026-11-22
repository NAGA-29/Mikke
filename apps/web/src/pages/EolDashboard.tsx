import { Badge, DataTable, EmptyState, LoadingState, PageHeader, Time } from '../components/ui';
import { verificationLabel } from '../lib/labels';
import { Link, useSearchParams } from 'react-router-dom';
import { FormError } from '../components/FormError';
import { ResourcePicker } from '../components/ResourcePicker';
import { ProductSelect, TextField, useApiData } from '../components/SoftwareFields';

const STATUSES = { eol: 'EOL', approaching_eol: '期限接近', supported: 'サポート中', unknown: '不明' } as const;
interface EolItem {
  target_kind: string; target_id: string; resource: { id: string; name: string }; product: { id: string; name: string } | null;
  version: string | null; release_cycle: { id: string; cycle: string; verification_status: string } | null;
  status: keyof typeof STATUSES; reason: string | null; end_date: string | null; end_basis: string | null; days_remaining: number | null;
  checked_at: string | null; stale: boolean | null; needs_verification: boolean | null; cycle_mismatch: boolean | null;
}
interface EolResult {
  as_of: string; thresholds: { warning_days: number; stale_days: number }; items: EolItem[];
}
const REASONS: Record<string, string> = {
  product_not_identified: '製品未特定', release_cycle_not_assigned: '系列未割当', release_cycle_disputed: '系列に異議あり',
  version_cycle_mismatch: '版と系列が不一致', end_date_not_registered: '終了日未登録',
};

export function EolDashboard() {
  const [sp, setSp] = useSearchParams();
  const serverParams = new URLSearchParams(sp); serverParams.delete('needs_review');
  const { data, error } = useApiData<EolResult>(`/eol/status?${serverParams}`);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(sp); if (value) next.set(key, value); else next.delete(key); setSp(next, { replace: true });
  }
  const items = data?.items.filter((i) => sp.get('needs_review') !== 'true' || i.needs_verification || i.cycle_mismatch);
  return <section><PageHeader title="EOL 状況" />
    <p>稼働中の資産が対象です。終了日はAPIの判定を表示します。個別契約のサポート期限は別途確認してください。</p>
    <div className="filters">
      <label>状態<select value={sp.get('status') ?? ''} onChange={(e) => filter('status', e.target.value)}><option value="">すべて</option>
        {Object.entries(STATUSES).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select></label>
      <label>対象<select value={sp.get('target_kind') ?? ''} onChange={(e) => filter('target_kind', e.target.value)}>
        <option value="">すべて</option><option value="installation">導入ソフトウェア</option><option value="service_instance">サービス</option><option value="compute_os">OS</option>
      </select></label>
      <ProductSelect optional value={sp.get('software_product_id') ?? ''} onChange={(v) => filter('software_product_id', v)} />
      <TextField label="判定日（空欄はAPIの当日）" type="date" value={sp.get('as_of') ?? ''} onChange={(v) => filter('as_of', v)} />
      <label>根拠の鮮度<select value={sp.get('stale') ?? ''} onChange={(e) => filter('stale', e.target.value)}>
        <option value="">すべて</option><option value="true">stale（古い）</option><option value="false">新しい</option>
      </select></label>
      <label><input type="checkbox" checked={sp.get('needs_review') === 'true'} onChange={(e) => filter('needs_review', e.target.checked ? 'true' : '')} />要確認のみ（未検証・異議・版不一致）</label>
    </div>
    <ResourcePicker optional label="資産で絞り込み" value={sp.get('resource_id') ?? ''} onChange={(v) => filter('resource_id', v)} />
    <FormError error={error} scope="mikke:read" />{!data && !error && <LoadingState />}
    {data && items && <>
      <p>判定日: {data.as_of} / 期限接近: {data.thresholds.warning_days}日以内 / stale: 根拠確認から{data.thresholds.stale_days}日超</p>
      <p>現在のフィルタに一致する件数（対象単位、資産の重複あり）</p>
      <div className="summary" aria-label="状態別件数">{Object.entries(STATUSES).map(([v, label]) => <div key={v}>{label}<strong>{items.filter((i) => i.status === v).length}</strong></div>)}
        <div>stale<strong>{items.filter((i) => i.stale).length}</strong></div><div>要確認<strong>{items.filter((i) => i.needs_verification || i.cycle_mismatch).length}</strong></div>
      </div>
      <div className="reference-table"><DataTable aria-label="EOL判定一覧"><thead><tr><th scope="col">資産・対象</th><th scope="col">製品・版・系列</th><th scope="col">状態</th><th scope="col">終了日・根拠種別</th><th scope="col">確認日時</th><th scope="col">フラグ</th><th scope="col">操作</th></tr></thead><tbody>
        {items.map((i) => <tr key={`${i.target_kind}-${i.target_id}`}><td><Link to={`/resources/${i.resource.id}`}>{i.resource.name}</Link><br />{i.target_kind}</td>
          <td>{i.product?.name ?? '製品不明'} / {i.version ?? '版不明'} / {i.release_cycle?.cycle ?? '系列未割当'}</td>
          <td><Badge status={i.status} />{i.reason && <p>{REASONS[i.reason] ?? '要確認'}</p>}</td>
          <td className="numeric">{i.end_date ?? '不明'} / {i.end_basis ?? '-'}{i.days_remaining !== null && <p>残り {i.days_remaining} 日</p>}</td>
          <td><Time value={i.checked_at} /></td><td>{i.stale && <Badge>情報が古い</Badge>}{i.needs_verification && <Badge>要確認: {verificationLabel(i.release_cycle?.verification_status)}</Badge>}{i.cycle_mismatch && <Badge>版不一致</Badge>}</td>
          <td>{i.product && <Link to={`/software/release-cycles?software_product_id=${i.product.id}`}>系列・根拠を編集</Link>}<br />
            {i.target_kind === 'installation' ? <Link to={`/software/installations?compute_asset_id=${i.resource.id}`}>導入・割当</Link> : <Link to={`/resources/${i.resource.id}`}>系列割当</Link>}</td>
        </tr>)}{!items.length && <tr><td colSpan={7}><EmptyState>該当なし</EmptyState></td></tr>}
      </tbody></DataTable></div>
    </>}
  </section>;
}
