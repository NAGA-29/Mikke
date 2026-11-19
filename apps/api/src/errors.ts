export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 412 | 422 | 500,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id?: string) =>
  new AppError(404, 'not_found', id ? `${what} ${id} not found` : `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const invalid = (code: string, message: string, details?: unknown) => new AppError(422, code, message, details);
export const forbidden = (code: string, message: string, details?: unknown) => new AppError(403, code, message, details);

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
}

/** PostgreSQL の制約違反をAPIエラーに変換する（変換できなければ undefined） */
export function fromPgError(err: unknown): AppError | undefined {
  const e = err as PgError;
  if (!e || typeof e.code !== 'string') return undefined;
  const details = { constraint: e.constraint, detail: e.detail };
  switch (e.code) {
    case '23505':
      return conflict('unique_violation', 'a record with the same unique key already exists', details);
    case '23503':
      return invalid('reference_violation', 'referenced record does not exist or is still referenced', details);
    case '23514':
      return invalid('check_violation', 'value violates a database constraint', details);
    case '22P02':
    case '22007':
    case '22008':
      return invalid('invalid_value', 'invalid value format', details);
    default:
      return undefined;
  }
}
