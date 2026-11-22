import { EDGE_COLOR, RELATION_LEGEND, edgeLook } from '../lib/graph';
import { wavyPath } from './CanonicalEdge';

/** 線の見た目の凡例。描画側（edgeLook）と同じ定義から作るので食い違わない */
function Sample({ edge_kind, label }: { edge_kind: Parameters<typeof edgeLook>[0]['edge_kind']; label: string }) {
  const look = edgeLook({ edge_kind, label });
  const color = EDGE_COLOR[edge_kind];
  const line = 'M4,10 L52,10';
  const d = look.line === 'wavy' ? wavyPath(line, 3, 12, 8) : line;
  const head = look.arrow === 'closed' ? <path d="M52,10 L44,6 L44,14 Z" fill={color} stroke={color} />
    : look.arrow === 'open' ? <path d="M45,5 L52,10 L45,15" fill="none" stroke={color} strokeWidth={look.width} /> : null;
  return <svg width="58" height="20" viewBox="0 0 58 20" aria-hidden="true">
    <path d={d} fill="none" stroke={color} strokeWidth={look.width} strokeDasharray={look.dash} strokeLinecap="round" />{head}
  </svg>;
}

export function CanvasLegend() {
  return <div className="canvas-legend" aria-label="凡例">
    {RELATION_LEGEND.map(({ label, sample }) => <span key={label} className="legend-item">
      <Sample edge_kind={sample.edge_kind} label={sample.label} />{label}
    </span>)}
    <span className="legend-item legend-note">形状: 四角＝コンピュート／丸角＝アプリ／円柱＝DB・ストレージ／六角＝キャッシュ／平行四辺形＝キュー／二重枠＝ホスティング／フォルダ＝リポジトリ</span>
  </div>;
}
