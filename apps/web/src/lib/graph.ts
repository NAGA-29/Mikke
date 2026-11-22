import { MarkerType, Position, type Edge, type Node, type Viewport } from '@xyflow/react';
import { RESOURCE_TYPE_LABEL, type ResourceType } from '../api';

export type EdgeKind = 'relation' | 'deployment' | 'hosting' | 'app_repository';
export interface Diagram { id: string; name: string; viewport: Partial<Viewport> }
export interface GraphNode {
  id: string; resource_id: string; name: string; resource_type: ResourceType;
  position_x: number; position_y: number; archived: boolean;
  /** 細分類（compute は asset_kind、service_instance は service_kind、他は null）。形状の出し分けにのみ使う */
  kind: string | null;
}
export interface GraphEdge {
  edge_kind: EdgeKind; edge_record_id: string; source_resource_id: string; target_resource_id: string;
  label: string; details: { environment?: string; status?: string; purpose?: string };
}
export interface Graph { diagram: Diagram; nodes: GraphNode[]; edges: GraphEdge[] }
export interface HiddenEdge { edge_kind: EdgeKind; edge_record_id: string }
export const EDGE_LABEL: Record<EdgeKind, string> = {
  relation: '依存・通信', deployment: 'デプロイ', hosting: 'ホスト', app_repository: 'アプリ↔Repo',
};
export const EDGE_COLOR: Record<EdgeKind, string> = {
  relation: 'var(--edge-relation)', deployment: 'var(--edge-deployment)', hosting: 'var(--edge-hosting)', app_repository: 'var(--edge-app-repository)',
};
export const NODE_COLOR: Record<ResourceType, string> = {
  compute: 'var(--node-compute)', application: 'var(--node-application)', service_instance: 'var(--node-service)', repository: 'var(--node-repository)',
};
export type NodeShape = 'server' | 'pill' | 'folder' | 'cylinder' | 'hexagon' | 'parallelogram' | 'double' | 'rounded';
/** 資産の種別（と細分類）から形状を決める。保存はせず表示時に導出する（正本は資産側） */
export function nodeShape(type: ResourceType, kind: string | null): NodeShape {
  if (type === 'compute') return 'server';
  if (type === 'application') return 'pill';
  if (type === 'repository') return 'folder';
  switch (kind) {
    case 'database': case 'storage': return 'cylinder';
    case 'cache': return 'hexagon';
    case 'queue': return 'parallelogram';
    case 'hosting': return 'double';
    default: return 'rounded';
  }
}

export type LineKind = 'solid' | 'dashed' | 'dotted' | 'wavy';
export type ArrowKind = 'closed' | 'open' | 'none';
export interface EdgeLook { line: LineKind; arrow: ArrowKind; width: number; dash?: string; legend: string }
/** 線種・矢印は関係の種類から導出する。凡例（canvas-legend）にも同じ表を使う */
export function edgeLook(e: Pick<GraphEdge, 'edge_kind' | 'label'>): EdgeLook {
  if (e.edge_kind === 'deployment') return { line: 'dashed', arrow: 'closed', width: 2, dash: '8 5', legend: '破線＋塗り矢印' };
  if (e.edge_kind === 'hosting') return { line: 'solid', arrow: 'none', width: 3.5, legend: '太線（矢印なし）' };
  if (e.edge_kind === 'app_repository') return { line: 'dotted', arrow: 'open', width: 2, dash: '2 5', legend: '点線＋開き矢印' };
  switch (e.label) {
    case 'publishes_to': case 'consumes_from': return { line: 'wavy', arrow: 'closed', width: 2, legend: '波線＋塗り矢印' };
    case 'depends_on': return { line: 'dashed', arrow: 'open', width: 2, dash: '3 3', legend: '短い破線＋開き矢印' };
    case 'uses': return { line: 'solid', arrow: 'open', width: 1.75, legend: '細線＋開き矢印' };
    default: return { line: 'solid', arrow: 'closed', width: 2, legend: '実線＋塗り矢印' };
  }
}
export const RELATION_LEGEND: { label: string; sample: Pick<GraphEdge, 'edge_kind' | 'label'> }[] = [
  { label: '接続（connects_to）', sample: { edge_kind: 'relation', label: 'connects_to' } },
  { label: '利用（uses）', sample: { edge_kind: 'relation', label: 'uses' } },
  { label: '依存（depends_on）', sample: { edge_kind: 'relation', label: 'depends_on' } },
  { label: '発行・購読（publishes_to / consumes_from）', sample: { edge_kind: 'relation', label: 'publishes_to' } },
  { label: 'デプロイ', sample: { edge_kind: 'deployment', label: 'deployed_on' } },
  { label: 'ホスト', sample: { edge_kind: 'hosting', label: 'hosted_on' } },
  { label: 'アプリ↔Repo', sample: { edge_kind: 'app_repository', label: 'sourced_from' } },
];

