import { Badge, Button, DataTable, EmptyState, LoadingState, PageHeader } from '../components/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { FormError } from '../components/FormError';
import { displaySourceUrl, useApiData } from '../components/SoftwareFields';

interface RequestItem {
  id: string; release_cycle_id: string; product_name: string; cycle: string; event_type: string; lifecycle_event_id: string;
  requested_by: string; created_at: string; status: string; request_note: string | null;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
  before_data: Record<string, string | null>; proposed_data: Record<string, string | null>;
}
const DIFF_FIELDS = { event_date: '日付', source_url: '根拠URL', source_title: '根拠タイトル', checked_at: '確認日時', notes: 'メモ' };

export function EolChangeRequests() {
  const [status, setStatus] = useState('pending');
  const [eventId, setEventId] = useState('');
  const [revision, setRevision] = useState(0);
  const params = new URLSearchParams(); if (status) params.set('status', status); if (eventId) params.set('lifecycle_event_id', eventId);
  const { data, error } = useApiData<RequestItem[]>(`/software/lifecycle-event-change-requests?${params}`, revision);
  const [selected, setSelected] = useState<{ request: RequestItem; decision: 'approve' | 'reject' } | null>(null);
  const [notice, setNotice] = useState('');
  return <section><PageHeader title="EOL 日付変更の承認キュー" />
    <p>承認・却下には mikke:eol:approve が必要です。依頼者本人は承認・却下できません。依頼者欄を確認し、別の担当者が決裁してください。</p>
    <div className="filters"><label>状態<select value={status} onChange={(e) => { setStatus(e.target.value); setSelected(null); }}>
      <option value="">すべて</option>{['pending', 'approved', 'rejected', 'superseded'].map((v) => <option key={v}>{v}</option>)}
    </select></label><label>イベントID<input value={eventId} onChange={(e) => { setEventId(e.target.value); setSelected(null); }} /></label>
      <Button onClick={() => { setSelected(null); setRevision((v) => v + 1); }}>再読み込み</Button></div>
    {notice && <p role="status">{notice}</p>}<FormError error={error} scope="mikke:read" />
    {selected && <DecisionForm key={`${selected.request.id}-${selected.decision}`} request={selected.request} decision={selected.decision}
      onCancel={() => setSelected(null)} onSaved={() => { setNotice('決裁しました。'); setSelected(null); setRevision((v) => v + 1); }} />}
    {!data && !error && <LoadingState />}
    {data?.map((r) => <section key={r.id} className="cycle-card"><h3>{r.product_name} / {r.cycle} / {r.event_type}</h3>
      <p>状態: <Badge status={r.status} /> / 依頼者: {r.requested_by} / 依頼日時: {r.created_at}</p>
      <p>イベントID: {r.lifecycle_event_id}</p><p className="preserve-lines">変更理由: {r.request_note ?? '-'}</p>
      <RequestDiff request={r} />
      <p>決裁者: {r.decided_by ?? '-'} / 決裁日時: {r.decided_at ?? '-'}</p><p className="preserve-lines">決裁メモ: {r.decision_note ?? '-'}</p>
      <div className="form-actions"><Link to="/software/release-cycles">系列・イベントを確認</Link>
        {r.status === 'pending' && <><Button disabled={!!selected} onClick={() => setSelected({ request: r, decision: 'approve' })}>承認</Button>
          <Button variant="danger" disabled={!!selected} onClick={() => setSelected({ request: r, decision: 'reject' })}>却下</Button></>}
      </div>
    </section>)}{data?.length === 0 && <EmptyState />}
  </section>;
}

function RequestDiff({ request: r }: { request: RequestItem }) {
  return <div className="reference-table"><DataTable aria-label="日付変更の比較"><thead><tr><th scope="col">項目</th><th scope="col">変更前（依頼時点）</th><th scope="col">提案</th></tr></thead><tbody>
    {Object.entries(DIFF_FIELDS).map(([key, label]) => <tr key={key}><th scope="row">{label}{r.before_data[key] !== r.proposed_data[key] && '（変更）'}</th>
      <td className="preserve-lines">{key === 'source_url' ? displaySourceUrl(r.before_data[key]) : r.before_data[key] ?? '-'}</td>
      <td className="preserve-lines">{key === 'source_url' ? displaySourceUrl(r.proposed_data[key]) : r.proposed_data[key] ?? '-'}</td></tr>)}
  </tbody></DataTable></div>;
}

function DecisionForm({ request, decision, onSaved, onCancel }: {
  request: RequestItem; decision: 'approve' | 'reject'; onSaved: () => void; onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <form className="resource-form" onSubmit={async (e) => {
    e.preventDefault(); setSaving(true); setError(null);
    try { await api(`/software/lifecycle-event-change-requests/${request.id}/${decision}`, { method: 'POST', json: { note: note || null } }); onSaved(); }
    catch (e) { setError(e); } finally { setSaving(false); }
  }}><fieldset disabled={saving}><legend>{decision === 'approve' ? '承認' : '却下'}の確認：{request.product_name} / {request.cycle} / {request.event_type}</legend>
    <p>依頼者: {request.requested_by} / 依頼ID: {request.id}</p><RequestDiff request={request} />
    <FormError error={error} scope="mikke:eol:approve" />
    <label>決裁メモ<textarea maxLength={10000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    <label><input type="checkbox" required />自分はこの依頼の依頼者ではなく、提案内容を確認しました</label>
    <div className="form-actions"><Button data-testid="dialog-confirm" variant={decision === 'approve' ? 'primary' : 'danger'}>{decision === 'approve' ? '承認して反映' : '却下を確定'}</Button><Button data-testid="dialog-cancel" type="button" onClick={onCancel}>キャンセル</Button></div>
  </fieldset></form>;
}
