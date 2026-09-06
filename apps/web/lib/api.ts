// Lightweight typed client for the CAS API.
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  code: string;
  suggestion?: string;
  constructor(code: string, message: string, suggestion?: string) {
    super(message);
    this.code = code;
    this.suggestion = suggestion;
  }
}

let token: string | null = null;
export function setToken(t: string | null) {
  token = t;
  if (typeof window !== 'undefined') {
    if (t) localStorage.setItem('cas_token', t);
    else localStorage.removeItem('cas_token');
  }
}
export function getToken(): string | null {
  if (token) return token;
  if (typeof window !== 'undefined') token = localStorage.getItem('cas_token');
  return token;
}

export function logout() {
  setToken(null);
  if (typeof window !== 'undefined') window.location.href = '/login';
}

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  if (!res.ok) {
    let err: any = null;
    try {
      err = await res.json();
    } catch { /* ignore */ }
    const e = err?.error;
    throw new ApiError(e?.code ?? 'INTERNAL', e?.message ?? `Request failed (${res.status})`, e?.suggestion);
  }
  if (raw) return res as unknown as T;
  const json = await res.json();
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** Fetch a file (image/audio/video) with auth, returning an object URL. */
  async file(path: string): Promise<string> {
    const headers: Record<string, string> = {};
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(`${API_BASE}${path}`, { headers });
    if (!res.ok) throw new ApiError('NOT_FOUND', 'Could not load this file — regenerate the asset.');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};
