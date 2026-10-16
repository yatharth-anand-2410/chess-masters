/**
 * Behaviour check for `lib/api-cache.ts`.
 *
 * The cache sits in front of every account read the app makes, so its rules are
 * pinned here rather than trusted:
 *
 *  - concurrent callers share one request (the top bar and the dock both ask for
 *    the profile on every page);
 *  - a second call inside the TTL does not hit the network at all;
 *  - `force: true` always re-reads (used after an analysis changes the counts);
 *  - the token is part of the key, so one account can never read another's rows;
 *  - a failure is never cached, and `cm_auth_changed` empties the cache.
 *
 * The module is TypeScript, so the script compiles it with the project's own tsc
 * into a temp directory and drives the CommonJS output.
 *
 * Run with `npm run check:api-cache` from the frontend directory.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outDir = mkdtempSync(join(tmpdir(), "api-cache-check-"));
const listeners = new Map();

globalThis.window = {
  addEventListener: (type, handler) => {
    const bucket = listeners.get(type) ?? [];
    bucket.push(handler);
    listeners.set(type, bucket);
  },
  removeEventListener: () => {},
};

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/api-cache.ts",
      "lib/api.ts",
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );

  const require = createRequire(import.meta.url);
  const { apiGetCached, invalidateApiCache, CACHE_TTL } = require(
    join(outDir, "api-cache.js")
  );

  const failures = [];
  const check = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  let requests = [];
  let respond = () => ({ ok: true, json: async () => ({ ok: true }) });

  globalThis.fetch = (url, init) => {
    requests.push({ url, headers: (init ?? {}).headers ?? {} });
    return Promise.resolve(respond());
  };

  const reset = () => {
    requests = [];
    invalidateApiCache();
  };

  async function run() {
    // 1. concurrent callers share one request
    reset();
    const [a, b] = await Promise.all([
      apiGetCached("/api/account/profile", "token-a"),
      apiGetCached("/api/account/profile", "token-a"),
    ]);
    check(requests.length === 1, `concurrent reads made ${requests.length} requests, expected 1`);
    check(JSON.stringify(a) === JSON.stringify(b), "concurrent callers saw different payloads");

    // 2. a fresh entry is reused inside its TTL
    reset();
    await apiGetCached("/api/account/profile", "token-a");
    await apiGetCached("/api/account/profile", "token-a");
    check(requests.length === 1, `repeated reads made ${requests.length} requests, expected 1`);

    // 3. force always re-reads
    reset();
    await apiGetCached("/api/account/profile", "token-a", { force: true });
    check(requests.length === 1, "force:true did not re-read");
    await apiGetCached("/api/account/profile", "token-a");
    check(requests.length === 1, "the forced read was not stored for reuse");

    // 4. the token is part of the key: two accounts are two entries
    reset();
    await apiGetCached("/api/account/usage", "token-a");
    await apiGetCached("/api/account/usage", "token-b");
    check(
      requests.length === 2,
      "a different token was served the previous account's cached row"
    );

    // 5. prefix invalidation
    reset();
    await apiGetCached("/api/progress?days=30", "token-a");
    invalidateApiCache("/api/progress");
    await apiGetCached("/api/progress?days=30", "token-a");
    check(requests.length === 2, "invalidateApiCache did not drop the entry");

    // 6. failures are never cached
    reset();
    respond = () => ({ ok: false, status: 500, json: async () => ({ detail: "boom" }) });
    await apiGetCached("/api/account/usage", "token-a").catch(() => {});
    await apiGetCached("/api/account/usage", "token-a").catch(() => {});
    check(requests.length === 2, "a failed read was cached");
    respond = () => ({ ok: true, json: async () => ({ ok: true }) });

    // 7. signing out clears everything
    reset();
    await apiGetCached("/api/account/profile", "token-a");
    const authHandlers = listeners.get("cm_auth_changed") ?? [];
    check(authHandlers.length > 0, "the cache never subscribed to cm_auth_changed");
    authHandlers.forEach((handler) => handler());
    await apiGetCached("/api/account/profile", "token-a");
    check(requests.length === 2, "cm_auth_changed did not clear the cache");

    // 8. per-call TTL override
    reset();
    await apiGetCached("/api/batches", "token-a", { ttlMs: 0 });
    await apiGetCached("/api/batches", "token-a", { ttlMs: 0 });
    check(requests.length === 2, "ttlMs: 0 reused a cached entry");

    check(CACHE_TTL.account > CACHE_TTL.data, "account reads must outlive list reads");
  }

  await run();

  if (failures.length > 0) {
    console.error("api-cache check FAILED:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log("api-cache check passed (8 behaviours)");
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
