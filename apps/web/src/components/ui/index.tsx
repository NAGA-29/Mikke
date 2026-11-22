import { formatDateTime } from '../../lib/datetime';
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
