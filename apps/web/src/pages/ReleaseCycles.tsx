import { Button, DataTable, EmptyState, LoadingState, PageHeader, Time } from '../components/ui';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { FormError } from '../components/FormError';
import { ResourcePicker } from '../components/ResourcePicker';
import { displaySourceUrl, ProductSelect, TextField, urlHasCredentials, useApiData, type LifecycleEvent, type ReleaseCycle } from '../components/SoftwareFields';
import type { InstallationItem } from './SoftwareInstallations';

type Editor = { kind: 'cycle'; cycle: ReleaseCycle | null } | { kind: 'event'; cycle: ReleaseCycle; event: LifecycleEvent | null };

export function ReleaseCycles() {
  const [sp, setSp] = useSearchParams();
  const productId = sp.get('software_product_id') ?? '';
  const [revision, setRevision] = useState(0);
  const { data, error } = useApiData<ReleaseCycle[]>(`/software/release-cycles${productId ? `?software_product_id=${productId}` : ''}`, revision);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState('');
  function saved(pending = false) {
    setEditor(null); setRevision((n) => n + 1);
    setNotice(pending ? '承認待ちとして登録しました（HTTP 202）。日付はまだ変更されていません。' : '保存しました。');
  }
  return <section><PageHeader title="サポート期限（リリース系列・ライフサイクルイベント）" actions={<Button variant="primary" data-testid="create-cycle" onClick={() => setEditor({ kind: 'cycle', cycle: null })}>系列を登録</Button>} />
    <p>稼働中の資産が使用する系列だけ登録します。公式に明示されていない終了日は登録しないでください。</p>
    <div className="filters"><ProductSelect optional value={productId} onChange={(v) => { setEditor(null); setSp(v ? { software_product_id: v } : {}); }} />
      <Button onClick={() => { setEditor(null); setRevision((n) => n + 1); }}>再読み込み</Button><Link to="/software/lifecycle-event-change-requests">日付変更の承認キュー</Link></div>
    {notice && <p role="status">{notice}</p>}<FormError error={error} scope="mikke:read" />
    {editor?.kind === 'cycle' && <CycleForm key={editor.cycle?.id ?? 'new'} cycle={editor.cycle} productId={productId} onSaved={() => saved()} onCancel={() => setEditor(null)} />}
    {editor?.kind === 'event' && <EventForm key={`${editor.cycle.id}-${editor.event?.id ?? 'new'}`} cycle={editor.cycle} event={editor.event} onSaved={saved} onCancel={() => setEditor(null)} />}
    {!data && !error && <LoadingState />}
    {data?.map((c) => <section key={c.id} className="cycle-card">
      <div className="page-heading"><h3>{c.product_name} / {c.cycle}</h3><Button onClick={() => setEditor({ kind: 'cycle', cycle: c })}>系列を編集</Button></div>
      <p>照合規則: {c.match_pattern ?? c.cycle} / 確認状態: {c.verification_status} / 稼働中の割当: {c.in_service_assignments}</p>
      <p>確認日時: <Time value={c.verified_at} /> / 確認者: {c.verified_by ?? '-'}</p>{c.notes && <p className="preserve-lines">{c.notes}</p>}
      <Button variant="primary" data-testid="create-event" onClick={() => setEditor({ kind: 'event', cycle: c, event: null })}>イベントを登録</Button>
      <div className="reference-table"><DataTable aria-label="ライフサイクルイベント一覧"><thead><tr><th scope="col">種別</th><th scope="col">日付</th><th scope="col">根拠</th><th scope="col">確認日時</th><th scope="col">メモ</th><th scope="col">操作</th></tr></thead><tbody>
        {c.events.map((ev) => <tr key={ev.id}><td>{ev.event_type}</td><td>{ev.event_date}</td><td>{ev.source_title ?? '-'}<br /><span className="source-text">{displaySourceUrl(ev.source_url)}</span></td>
          <td><Time value={ev.checked_at} /></td><td className="preserve-lines">{ev.notes ?? '-'}</td><td><Button onClick={() => setEditor({ kind: 'event', cycle: c, event: ev })}>イベントを編集</Button></td></tr>)}
        {!c.events.length && <tr><td colSpan={6}><EmptyState>イベントなし（終了日不明）</EmptyState></td></tr>}
      </tbody></DataTable></div>
    </section>)}{data?.length === 0 && <EmptyState />}
  </section>;
}

