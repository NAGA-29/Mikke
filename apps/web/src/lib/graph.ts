import { MarkerType, Position, type Edge, type Node, type Viewport } from '@xyflow/react';
import { RESOURCE_TYPE_LABEL, type ResourceType } from '../api';

export type EdgeKind = 'relation' | 'deployment' | 'hosting' | 'app_repository';
export interface Diagram { id: string; name: string; viewport: Partial<Viewport> }
export interface GraphNode {
  id: string; resource_id: string; name: string; resource_type: ResourceType;
  position_x: number; position_y: number; archived: boolean;
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
export type CanvasNode = Node<{ label: string; resource: GraphNode }>;
export type CanvasEdge = Edge<{ canonical: GraphEdge; lane: number }>;
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
      data: { label: `${RESOURCE_TYPE_LABEL[n.resource_type]}\n${n.name}${n.archived ? '\n⚠ アーカイブ済み・要確認' : ''}`, resource: n },
      sourcePosition: Position.Right, targetPosition: Position.Left,
      className: `canvas-node canvas-node-${n.resource_type}${n.archived ? ' canvas-node-archived' : ''}`,
      style: { background: NODE_COLOR[n.resource_type] },
    })),
    edges: graph.edges.map((e) => ({
      id: edgeId(e), source: e.source_resource_id, target: e.target_resource_id,
      type: 'canonical',
      data: { canonical: e, lane: groups.get(pairKey(e))!.indexOf(e) - (groups.get(pairKey(e))!.length - 1) / 2 },
      label: `${EDGE_LABEL[e.edge_kind]}: ${e.label}${e.details.environment ? ` / ${e.details.environment}` : ''}${e.details.status ? ` / ${e.details.status}` : ''}${e.details.purpose ? ` / ${e.details.purpose}` : ''}`,
      style: { stroke: EDGE_COLOR[e.edge_kind], strokeWidth: 2, strokeDasharray: e.details.status === 'inactive' ? '6 4' : undefined },
      labelStyle: { fill: EDGE_COLOR[e.edge_kind] },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR[e.edge_kind] },
      reconnectable: false,
    })),
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
