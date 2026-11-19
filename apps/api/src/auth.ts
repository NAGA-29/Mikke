import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { Scope, TokenEntry } from './config.js';
import { AppError } from './errors.js';

export interface Actor {
  id: string;
  scopes: ReadonlySet<Scope>;
}

export type AppEnv = { Variables: { actor: Actor } };

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** mikke:admin は全スコープを包含する */
export function hasScope(actor: Actor, scope: Scope): boolean {
  return actor.scopes.has(scope) || actor.scopes.has('mikke:admin');
}

/** Authorization: Bearer <token> を検証し actor をセットする。トークン自体はログ等に残さない */
export function authenticate(tokens: TokenEntry[]): MiddlewareHandler<AppEnv> {
  const entries = tokens.map((t) => ({ ...t, hash: Buffer.from(t.token_sha256, 'hex') }));
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m?.[1]) throw new AppError(401, 'unauthenticated', 'missing bearer token');
    const presented = Buffer.from(hashToken(m[1]), 'hex');
    const entry = entries.find((e) => timingSafeEqual(e.hash, presented));
    if (!entry) throw new AppError(401, 'unauthenticated', 'invalid token');
    c.set('actor', { id: entry.actor_id, scopes: new Set(entry.scopes) });
    await next();
  };
}

export function requireScope(scope: Scope): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!hasScope(c.get('actor'), scope)) {
      throw new AppError(403, 'insufficient_scope', `scope ${scope} is required`);
    }
    await next();
  };
}
