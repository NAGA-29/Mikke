import { useMemo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { CanvasEdge } from '../lib/graph';

/** 基準パスを標本化し、法線方向に正弦波を重ねた折れ線にする。両端は振幅0に絞り、矢印が正しい向きを向くようにする */
export function wavyPath(path: string, amplitude = 5, wavelength = 22, taper = 18): string {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  el.setAttribute('d', path);
  const total = el.getTotalLength();
  if (!Number.isFinite(total) || total < taper * 2) return path;
  const steps = Math.max(8, Math.ceil(total / 3));
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (total * i) / steps;
    const p = el.getPointAtLength(d);
    const a = el.getPointAtLength(Math.max(0, d - 1));
    const b = el.getPointAtLength(Math.min(total, d + 1));
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len; const ny = (b.x - a.x) / len;
    const envelope = Math.min(1, d / taper, (total - d) / taper);
    const off = amplitude * envelope * Math.sin((2 * Math.PI * d) / wavelength);
    points.push(`${i === 0 ? 'M' : 'L'} ${(p.x + nx * off).toFixed(2)},${(p.y + ny * off).toFixed(2)}`);
  }
  return points.join(' ');
}

export function CanonicalEdge(props: EdgeProps<CanvasEdge>) {
  const { sourceX, sourceY, targetX, targetY, data } = props;
  let [path, labelX, labelY] = getBezierPath(props);
  // Spread parallel and opposite-direction records so each canonical edge can be selected.
  if (data?.lane) {
    const bend = Math.max(80, Math.abs(targetX - sourceX) / 2);
    const offset = data.lane * 100;
    path = `M ${sourceX},${sourceY} C ${sourceX + bend},${sourceY + offset} ${targetX - bend},${targetY + offset} ${targetX},${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = (sourceY + targetY) / 2 + offset * 0.75;
  }
  const shown = useMemo(() => (data?.wavy ? wavyPath(path) : path), [data?.wavy, path]);
  return <BaseEdge id={props.id} path={shown} labelX={labelX} labelY={labelY} label={props.label}
    style={props.style} markerEnd={props.markerEnd} labelStyle={props.labelStyle}
    labelShowBg labelBgPadding={[6, 3]} labelBgBorderRadius={3} interactionWidth={20} />;
}
