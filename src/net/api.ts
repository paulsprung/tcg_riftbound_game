/*
 * The server's JSON API (server/http.ts). A refusal (not enough coins, a
 * pack you don't have) comes back as an ApiError with the server's words.
 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new ApiError(out.error ?? `Server error (${res.status})`, res.status);
  return out;
}

// ---- a short message at the top of the screen when the server says no ----

export interface Notice { text: string; ok: boolean }
let notice: Notice | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** `ok`: good news (given, made); otherwise the server said no. */
export function showNotice(text: string, ok = false) {
  notice = { text, ok };
  clearTimeout(timer);
  timer = setTimeout(() => { notice = null; listeners.forEach((l) => l()); }, 4500);
  listeners.forEach((l) => l());
}

export const noticeStore = {
  get: () => notice,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
