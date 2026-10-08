export class ApiError extends Error {
  constructor(public status: number, public code: string, public params: Record<string, any> = {}, public fields: Record<string, string> = {}) {
    super(code);
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;
export const qs = (q: Query = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  let res: Response;
  try { res = await fetch(`/api${path}${qs(opts.query)}`, init); }
  catch { throw new ApiError(0, 'network'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.setup && !location.pathname.startsWith('/setup')) location.assign('/setup');
    if (res.status === 401 && data.error === 'session_ended') window.dispatchEvent(new Event('lsp:unauthorized'));
    if (res.status === 401 && (data.error === 'rider_session_ended' || data.error === 'portal_disabled') && path !== '/portal/me') window.dispatchEvent(new Event('lsp:rider-unauthorized'));
    throw new ApiError(res.status, data.error ?? 'server_error', data.params ?? {}, data.fields ?? {});
  }
  return data as T;
}
export const get = <T = any>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

// Downloads a file the API produces (exports, templates) under the name the server chose.
export async function download(path: string, query?: Query) {
  const res = await fetch(`/api${path}${qs(query)}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? 'server_error', data.params ?? {});
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? /filename="([^"]+)"/.exec(cd)?.[1] ?? 'download');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
