import { formatDateTime } from '../../lib/datetime';
import { Link, type LinkProps } from 'react-router-dom';
import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type TableHTMLAttributes } from 'react';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

const labels: Record<string, string> = {
  active: '稼働中', maintenance: 'メンテナンス', retired: '廃止', archived: 'アーカイブ済み', inactive: '停止中',
  eol: 'EOL', approaching_eol: '期限接近', supported: 'サポート中', unknown: '不明',
  pending: '承認待ち', approved: '承認済み', rejected: '却下', superseded: '置換済み',
};
export function Badge({ status = 'unknown', children }: { status?: string; children?: ReactNode }) {
  return <span className={`badge badge-${status in labels ? status : 'unknown'}`}>{children ?? labels[status] ?? status}</span>;
}

export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return <header className="page-heading"><h1>{title}</h1>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function EmptyState({ children = '該当するデータはありません。' }: { children?: ReactNode }) {
  return <div className="empty-state" role="status">{children}</div>;
}
export function LoadingState({ children = '読み込み中…' }: { children?: ReactNode }) {
  return <p className="loading-state" role="status" aria-live="polite">{children}</p>;
}
export function ErrorState({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`error ${className}`} role="alert" {...props} />;
}

export function DataTable({ children, 'aria-label': label, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  const id = useId();
  return <div className="data-table-scroll" role="region" aria-label={label ?? 'データ一覧'} tabIndex={0}>
    <table data-testid="list-table" aria-label={label} {...props} id={props.id ?? id}>{children}</table>
  </div>;
}

/** 日時をブラウザのタイムゾーンで表示する。ホバーで元の値（ISO 8601）を確認できる */
export function Time({ value }: { value: string | null | undefined }) {
  if (!value) return <>-</>;
  return <time dateTime={value} title={value}>{formatDateTime(value)}</time>;
}

// 外部ライブラリを使わない自前の線アイコン（24x24、stroke=currentColor）
const ICONS = {
  package: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  calendar: 'M7 3v3M17 3v3M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM4 9h16M9 14l2 2 4-4',
  clipboard: 'M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1zM6 5h12a1 1 0 011 1v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1zM9 11h6M9 15h6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg className="icon" aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>;
}

/** 他の画面へ移動するリンク。操作ボタンと区別できるよう、アイコンと矢印を付けた色付きの見た目にする */
export function LinkButton({ icon, children, className = '', ...props }: LinkProps & { icon: IconName }) {
  return <Link className={`button button-nav ${className}`} {...props}><Icon name={icon} /><span>{children}</span><Icon name="arrow" size={14} /></Link>;
}
