import { z } from 'zod';

export const SCOPES = ['mikke:read', 'mikke:write', 'mikke:eol:approve', 'mikke:admin'] as const;
export type Scope = (typeof SCOPES)[number];

const tokenEntrySchema = z.strictObject({
  actor_id: z.string().min(1).max(255),
  token_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  scopes: z.array(z.enum(SCOPES)).min(1),
});
export type TokenEntry = z.infer<typeof tokenEntrySchema>;

export interface Config {
  databaseUrl: string;
  port: number;
  tokens: TokenEntry[];
  eolWarningDays: number;
  eolStaleDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  let tokensRaw: unknown;
  try {
    tokensRaw = JSON.parse(env.MIKKE_API_TOKENS ?? '[]');
  } catch {
    throw new Error('MIKKE_API_TOKENS must be a JSON array');
  }
  const tokens = z.array(tokenEntrySchema).parse(tokensRaw);
  return {
    databaseUrl,
    port: Number(env.PORT ?? 8080),
    tokens,
    eolWarningDays: Number(env.MIKKE_EOL_WARNING_DAYS ?? 90),
    eolStaleDays: Number(env.MIKKE_EOL_STALE_DAYS ?? 180),
  };
}
