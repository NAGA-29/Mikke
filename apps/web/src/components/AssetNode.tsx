import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { RESOURCE_TYPE_LABEL } from '../api';
import { NODE_COLOR, nodeShape, type CanvasNode, type NodeShape } from '../lib/graph';
import { enumLabel } from '../lib/resourceFields';

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 92;
const W = NODE_WIDTH;
const H = NODE_HEIGHT;

/** 形状ごとの輪郭（viewBox は NODE_WIDTH x NODE_HEIGHT 固定。非等倍にしないので歪まない） */
function outline(shape: NodeShape): ReactNode {
  switch (shape) {
    case 'cylinder': // データベース・ストレージ
      return <>
        <path d={`M2 14 V${H - 14} A${W / 2 - 2} 12 0 0 0 ${W - 2} ${H - 14} V14 A${W / 2 - 2} 12 0 0 0 2 14 Z`} />
        <path d={`M2 14 A${W / 2 - 2} 12 0 0 0 ${W - 2} 14`} fill="none" />
      </>;
    case 'hexagon': // キャッシュ
      return <polygon points={`22,2 ${W - 22},2 ${W - 2},${H / 2} ${W - 22},${H - 2} 22,${H - 2} 2,${H / 2}`} />;
    case 'parallelogram': // キュー
      return <polygon points={`20,2 ${W - 2},2 ${W - 20},${H - 2} 2,${H - 2}`} />;
    case 'pill': // アプリケーション
      return <rect x="2" y="2" width={W - 4} height={H - 4} rx={(H - 4) / 2} />;
    case 'folder': // リポジトリ
      return <path d={`M2 8 a6 6 0 0 1 6 -6 H70 l12 12 H${W - 8} a6 6 0 0 1 6 6 V${H - 8} a6 6 0 0 1 -6 6 H8 a6 6 0 0 1 -6 -6 Z`} />;
    case 'double': // ホスティング（二重枠）
      return <><rect x="2" y="2" width={W - 4} height={H - 4} rx="10" /><rect x="8" y="8" width={W - 16} height={H - 16} rx="6" fill="none" /></>;
    case 'server': // コンピュート（上部にラック風の帯）
      return <><rect x="2" y="2" width={W - 4} height={H - 4} rx="4" /><path d={`M2 20 H${W - 2}`} fill="none" /></>;
    default: // その他
      return <rect x="2" y="2" width={W - 4} height={H - 4} rx="12" />;
  }
}

export function AssetNode({ data }: NodeProps<CanvasNode>) {
  const r = data.resource;
  const shape = nodeShape(r.resource_type, r.kind);
  const kindLabel = r.kind ? enumLabel(r.resource_type === 'compute' ? 'asset_kind' : 'service_kind', r.kind) : null;
  return <div className={`asset-node asset-node-${shape}${r.archived ? ' canvas-node-archived' : ''}`} data-shape={shape}>
    <Handle type="target" position={Position.Left} />
    <svg className="asset-node-shape" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ fill: NODE_COLOR[r.resource_type] }}>{outline(shape)}</svg>
    <div className={`asset-node-text${shape === 'server' ? ' asset-node-text-server' : ''}`}>
      <small>{RESOURCE_TYPE_LABEL[r.resource_type]}{kindLabel ? ` / ${kindLabel}` : ''}</small>
      <strong>{r.name}</strong>
      {r.archived && <small>⚠ アーカイブ済み・要確認</small>}
    </div>
    <Handle type="source" position={Position.Right} />
  </div>;
}
