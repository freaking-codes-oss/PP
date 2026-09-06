import { AppError } from '../errors';

// ---------------------------------------------------------------------------
// Classify failures from AI provider APIs into friendly, actionable results.
// This drives the "trying another provider…" messaging instead of surfacing
// raw status codes to creators.
// ---------------------------------------------------------------------------

export type FailureKind =
  | 'no-key'
  | 'rate-limited'
  | 'quota-exceeded'
  | 'auth-invalid'
  | 'bad-request'
  | 'provider-error'
  | 'network'
  | 'timeout'
  | 'model-unavailable';

export interface FailureDetail {
  kind: FailureKind;
  message: string; // plain-language
  suggestion: string;
}

export const FAILURE_SUGGESTIONS: Record<FailureKind, string> = {
  'no-key': 'Add an API key in Settings → AI providers, or let the demo mock handle it.',
  'rate-limited': 'Wait a moment — the router will try the next provider automatically.',
  'quota-exceeded': 'Free-tier quota may be used up. The router will fall back to another provider.',
  'auth-invalid': 'Check that the API key is correct and still active.',
  'bad-request': 'Try regenerating, or edit the content manually.',
  'provider-error': 'That provider hit an error. The router will try the next one.',
  network: 'Could not reach the provider. The router will try the next one.',
  timeout: 'The provider took too long to answer. The router will try the next one.',
  'model-unavailable': 'That model is unavailable right now — the router will fall back.',
};

export function classifyHttpError(e: unknown): FailureDetail {
  const err = e as { status?: number; body?: unknown; code?: string; name?: string; cause?: { code?: string } };
  const bodyText = (() => {
    try {
      return typeof err.body === 'string' ? err.body : JSON.stringify(err.body ?? '');
    } catch {
      return '';
    }
  })().toLowerCase();
  const kind: FailureKind = (() => {
    if (err.name === 'AbortError') return 'timeout';
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'ECONNRESET') return 'network';
    const status = err.status;
    if (!status) return 'network';
    if (status === 401 || status === 403) return 'auth-invalid';
    if (status === 429) return bodyText.includes('quota') || bodyText.includes('insufficient') ? 'quota-exceeded' : 'rate-limited';
    if (status === 404) return 'model-unavailable';
    if (status >= 500) return 'provider-error';
    if (status === 400) {
      if (bodyText.includes('quota') || bodyText.includes('billing') || bodyText.includes('credit')) return 'quota-exceeded';
      if (bodyText.includes('model') || bodyText.includes('not found') || bodyText.includes('unavailable')) return 'model-unavailable';
      return 'bad-request';
    }
    return 'provider-error';
  })();
  const detail = (() => {
    try {
      const parsed = typeof err.body === 'string' ? JSON.parse(err.body) : err.body;
      const msg = (parsed as any)?.error?.message ?? (parsed as any)?.message;
      return typeof msg === 'string' ? msg.slice(0, 300) : undefined;
    } catch {
      return undefined;
    }
  })();
  const msg = detail ? `${kind.replace(/-/g, ' ')} — ${detail}` : `${kind.replace(/-/g, ' ')} (HTTP ${err.status ?? 'network error'})`;
  return { kind, message: msg, suggestion: FAILURE_SUGGESTIONS[kind] };
}

export function toAppError(e: unknown): AppError {
  const f = classifyHttpError(e);
  if (f.kind === 'auth-invalid' || f.kind === 'no-key') {
    return new AppError({ code: 'UNAUTHORIZED', status: 502, userMessage: 'The AI provider rejected the key.', suggestion: f.suggestion, cause: e });
  }
  if (f.kind === 'rate-limited' || f.kind === 'quota-exceeded') {
    return new AppError({ code: f.kind === 'quota-exceeded' ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED', status: 502, userMessage: f.message, suggestion: f.suggestion, cause: e });
  }
  return new AppError({ code: 'PROVIDER_UNAVAILABLE', status: 502, userMessage: f.message, suggestion: f.suggestion, cause: e });
}

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number }): Promise<{ status: number; body: unknown; headers: Headers }> {
  const { timeoutMs = 60_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body, headers: res.headers };
}

export function isRetryableKind(kind: FailureKind): boolean {
  return ['rate-limited', 'quota-exceeded', 'provider-error', 'network', 'timeout', 'model-unavailable'].includes(kind);
}
