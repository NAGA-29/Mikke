// 日時は API では UTC 等の ISO 8601（例: 2026-11-22T08:35:42.123456Z）で扱う。
// 画面では閲覧者のブラウザのロケール・タイムゾーンに変換して表示する（表示専用。
// 楽観ロックの expected_updated_at などは変換せず、API が返した文字列のまま送ること）。

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const dateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
});
const dateOnly = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });

/** タイムスタンプ（日時）をブラウザのタイムゾーンで表示用に整形する。解釈できない値はそのまま返す */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  if (!ISO_DATETIME.test(value)) return value; // 日付のみ（event_date 等）は変換しない
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateTime.format(d);
}

/** タイムスタンプを、ブラウザのタイムゾーンでの「日付」だけで表示する（一覧向け） */
export function formatLocalDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateOnly.format(d);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 → <input type="datetime-local" step="1"> の値（ブラウザのタイムゾーン、秒まで）。不正なら '' */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** datetime-local の値（ブラウザのタイムゾーンとして解釈）→ UTC の ISO 8601。空・不正なら '' */
export function fromLocalInputValue(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
