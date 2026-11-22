import { Button, LoadingState, PageHeader } from '../components/ui';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Background, Controls, MiniMap, ReactFlow, useNodesState, useEdgesState, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import { CanvasError } from '../components/CanvasError';
import { AssetNode } from '../components/AssetNode';
import { CanvasLegend } from '../components/CanvasLegend';
import { CanonicalEdge } from '../components/CanonicalEdge';
import { ConnectionDialog } from '../components/ConnectionDialog';
import { EdgeDeleteDialog } from '../components/EdgeDeleteDialog';
import { ResourcePicker } from '../components/ResourcePicker';
import { EDGE_LABEL, NODE_COLOR, edgeId, graphToFlow, savedViewport, type CanvasEdge, type CanvasNode, type Graph, type GraphEdge, type GraphNode, type HiddenEdge } from '../lib/graph';
import { usePlacementPersistence } from '../lib/usePlacementPersistence';

const edgeTypes = { canonical: CanonicalEdge };
const nodeTypes = { asset: AssetNode };

export function DiagramCanvas() {
  const { id } = useParams();
  return id ? <Canvas key={id} id={id} /> : null;
}
function Canvas({ id }: { id: string }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const [hidden, setHidden] = useState<HiddenEdge[]>([]);
  const [resourceId, setResourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [connection, setConnection] = useState<{ source: GraphNode; target: GraphNode } | null>(null);
  const [deleting, setDeleting] = useState<GraphEdge | null>(null);
  const flow = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const positions = usePlacementPersistence(id);
  const base = `/diagrams/${id}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void reload(controller.signal).catch((e) => { if (!controller.signal.aborted) setError(e); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, [id]);
  async function reload(signal?: AbortSignal) {
    const [next, hiddenRows] = await Promise.all([
      api<Graph>(`/graph?diagram_id=${id}`, { signal }), api<HiddenEdge[]>(`${base}/hidden-edges`, { signal }),
    ]);
    if (!mounted.current || signal?.aborted) return;
    const converted = graphToFlow(next);
    setGraph(next); setNodes(converted.nodes); setEdges(converted.edges); setHidden(hiddenRows);
    setSelectedNode(null); setSelectedEdge(null);
  }
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try {
      await positions.flush(); await action(); await reload();
    } catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function openCanonicalDialog(open: () => void) {
    setBusy(true); setError(null);
    try { await positions.flush(); if (mounted.current) open(); }
    catch (e) { if (mounted.current) setError(e); }
    finally { if (mounted.current) setBusy(false); }
  }
  function afterCanonicalChange() {
    setConnection(null); setDeleting(null);
    void mutate(async () => {});
  }
  const locked = busy || loading || !!connection || !!deleting;
  const name = (resourceId: string) => graph?.nodes.find((n) => n.resource_id === resourceId)?.name ?? resourceId;
  return <section className="canvas-page"><Link to="/diagrams">← 構成図一覧</Link>
    <PageHeader title={<>{graph?.diagram.name ?? '構成図'}</>} actions={<Button disabled={locked} onClick={() => { setLoading(true); void mutate(async () => {}).finally(() => setLoading(false)); }}>再読み込み</Button>} />
    <CanvasError error={error} /><CanvasError error={positions.error} />
    <div className="form-actions"><span role="status">{positions.status}</span>
      {!!positions.error && <Button disabled={locked} onClick={() => void mutate(async () => {})}>位置の保存を再試行</Button>}
      <Button disabled={locked || !graph} onClick={() => void mutate(async () => {
        const viewport = flow.current?.getViewport();
        if (viewport) await api(base, { method: 'PATCH', json: { viewport } });
      })}>現在の表示範囲を保存</Button></div>
    {loading && <LoadingState />}
    {graph && <>
      <p>右の端子から接続先の左の端子へドラッグして登録。ノード・線を選ぶと操作を表示します。位置はドラッグ後に自動保存されます。</p>
      <CanvasLegend />
      <div ref={surface} className="canvas-surface" aria-label="構成図 Canvas">
        <ReactFlow<CanvasNode, CanvasEdge> nodes={nodes} edges={edges} edgeTypes={edgeTypes} nodeTypes={nodeTypes}
          onInit={(instance) => { flow.current = instance; }}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            for (const change of changes) {
              if (change.type === 'position' && change.position && !change.dragging) {
                const node = nodes.find((n) => n.id === change.id);
                if (node) positions.queue(node.data.resource.id, change.position);
              }
            }
          }} onEdgesChange={onEdgesChange}
          onNodeDragStop={(_, node, dragged) => {
            for (const n of dragged.length ? dragged : [node]) positions.queue(n.data.resource.id, n.position);
          }}
          onNodeClick={(_, node) => { setSelectedNode(node.data.resource); setSelectedEdge(null); }}
          onEdgeClick={(_, edge) => { setSelectedEdge(edge.data?.canonical ?? null); setSelectedNode(null); }}
          onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null); }}
          onConnect={(c) => {
            const source = graph.nodes.find((n) => n.resource_id === c.source);
            const target = graph.nodes.find((n) => n.resource_id === c.target);
            if (source && target && !locked) void openCanonicalDialog(() => setConnection({ source, target }));
          }}
          nodesDraggable={!locked} nodesConnectable={!locked} edgesReconnectable={false}
          deleteKeyCode={null} multiSelectionKeyCode={null}
          defaultViewport={savedViewport(graph.diagram)} fitView={!savedViewport(graph.diagram)} minZoom={0.1} maxZoom={3}>
          <Background /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(n) => NODE_COLOR[graph.nodes.find((r) => r.resource_id === n.id)?.resource_type ?? 'compute']} />
        </ReactFlow>
      </div>
      {!nodes.length && <p>資産を配置して構成図を作成してください。</p>}
      <div className="canvas-actions">
        <form className="resource-form" onSubmit={(e) => { e.preventDefault(); void mutate(async () => {
          const bounds = surface.current?.getBoundingClientRect();
          const center = bounds && flow.current ? flow.current.screenToFlowPosition({
            x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2,
          }) : { x: 0, y: 0 };
          await api(`${base}/nodes`, { method: 'POST', json: { resource_id: resourceId, position_x: center.x, position_y: center.y } });
          setResourceId('');
        }); }}><fieldset disabled={locked}><legend>資産をこの図に配置</legend>
          <ResourcePicker label="資産" value={resourceId} onChange={setResourceId} />
          <Button variant="primary" data-testid="form-submit" disabled={!resourceId}>配置する</Button>
        </fieldset></form>
        {selectedNode && <div className="canvas-confirm"><h3>{selectedNode.name}</h3>
          {selectedNode.archived && <p>⚠ アーカイブ済み・要確認</p>}
          <p><Link to={`/resources/${selectedNode.resource_id}`}>資産詳細</Link></p>
          <p>この図の配置だけを除去します。資産・正本の関係は保持されます。</p>
          <Button variant="danger" disabled={locked} onClick={() => void mutate(() => api(`${base}/nodes/${selectedNode.id}`, { method: 'DELETE' }))}>この図から配置を除去</Button>
        </div>}
        {selectedEdge && <div className="canvas-confirm"><h3>{EDGE_LABEL[selectedEdge.edge_kind]}: {selectedEdge.label}</h3>
          <p>{name(selectedEdge.source_resource_id)} → {name(selectedEdge.target_resource_id)}</p>
          <p>「隠す」はこの図のみ。「正本の削除・解除」は全図・MCPに反映されます。</p>
          <div className="form-actions"><Button disabled={locked} onClick={() => void mutate(() => api(`${base}/hidden-edges`, {
            method: 'POST', json: { edge_kind: selectedEdge.edge_kind, edge_record_id: selectedEdge.edge_record_id },
          }))}>この図で隠す</Button>
          <Button variant="danger" disabled={locked} onClick={() => void openCanonicalDialog(() => setDeleting(selectedEdge))}>正本の削除・解除を確認</Button></div>
        </div>}
      </div>
      <details><summary>この図の非表示設定（{hidden.length}件）</summary><ul>{hidden.map((h) => <li key={edgeId(h)}>
        {EDGE_LABEL[h.edge_kind]} / {h.edge_record_id}{' '}
        <Button disabled={locked} onClick={() => void mutate(() => api(`${base}/hidden-edges/${h.edge_kind}/${h.edge_record_id}`, { method: 'DELETE' }))}>この図に再表示</Button>
      </li>)}</ul><p>両端の資産が配置されている場合に再表示されます。</p></details>
    </>}
    {connection && <ConnectionDialog {...connection} onSaved={afterCanonicalChange} onClose={() => setConnection(null)} />}
    {deleting && <EdgeDeleteDialog edge={deleting} sourceName={name(deleting.source_resource_id)} targetName={name(deleting.target_resource_id)} onDeleted={afterCanonicalChange} onClose={() => setDeleting(null)} />}
  </section>;
}