export type CanvasNode = Node<{ label: string; resource: GraphNode }>;
export type CanvasEdge = Edge<{ canonical: GraphEdge; lane: number; wavy: boolean }>;
export const edgeId = (edge: HiddenEdge) => `${edge.edge_kind}:${edge.edge_record_id}`;
export function graphToFlow(graph: Graph): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const pairKey = (e: GraphEdge) => [e.source_resource_id, e.target_resource_id].sort().join(':');
  const groups = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const key = pairKey(edge);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.resource_id, position: { x: n.position_x, y: n.position_y },
      type: 'asset',
      data: { label: `${RESOURCE_TYPE_LABEL[n.resource_type]}\n${n.name}${n.archived ? '\n⚠ アーカイブ済み・要確認' : ''}`, resource: n },
      sourcePosition: Position.Right, targetPosition: Position.Left,
      className: `canvas-node canvas-node-${n.resource_type}${n.archived ? ' canvas-node-archived' : ''}`,
    })),
    edges: graph.edges.map((e) => {
      const look = edgeLook(e);
      const inactive = e.details.status === 'inactive';
      return {
      id: edgeId(e), source: e.source_resource_id, target: e.target_resource_id,
      type: 'canonical',
      data: { canonical: e, lane: groups.get(pairKey(e))!.indexOf(e) - (groups.get(pairKey(e))!.length - 1) / 2, wavy: look.line === 'wavy' },
      label: `${EDGE_LABEL[e.edge_kind]}: ${e.label}${e.details.environment ? ` / ${e.details.environment}` : ''}${e.details.status ? ` / ${e.details.status}` : ''}${e.details.purpose ? ` / ${e.details.purpose}` : ''}`,
      // 無効（inactive）なデプロイは薄く表示し、線種は維持する
      style: { stroke: EDGE_COLOR[e.edge_kind], strokeWidth: look.width, strokeDasharray: look.dash, strokeLinecap: 'round' as const, opacity: inactive ? 0.45 : 1 },
      labelStyle: { fill: EDGE_COLOR[e.edge_kind] },
      markerEnd: look.arrow === 'none' ? undefined : { type: look.arrow === 'open' ? MarkerType.Arrow : MarkerType.ArrowClosed, color: EDGE_COLOR[e.edge_kind] },
      reconnectable: false,
      };
    }),
  };
}
// Suggestions only: users can choose any kind; the API validates the actual resource details.
export function suggestedConnectionKind(source: ResourceType, target: ResourceType): EdgeKind {
  if (source === 'application' && target === 'repository') return 'app_repository';
  if (source === 'service_instance' && target === 'compute') return 'hosting';
  if (source === 'application' && (target === 'compute' || target === 'service_instance')) return 'deployment';
  return 'relation';
}
export interface ConnectionFields { relationType: string; environment: string; purpose: string; repositoryId: string; status: string }
export function connectionCommand(kind: EdgeKind, source: string, target: string, fields: ConnectionFields) {
  switch (kind) {
    case 'relation': return { path: '/relations', method: 'POST', json: { source_resource_id: source, target_resource_id: target, relation_type: fields.relationType } };
    case 'deployment': return { path: '/deployments', method: 'POST', json: { application_id: source, target_resource_id: target, environment: fields.environment, repository_id: fields.repositoryId || null, status: fields.status } };
    case 'hosting': return { path: `/resources/${source}`, method: 'PATCH', json: { detail: { host_compute_id: target } } };
    case 'app_repository': return { path: '/application-repositories', method: 'POST', json: { application_id: source, repository_id: target, purpose: fields.purpose } };
  }
}
export function deleteEdgeCommand(edge: GraphEdge) {
  if (edge.edge_kind === 'hosting') return { path: `/resources/${edge.source_resource_id}`, method: 'PATCH', json: { detail: { host_compute_id: null } } };
  const paths = { relation: 'relations', deployment: 'deployments', app_repository: 'application-repositories' };
  return { path: `/${paths[edge.edge_kind]}/${edge.edge_record_id}`, method: 'DELETE' };
}
export function affectedDiagrams(graphs: Graph[], edge: GraphEdge) {
  return graphs.filter((g) => g.nodes.some((n) => n.resource_id === edge.source_resource_id)
    && g.nodes.some((n) => n.resource_id === edge.target_resource_id)).map((g) => ({
    id: g.diagram.id, name: g.diagram.name, visible: g.edges.some((e) => edgeId(e) === edgeId(edge)),
  }));
}
export function savedViewport(diagram: Diagram): Viewport | undefined {
  const { x, y, zoom } = diagram.viewport;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(zoom) && zoom! > 0
    ? { x: x!, y: y!, zoom: zoom! } : undefined;
}
