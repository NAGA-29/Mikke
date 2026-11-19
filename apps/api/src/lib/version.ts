/**
 * リリース系列の照合規則（設計 §4.9a「安全な限定構文」）
 *
 * - カンマ区切りの「バージョン接頭辞」のみ。例: "8.4", "16", "22.04", "1.24, 1.25"
 * - 末尾の ".*" / "*" は省略形として許容（"8.4.*" は "8.4" と同義）
 * - 接頭辞の後ろは区切り（. - + _ ~）か終端でなければならない（"16" は "160" に一致しない）
 * - 大文字小文字・先頭の "v" は無視
 * 任意の正規表現は受け付けない。match_pattern が NULL のときは cycle を接頭辞として使う。
 */
const TOKEN = /^[0-9a-z][0-9a-z.+_~-]*$/;
const MAX_ALTERNATIVES = 16;

const normalize = (s: string) => s.trim().toLowerCase().replace(/^v(?=\d)/, '');

export function parsePattern(pattern: string): string[] | null {
  const parts = pattern
    .split(',')
    .map((p) => normalize(p).replace(/\.?\*$/, ''))
    .filter((p) => p.length > 0);
  if (parts.length === 0 || parts.length > MAX_ALTERNATIVES) return null;
  return parts.every((p) => TOKEN.test(p) && p.length <= 100) ? parts : null;
}

export function isValidPattern(pattern: string): boolean {
  return parsePattern(pattern) !== null;
}

export function versionMatches(version: string | null | undefined, cycle: string, pattern?: string | null): boolean {
  if (!version) return false;
  const prefixes = parsePattern(pattern ?? cycle);
  if (!prefixes) return false;
  const v = normalize(version);
  return prefixes.some((p) => v === p || (v.startsWith(p) && /^[.+_~-]/.test(v.slice(p.length))));
}
