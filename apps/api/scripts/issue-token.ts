/**
 * APIトークンを発行する。生トークンは一度だけ標準エラーに表示し、
 * MIKKE_API_TOKENS に追記するエントリ（SHA-256 ハッシュのみ）を標準出力に出す。
 *
 *   pnpm --filter @mikke/api token agent:eol-researcher mikke:read mikke:write
 */
import { randomBytes } from 'node:crypto';
import { hashToken } from '../src/auth.js';
import { SCOPES, type Scope } from '../src/config.js';

const [actorId, ...scopes] = process.argv.slice(2);
if (!actorId || scopes.length === 0) {
  console.error('usage: issue-token <actor_id> <scope...>   scopes: ' + SCOPES.join(' '));
  process.exit(1);
}
const bad = scopes.filter((s) => !(SCOPES as readonly string[]).includes(s));
if (bad.length) {
  console.error(`unknown scope: ${bad.join(', ')}`);
  process.exit(1);
}
const token = `mikke_${randomBytes(32).toString('base64url')}`;
console.error(`token (store it securely, it is not shown again):\n${token}\n`);
console.log(JSON.stringify({ actor_id: actorId, token_sha256: hashToken(token), scopes: scopes as Scope[] }));
