const KEY = 'mikke.token';

// 簡易ログイン：トークンは sessionStorage にのみ保持（タブを閉じると消える）。SSO導入時に差し替える
export const getToken = () => sessionStorage.getItem(KEY);
export const setToken = (t: string) => sessionStorage.setItem(KEY, t);
export const clearToken = () => sessionStorage.removeItem(KEY);

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? res.statusText, e?.details);
  }
  return data as T;
}

export type ResourceType = 'compute' | 'application' | 'service_instance' | 'repository';
export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  compute: 'コンピュート',
  application: 'アプリケーション',
  service_instance: 'サービス',
  repository: 'リポジトリ',
};

export interface Resource {
  id: string;
  resource_type: ResourceType;
  name: string;
  description: string | null;
  environment: string | null;
  lifecycle_status: 'active' | 'maintenance' | 'retired';
  archived_at: string | null;
  last_verified_at: string | null;
  updated_at: string;
  detail: Record<string, unknown> | null;
}
