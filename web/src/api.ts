const BASE = import.meta.env.VITE_API_URL || '';

function headers(token?: string): HeadersInit {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function api<T = unknown>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    token?: string;
    query?: Record<string, string>;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const { method = 'GET', body, token, query, signal } = opts;
  let url = `${BASE}${path}`;
  if (query && Object.keys(query).length > 0) {
    url += '?' + new URLSearchParams(query).toString();
  }
  const res = await fetch(url, {
    method,
    headers: headers(token),
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });
  if (res.status === 204) return {} as T;
  const data = res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (await data) as { error?: string };
    throw new Error(err?.error || res.statusText);
  }
  return data as Promise<T>;
}

export type AuthRes = { token: string };
export type IngestTokenRes = { ingest_token: string };
