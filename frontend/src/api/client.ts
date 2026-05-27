// ============================================================
// API client — the single mock <-> live swap point
// ============================================================
// Every page reads its data through a hook (src/api/hooks/*), and every hook
// goes through `resolve()` below. Today `resolve()` returns mock data tagged
// with `source: 'mock'`. To go live, flip a single fetcher to hit `/api/...`
// (see `liveResolve` note) — the hooks and pages never change.
//
// The envelope mirrors the backend contract (src/api/contract.ts ApiEnvelope):
//   { source: 'mock' | 'live', data: T }
// so UI can render a "mock data" badge purely off `source`.

export type DataSource = 'mock' | 'live';

export interface ApiResult<T> {
  data: T;
  source: DataSource;
}

// Normalized client error. Hooks surface `.message` to the ErrorState UI.
export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Toggle for the future backend swap. When a real API exists, set this to true
// (or drive it from an env var) and implement `liveResolve` per endpoint.
const USE_LIVE = false;

// First-load latency so loading/skeleton states are actually exercisable in the
// mock build. Resolved promises are memoized per key, so this is paid once.
const FIRST_LOAD_DELAY_MS = 150;
const seen = new Set<string>();

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Resolve a mock value, tagging it as mock and adding artificial first-load
// latency. `loader` is a thunk so heavy data is only realized when requested.
export async function resolveMock<T>(key: string, loader: () => T): Promise<ApiResult<T>> {
  if (!seen.has(key)) {
    seen.add(key);
    await delay(FIRST_LOAD_DELAY_MS);
  }
  return { data: loader(), source: 'mock' };
}

// Live fetcher — wired later. Kept here so the swap is one place:
// replace the `resolveMock(...)` call inside a hook's queryFn with
// `resolveLive('/api/...')`, or flip USE_LIVE and route through `resolve`.
export async function resolveLive<T>(path: string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed');
  }
  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed (${res.status})`, res.status);
  }
  // Backend wraps payloads in { source, repo, data, note } (ApiEnvelope).
  const body = (await res.json()) as { source?: DataSource; data: T };
  return { data: body.data, source: body.source ?? 'live' };
}

// Unified entry: a hook passes the live `path` and a mock `loader`. While the
// backend is unbuilt we go through the mock; later, flip USE_LIVE.
export async function resolve<T>(
  key: string,
  path: string,
  loader: () => T,
): Promise<ApiResult<T>> {
  if (USE_LIVE) return resolveLive<T>(path);
  return resolveMock<T>(key, loader);
}
