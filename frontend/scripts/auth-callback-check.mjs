/**
 * Behaviour check for `lib/callback-url.ts`.
 *
 * The post-sign-in redirect has to survive the container's own Host header:
 * production once ended on `ERR_CONNECTION_REFUSED` because the browser was sent
 * to `https://0.0.0.0:8080/` after Google had already authenticated the player.
 * These cases pin the precedence that prevents it.
 *
 * Run with `npm run check:auth-callback` from the frontend directory.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = "https://www.chessmasterss.in";
const outDir = mkdtempSync(join(tmpdir(), "auth-callback-check-"));

try {
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/callback-url.ts",
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
  const { resolveCallbackBase } = require(join(outDir, "callback-url.js"));

  const failures = [];
  const scenario = (name, request, expected) => {
    const actual = resolveCallbackBase(request, SITE);
    if (actual !== expected) {
      failures.push(`${name}: got ${actual}, expected ${expected}`);
    }
  };

  const req = (url, headers) => ({
    url,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  });

  // The production failure: internal bind address, no forwarded host.
  scenario(
    "container bind address falls back to the canonical site",
    req("https://0.0.0.0:8080/auth/callback?code=x", { host: "0.0.0.0:8080" }),
    SITE
  );

  // A forwarded host (Vercel previews, proxies) wins.
  scenario(
    "x-forwarded-host is honoured",
    req("https://0.0.0.0:8080/auth/callback?code=x", {
      host: "0.0.0.0:8080",
      "x-forwarded-host": "chess-masters-phi.vercel.app",
    }),
    "https://chess-masters-phi.vercel.app"
  );

  // Hitting the Cloud Run URL directly should stay on that host.
  scenario(
    "a public host header is honoured",
    req("https://chessmasters-frontend-abc.a.run.app/auth/callback", {
      host: "chessmasters-frontend-abc.a.run.app",
    }),
    "https://chessmasters-frontend-abc.a.run.app"
  );

  // Local development keeps its own origin (and stays http).
  scenario(
    "localhost keeps its origin",
    req("http://localhost:3000/auth/callback?code=x", { host: "localhost:3000" }),
    "http://localhost:3000"
  );
  scenario(
    "127.0.0.1 keeps its origin",
    req("http://127.0.0.1:3000/auth/callback", { host: "127.0.0.1:3000" }),
    "http://127.0.0.1:3000"
  );

  // An already-absolute forwarded host must not become https://https://…
  scenario(
    "absolute forwarded host is normalised",
    req("https://0.0.0.0:8080/auth/callback", { "x-forwarded-host": "https://chessmasterss.in" }),
    "https://chessmasterss.in"
  );

  if (failures.length > 0) {
    console.error("auth-callback check FAILED:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log("auth-callback check passed (6 scenarios)");
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