function CycleForm({ cycle: c, productId, onSaved, onCancel }: {
  cycle: ReleaseCycle | null; productId: string; onSaved: () => void; onCancel: () => void;
}) {
  const [product, setProduct] = useState(c?.software_product_id ?? productId);
  const [fields, setFields] = useState({ cycle: c?.cycle ?? '', match_pattern: c?.match_pattern ?? '', verification_status: c?.verification_status ?? 'unverified',
    verified_at: c?.verified_at ?? '', verified_by: c?.verified_by ?? '', notes: c?.notes ?? '' });
  const [assign, setAssign] = useState(false);
  const [kind, setKind] = useState('installation');
  const [target, setTarget] = useState('');
  const [allow, setAllow] = useState(false);
  const { data: installations, error: installationError } = useApiData<InstallationItem[]>(`/software/installations${product ? `?software_product_id=${product}` : ''}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <form className="resource-form" onSubmit={async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    const json = { ...fields, match_pattern: fields.match_pattern || null, verified_at: fields.verified_at || null,
      verified_by: fields.verified_by || null, notes: fields.notes || null,
      ...(c ? { expected_updated_at: c.updated_at } : { software_product_id: product,
        ...(assign ? { assign_to: { target_kind: kind, target_id: target, allow_version_mismatch: allow } } : {}) }) };
    try { await api(`/software/release-cycles${c ? `/${c.id}` : ''}`, { method: c ? 'PUT' : 'POST', json }); onSaved(); }
    catch (e) { setError(e); } finally { setSaving(false); }
  }}><fieldset disabled={saving}><legend>{c ? `${c.product_name} / ${c.cycle} を編集` : '系列を登録'}</legend><FormError error={error} />
    {!c && <ProductSelect value={product} onChange={(v) => { setProduct(v); setTarget(''); }} />}
    <TextField label="系列名" required maxLength={100} value={fields.cycle} onChange={(v) => setFields({ ...fields, cycle: v })} />
    <TextField label="照合規則（バージョン接頭辞、例: 1.24, 1.25。空欄は系列名を使用）" value={fields.match_pattern} onChange={(v) => setFields({ ...fields, match_pattern: v })} />
    <label>確認状態<select value={fields.verification_status} onChange={(e) => setFields({ ...fields, verification_status: e.target.value })}>
      {['unverified', 'verified', 'disputed'].map((v) => <option key={v}>{v}</option>)}
    </select></label>
    <TextField label="確認日時（ISO 8601・タイムゾーン必須。verified時の空欄はAPIで補完）" maxLength={50} value={fields.verified_at} onChange={(v) => setFields({ ...fields, verified_at: v })} />
    <TextField label="確認者（verified時の空欄は認証主体）" value={fields.verified_by} onChange={(v) => setFields({ ...fields, verified_by: v })} />
    <label>メモ<textarea maxLength={10000} value={fields.notes} onChange={(e) => setFields({ ...fields, notes: e.target.value })} /></label>
    {!c && <><label><input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} />作成と同時に資産へ割り当てる</label>
      {assign && <>
        <label>割当対象<select value={kind} onChange={(e) => { setKind(e.target.value); setTarget(''); }}>
          <option value="installation">導入ソフトウェア</option><option value="service_instance">サービス</option><option value="compute_os">コンピュートOS</option>
        </select></label>
        {kind === 'installation' ? <><FormError error={installationError} scope="mikke:read" /><label>導入ソフトウェア<select required value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">選択してください</option>{installations?.map((i) => <option key={i.id} value={i.id}>{i.compute_name} / {i.product_name} / {i.version ?? '版不明'} / {i.id}</option>)}
        </select></label></> : <ResourcePicker key={kind} label="割当先（同じ製品の稼働中資産）" types={[kind === 'compute_os' ? 'compute' : 'service_instance']} value={target} onChange={setTarget} />}
        <label><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />バージョン不一致を確認のうえ許可する</label>
      </>}
    </>}
    <div className="form-actions"><Button data-testid="form-submit" variant="primary">保存</Button><Button data-testid="dialog-cancel" type="button" onClick={onCancel}>キャンセル</Button></div>
  </fieldset></form>;
}

function EventForm({ cycle, event: ev, onSaved, onCancel }: {
  cycle: ReleaseCycle; event: LifecycleEvent | null; onSaved: (pending: boolean) => void; onCancel: () => void;
}) {
  const [type, setType] = useState('eol');
  const [fields, setFields] = useState({ event_date: ev?.event_date ?? '', source_url: ev && !urlHasCredentials(ev.source_url) ? ev.source_url : '', source_title: ev?.source_title ?? '',
    checked_at: ev?.checked_at ?? '', notes: ev?.notes ?? '', change_note: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <form className="resource-form" onSubmit={async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    const { change_note, ...values } = fields;
    try {
      const result = await api<{ pending_approval?: boolean }>(`/software/lifecycle-events${ev ? `/${ev.id}` : ''}`, {
        method: ev ? 'PUT' : 'POST', json: { ...values, source_title: values.source_title || null, notes: values.notes || null,
          ...(ev ? { expected_updated_at: ev.updated_at, change_note: change_note || null } : { release_cycle_id: cycle.id, event_type: type }) },
      }); onSaved(result.pending_approval === true);
    } catch (e) { setError(e); } finally { setSaving(false); }
  }}><fieldset disabled={saving}><legend>{cycle.product_name} / {cycle.cycle}：{ev ? `${ev.event_type} を編集` : 'イベントを登録'}</legend>
    <FormError error={error} />
    {!ev && <label>イベント種別<select value={type} onChange={(e) => setType(e.target.value)}>
      {['release', 'active_support_end', 'security_support_end', 'eol'].map((v) => <option key={v}>{v}</option>)}
    </select></label>}
    <TextField label="公式に明示された日付" required type="date" value={fields.event_date} onChange={(v) => setFields({ ...fields, event_date: v })} />
    {ev && fields.event_date !== ev.event_date && <p role="status">日付変更: {ev.event_date} → {fields.event_date || '未入力'}。mikke:eol:approve がない場合は承認待ちとなります。</p>}
    <TextField label="公式根拠URL（認証情報を含めない）" required type="url" credentialFreeUrl maxLength={2048} value={fields.source_url} onChange={(v) => setFields({ ...fields, source_url: v })} />
    <TextField label="根拠のタイトル" maxLength={1000} value={fields.source_title} onChange={(v) => setFields({ ...fields, source_title: v })} />
    <TextField label="根拠の確認日時（ISO 8601、例: 2026-11-22T09:00:00+09:00。未来不可）" required maxLength={50} value={fields.checked_at} onChange={(v) => setFields({ ...fields, checked_at: v })} />
    <label>メモ<textarea maxLength={10000} value={fields.notes} onChange={(e) => setFields({ ...fields, notes: e.target.value })} /></label>
    {ev && <label>変更理由・承認者への説明<textarea maxLength={10000} value={fields.change_note} onChange={(e) => setFields({ ...fields, change_note: e.target.value })} /></label>}
    <div className="form-actions"><Button data-testid="form-submit" variant="primary">保存</Button><Button data-testid="dialog-cancel" type="button" onClick={onCancel}>キャンセル</Button></div>
  </fieldset></form>;
}
