import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { CanvasEdge } from '../lib/graph';

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
  return <BaseEdge id={props.id} path={path} labelX={labelX} labelY={labelY} label={props.label}
    style={props.style} markerEnd={props.markerEnd} labelStyle={props.labelStyle}
    labelShowBg labelBgPadding={[6, 3]} labelBgBorderRadius={3} interactionWidth={20} />;
}
