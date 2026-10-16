import { apiGet } from "./api";

/**
 * A tiny stale-check cache in front of `apiGet`.
 *
 * Every tab used to re-fetch the same account data: the top bar and the dock
 * each resolved the profile, the progress and studies pages each re-read usage
 * and the roster, and going back to a tab re-ran the whole boot sequence. The
 * backend sits in a different region from its database, so each of those calls
 * is expensive — collapsing them is what makes a tab feel instant.
 *
 * Two rules keep it correct:
 *
 *  - `token` is part of the cache key, so one account can never read another's
 *    cached row, and the badge/limit data can never cross a sign-in boundary.
 *  - Nothing here invents freshness: an entry is only reused inside its TTL, and
 *    mutating flows (analysing a game, creating a student) call
 *    `invalidateApiCache` so the next read is a real one.
 */

type Entry = { value: unknown; storedAt: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** Default reuse window. Short enough that counts refresh on their own. */
export const DEFAULT_TTL_MS = 30_000;

/** Reuse windows by intent, so call sites read the same everywhere. */
export const CACHE_TTL = {
  /** Plan, limits, roster: stable for a minute. */
  account: 60_000,
  /** Lists and derived reports: refresh quickly, but not on every navigation. */
  data: 20_000,
} as const;

const MAX_ENTRIES = 120;

export type ApiCacheOptions = {
  /** Override the reuse window for this call. */
  ttlMs?: number;
  /** Skip whatever is cached and fetch (still deduplicated with peers). */
  force?: boolean;
};

function cacheKey(path: string, token?: string): string {
  return `${token ?? "anonymous"}::${path}`;
}

function prune(): void {
  if (cache.size <= MAX_ENTRIES) {
    return;
  }
  const oldest = Array.from(cache.entries())
    .sort((a, b) => a[1].storedAt - b[1].storedAt)
    .slice(0, cache.size - MAX_ENTRIES);
  for (const [key] of oldest) {
    cache.delete(key);
  }
}

export function readApiCache<T>(path: string, token?: string, ttlMs = DEFAULT_TTL_MS): T | null {
  const entry = cache.get(cacheKey(path, token));
  if (!entry || Date.now() - entry.storedAt >= ttlMs) {
    return null;
  }
  return entry.value as T;
}

export function writeApiCache<T>(path: string, token: string | undefined, value: T): void {
  cache.set(cacheKey(path, token), { value, storedAt: Date.now() });
  prune();
}

/**
 * `apiGet`, but concurrent callers share one request and a fresh result is
 * reused for `ttlMs`.
 */
export function apiGetCached<T>(
  path: string,
  token?: string,
  options: ApiCacheOptions = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const key = cacheKey(path, token);

  if (!options.force) {
    const cached = readApiCache<T>(path, token, ttlMs);
    if (cached !== null) {
      return Promise.resolve(cached);
    }
    const pending = inflight.get(key);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const request = apiGet<T>(path, token)
    .then((value) => {
      cache.set(key, { value, storedAt: Date.now() });
      prune();
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === request) {
        inflight.delete(key);
      }
    });

  inflight.set(key, request);
  return request;
}

/** Drop entries whose key contains `pathPrefix` (omit it to clear everything). */
export function invalidateApiCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.includes(pathPrefix)) {
      cache.delete(key);
    }
  }
}

// Signing out (or switching accounts) must never leave another account's rows
// readable from memory for the rest of the tab's life.
if (typeof window !== "undefined") {
  const clear = () => invalidateApiCache();
  window.addEventListener("cm_auth_changed", clear);
  window.addEventListener("storage", clear);
}
