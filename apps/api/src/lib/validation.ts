import { z } from 'zod';
import { invalid } from '../errors.js';

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw invalid(
      'validation_failed',
      'request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const uuid = z.uuid();
export const optStr = (max: number) => z.string().trim().max(max).nullable().optional();
export const reqStr = (max: number) => z.string().trim().min(1).max(max);
export const timestamp = z.iso.datetime({ offset: true });
export const optTimestamp = timestamp.nullable().optional();
export const isoDate = z.iso.date();
export const environment = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/, 'lowercase slug such as prod / stg / dev');

export const httpUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'must be an http(s) URL without credentials');

// 認証情報・秘密鍵・パスワードをDBへ入れない（設計 §1-6）
const SECRET_KEY = /pass(word|wd)?|secret|token|private[_-]?key|api[_-]?key|credential|auth/i;

function findSecretKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => {
      const p = path ? `${path}.${k}` : k;
      return [...(SECRET_KEY.test(k) ? [p] : []), ...findSecretKeys(v, p)];
    });
  }
  return [];
}

export const attributes = z.record(z.string(), z.unknown()).superRefine((v, ctx) => {
  const keys = findSecretKeys(v);
  if (keys.length) {
    ctx.addIssue({ code: 'custom', message: `attributes must not contain credentials: ${keys.join(', ')}` });
  }
});

/** 接続先識別子。URL形式なら userinfo（user:pass@）や秘密っぽいクエリを禁止 */
export const endpoint = z
  .string()
  .trim()
  .max(1024)
  .refine((v) => !/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(v), 'endpoint must not contain credentials')
  .refine((v) => !/[?&](password|pass|pwd|token|secret|key)=/i.test(v), 'endpoint must not contain credentials');

export const ipAddress = z.union([z.ipv4(), z.ipv6()]);
