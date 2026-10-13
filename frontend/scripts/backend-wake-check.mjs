/**
 * Cold-start behaviour check for the deployed backend (free-tier Render).
 *
 * The retry in `streamPost` spends a player's analysis credit if it is wrong, so
 * the rules are pinned here instead of being trusted:
 *
 *  - a 502/503/504 from Render's edge (no `detail` body) never reached the app,
 *    so it is retried once;
 *  - an error our own app wrote (503 billing, 402 limits) is surfaced, never
 *    retried;
 *  - a fast network failure is retried, a slow one is not (it may have been
 *    charged already);
 *  - a sleeping backend is waited for *before* the POST that costs a credit.
 *
 * The modules are TypeScript, so the script compiles just those three files with
 * the project's own tsc into a temp directory and drives the CommonJS output.
 *
 * Run with `npm run check:backend-wake` from the frontend directory.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_ORIGIN = "https://cold-start-check.example";
process.env.NEXT_PUBLIC_API_URL = API_ORIGIN;

const outDir = mkdtempSync(join(tmpdir(), "backend-wake-check-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/backend-wake.ts",
      "lib/stream.ts",
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

  const store = new Map();
  globalThis.window = {
    setTimeout,
    clearTimeout,
    sessionStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
    },
  };

  const require = createRequire(import.meta.url);
  const { ensureBackendAwake, warmBackend, markBackendAwake, WAKE_TIMING } = require(
    join(outDir, "backend-wake.js")
  );
  const { streamPost, STREAM_TIMING } = require(join(outDir, "stream.js"));

  // Shorten the timings so the retry paths run in milliseconds.
  WAKE_TIMING.awakeTtlMs = 50;
  WAKE_TIMING.warmIntervalMs = 0;
  WAKE_TIMING.hintDelayMs = 5;
  WAKE_TIMING.scheduleMs = [0, 5, 10];
  WAKE_TIMING.budgetMs = 200;
  WAKE_TIMING.fastFailureMs = 5;
  STREAM_TIMING.fastFailureMs = 5;

  const failures = [];
  const check = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const jsonResponse = (status, body, headers = {}) => {
    const lines = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(lines, {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };

  let calls = [];
  let handler = () => jsonResponse(200, { status: "ok" });
  let fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    return handler(String(url), init);
  };
  globalThis.fetch = (...args) => fetchImpl(...args);

  /**
   * Clear the request log. Unless the case needs a sleeping backend, the
   * backend is marked awake so the pre-flight is skipped and the case under
   * test is the POST itself.
   */
  const reset = ({ cold = false } = {}) => {
    calls = [];
    store.clear();
    if (!cold) {
      markBackendAwake();
    }
  };

  /* 1. A cold probe is retried until the container answers. */
  reset({ cold: true });
  let probes = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    probes += 1;
    if (probes < 3) {
      // A 502 from the edge while booting arrives after a hold; the wait is the
      // signal that separates it from a request that never reached Render.
      await sleep(20);
      return jsonResponse(502, "<html>service starting</html>");
    }
    return jsonResponse(200, { status: "ok" });
  };
  let hinted = false;
  const awake = await ensureBackendAwake(() => {
    hinted = true;
  });
  check(awake === true, "ensureBackendAwake gave up while the container was still booting");
  check(probes === 3, `expected 3 probes before success, saw ${probes}`);
  check(hinted === true, "the player was never told the server was waking up");
  check(calls.every((call) => call.url.endsWith("/api/health")), "a probe did not use the health endpoint");

  /* 1b. A probe refused instantly (blocked origin, offline) is not retried for 90s. */
  reset({ cold: true });
  let instantProbes = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    instantProbes += 1;
    throw new TypeError("Failed to fetch");
  };
  const startedAt = Date.now();
  const instantResult = await ensureBackendAwake();
  check(instantResult === false, "an unreachable backend was reported as awake");
  check(
    instantProbes === WAKE_TIMING.instantRetries + 1,
    `expected ${WAKE_TIMING.instantRetries + 1} instant probes, saw ${instantProbes}`
  );
  check(
    Date.now() - startedAt < WAKE_TIMING.budgetMs,
    "an instantly-refused probe waited for the whole cold-start budget"
  );

  /* 2. A warm backend is not probed again. */
  reset();
  check((await ensureBackendAwake()) === true, "a known-warm backend was reported as asleep");
  check(calls.length === 0, `a known-warm backend was probed anyway (${calls.length} requests)`);

  /* 3. An edge failure is retried; the credit is spent on the retry only. */
  reset();
  let posts = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    if (String(url).endsWith("/api/health")) {
      return jsonResponse(200, { status: "ok" });
    }
    posts += 1;
    if (posts === 1) {
      return jsonResponse(502, "<html>bad gateway</html>");
    }
    return new Response('event: done\ndata: {"analysis_id":"a1"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  const events = [];
  await streamPost(`${API_ORIGIN}/api/stream-analysis`, "token", {}, {
    onEvent: (name) => events.push(name),
    onError: (message) => events.push(`error:${message}`),
  });
  check(posts === 2, `expected the edge failure to be retried once, saw ${posts} POSTs`);
  check(events.includes("done"), "the retried stream never delivered its events");
  check(!events.some((event) => event.startsWith("error:")), `the player saw an error: ${events.join(", ")}`);

  /* 4. Our app's own 503 is surfaced, never retried. */
  reset();
  posts = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    if (String(url).endsWith("/api/health")) {
      return jsonResponse(200, { status: "ok" });
    }
    posts += 1;
    return jsonResponse(503, { detail: "Payments are unavailable right now." });
  };
  const surfaced = [];
  await streamPost(`${API_ORIGIN}/api/stream-analysis`, "token", {}, {
    onEvent: () => undefined,
    onError: (message, code) => surfaced.push({ message, code }),
  });
  check(posts === 1, `an application error was retried (${posts} POSTs) — that can double-charge`);
  check(
    surfaced[0]?.message === "Payments are unavailable right now.",
    `the application error was replaced: ${JSON.stringify(surfaced[0])}`
  );

  /* 5. A fast network failure is retried, a slow one is not. */
  reset();
  posts = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    if (String(url).endsWith("/api/health")) {
      return jsonResponse(200, { status: "ok" });
    }
    posts += 1;
    if (posts === 1) {
      throw new TypeError("Failed to fetch");
    }
    return new Response('event: done\ndata: {}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  await streamPost(`${API_ORIGIN}/api/stream-analysis`, "token", {}, { onEvent: () => undefined });
  check(posts === 2, `a fast connection failure was not retried (${posts} POSTs)`);

  reset();
  posts = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    if (String(url).endsWith("/api/health")) {
      return jsonResponse(200, { status: "ok" });
    }
    posts += 1;
    await sleep(40);
    throw new TypeError("Failed to fetch");
  };
  const slowFailure = [];
  await streamPost(`${API_ORIGIN}/api/stream-analysis`, "token", {}, {
    onEvent: () => undefined,
    onError: (message) => slowFailure.push(message),
  });
  check(posts === 1, `a slow connection failure was retried (${posts} POSTs) — it may have been charged`);
  check(
    slowFailure[0] === "Lost connection to the server.",
    `a slow failure was reported as: ${slowFailure[0]}`
  );

  /* 6. A backend that never answers health gets no credit-spending POST at all. */
  reset({ cold: true });
  posts = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    posts += String(url).endsWith("/api/health") ? 0 : 1;
    return jsonResponse(502, "<html>starting</html>");
  };
  const never = [];
  await streamPost(`${API_ORIGIN}/api/stream-analysis`, "token", {}, {
    onEvent: () => undefined,
    onError: (message, code) => never.push({ message, code }),
  });
  check(posts === 0, `a credit-spending POST was sent to a backend that was not up (${posts})`);
  check(
    never[0]?.code === "backend_unreachable",
    `expected a backend_unreachable error, saw ${JSON.stringify(never[0])}`
  );

  /* 6b. Two edge failures in a row: one retry, then one honest message. */
  reset();
  posts = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    if (String(url).endsWith("/api/health")) {
      return jsonResponse(200, { status: "ok" });
    }
    posts += 1;
    return jsonResponse(503, "<html>no server</html>");
  };
  const exhausted = [];
  await streamPost(`${API_ORIGIN}/api/stream-analysis`, "token", {}, {
    onEvent: () => undefined,
    onError: (message, code) => exhausted.push({ message, code }),
  });
  check(posts === 2, `expected one retry before giving up, saw ${posts} POSTs`);
  check(
    exhausted[0]?.code === "backend_unreachable",
    `an exhausted retry was reported as ${JSON.stringify(exhausted[0])}`
  );

  /* 6c. Slow edge failures exhaust the budget without sending a POST. */
  reset({ cold: true });
  posts = 0;
  fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", init });
    await sleep(20);
    return jsonResponse(503, "<html>starting</html>");
  };
  const exhaustedBudget = [];
  await streamPost(`${API_ORIGIN}/api/stream-analysis`, "token", {}, {
    onEvent: () => undefined,
    onError: (message, code) => exhaustedBudget.push({ message, code }),
  });
  check(posts === 0, `a credit-spending POST was sent while the backend was booting (${posts})`);
  check(
    exhaustedBudget[0]?.code === "backend_unreachable",
    `an exhausted budget was reported as ${JSON.stringify(exhaustedBudget[0])}`
  );

  /* 7. Local development is left alone. */
  process.env.NEXT_PUBLIC_API_URL = "http://localhost:8000";
  delete require.cache[require.resolve(join(outDir, "api.js"))];
  delete require.cache[require.resolve(join(outDir, "backend-wake.js"))];
  const local = require(join(outDir, "backend-wake.js"));
  reset();
  local.warmBackend();
  await sleep(20);
  check(calls.length === 0, `local development pinged a hosted backend (${calls.length} requests)`);
  markBackendAwake();

  if (failures.length > 0) {
    console.error("backend wake check FAILED");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log("backend wake check PASSED (edge failures retried, app errors surfaced, credits never double-spent)");
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
