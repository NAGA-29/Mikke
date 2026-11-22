import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { affectedDiagrams, deleteEdgeCommand, EDGE_LABEL, type Diagram, type Graph, type GraphEdge } from '../lib/graph';
import { CanvasError } from './CanvasError';

export function EdgeDeleteDialog({ edge, sourceName, targetName, onDeleted, onClose }: {
  edge: GraphEdge; sourceName: string; targetName: string; onDeleted: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [impacts, setImpacts] = useState<ReturnType<typeof affectedDiagrams>>([]);
  const [usage, setUsage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true); setConfirmed(false); setError(null);
    async function load() {
      const diagrams: Diagram[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await api<Diagram[]>(`/diagrams?limit=100&offset=${offset}`, { signal });
        diagrams.push(...page);
        if (page.length < 100) break;
      }
      const graphs: Graph[] = [];
      // Bound concurrent reads, even for large diagram collections.
      for (let start = 0; start < diagrams.length; start += 5) {
        graphs.push(...await Promise.all(diagrams.slice(start, start + 5).map((d) => api<Graph>(`/graph?diagram_id=${d.id}`, { signal }))));
      }
      let used = 0;
      if (edge.edge_kind === 'app_repository') {
        const rows = await api<{ repository_id: string | null }[]>(`/deployments?application_id=${edge.source_resource_id}`, { signal });
        used = rows.filter((d) => d.repository_id === edge.target_resource_id).length;
      }
      if (!signal.aborted) { setImpacts(affectedDiagrams(graphs, edge)); setUsage(used); }
    }
    void load().catch((e) => { if (!signal.aborted) setError(e); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [edge, attempt]);
  async function remove() {
    setBusy(true); setError(null);
    try {
      if (edge.edge_kind === 'hosting') {
        const current = await api<{ detail: { host_compute_id?: string } }>(`/resources/${edge.source_resource_id}`);
        if (current.detail?.host_compute_id !== edge.target_resource_id) {
          throw new ApiError(409, 'host_changed', 'ホスト先が変更されています。キャンセルして図を再読み込みしてください。');
        }
      }
      const command = deleteEdgeCommand(edge);
      await api(command.path, command); onDeleted();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="canvas-dialog" aria-labelledby="edge-delete-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <h3 id="edge-delete-title">正本の関係を削除・解除</h3>
    <p>{sourceName} → {targetName} / {EDGE_LABEL[edge.edge_kind]} / {edge.label}</p>
    <p>正本ID: {edge.edge_record_id}</p>
    <p><strong>全図・MCPに反映されます。</strong>資産は残ります。{edge.edge_kind === 'hosting' ? 'サービスのホスト先を解除します。' : 'この正本レコードを削除します。'}全図の対応する非表示設定も削除されます。</p>
    {loading ? <p role="status">影響範囲を取得中…</p> : <>
      <p>両端の資産を配置している図（{impacts.length}件、取得時点）:</p>
      <ul>{impacts.map((d) => <li key={d.id}><Link to={`/diagrams/${d.id}`}>{d.name}</Link>（{d.visible ? '表示中' : '非表示または関係変更済み'}）</li>)}</ul>
      <p>その他の図でも、この関係を今後表示できなくなります。</p>
      {usage > 0 && <p>同じアプリ・Repoを参照するデプロイ: {usage}件。他の用途のリンクもない場合、APIは削除を409で拒否します。</p>}
    </>}
    <CanvasError error={error} />
    <div className="form-actions"><button disabled={busy || loading} onClick={() => setAttempt((n) => n + 1)}>影響範囲を再取得</button></div>
    <p><label><input type="checkbox" checked={confirmed} disabled={busy || loading || !!error} onChange={(e) => setConfirmed(e.target.checked)} /> 全図・MCPへの影響を確認しました</label></p>
    <div className="form-actions"><button disabled={busy || loading || !!error || !confirmed} onClick={() => void remove()}>正本を削除・解除</button>
      <button disabled={busy} onClick={onClose}>キャンセル</button></div>
  </dialog>;
}
