#!/usr/bin/env node
/**
 * Coach flow E2E — Students nav, roster table, row → progress, Master Coach CTA.
 *
 * This script is session-optional by design:
 *
 *  - With no session configured it prints a clear SKIPPED message and exits 0.
 *  - With a session it verifies the rebuilt coach workflow:
 *      1. "Students" appears in the topbar for the coach role.
 *      2. The roster table renders             STUDENT / RATING / PRIMARY TACTICAL LEAK / HOMEWORK STATUS.
 *      3. Every roster row offers an "Analyze game" action.
 *      4. Clicking a roster row lands on /progress?student=<id>.
 *      5. The Master Coach card on /subscription shows "Upgrade to Coach Tier"
 *         (or "Contact us to upgrade" when the coach plan is not configured).
 *
 * The insecure demo login this script used previously (the deleted
 * /auth/login-pankaj route and its [Demo User] button) is gone; a session now
 * comes from one of:
 *
 *   E2E_STORAGE_STATE=/path/to/storage-state.json
 *       A Playwright storageState captured from a signed-in coach browser
 *       (cookies for the base URL origin). Also auto-detected at
 *       frontend/e2e-auth-state.json and frontend/scripts/.auth/coach.json.
 *
 *   E2E_COACH_EMAIL=... E2E_COACH_PASSWORD=...
 *       Supabase email/password sign-in (requires NEXT_PUBLIC_SUPABASE_URL and
 *       NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment or frontend/.env.local).
 *
 * Backend-unavailable and missing-session situations are SKIPs; only genuine
 * assertion failures exit non-zero.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/test-coach-upgrade-e2e.mjs
 */

import { chromium } from "playwright";
import { createClient as createSupabaseNodeClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(SCRIPT_DIR, "..");
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SCREENSHOT_DIR = path.join(
  FRONTEND_DIR,
  "e2e-screenshots",
  `${RUN_ID}-coach-e2e`
);

/* ------------------------------------------------------------------ */
/* Result bookkeeping                                                  */
/* ------------------------------------------------------------------ */

const results = [];

function record(test, status, details = "") {
  results.push({ test, status, details });
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⏭️";
  console.log(`${icon} ${status} — ${test}${details ? ` (${details})` : ""}`);
}

function finish() {
  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;

  console.log("\n=======================================================");
  console.log(
    `📊 COACH E2E SUMMARY — ${passCount} PASS · ${failCount} FAIL · ${skipCount} SKIP`
  );
  for (const r of results.filter((r) => r.status !== "PASS")) {
    console.log(
      `   ${r.status === "FAIL" ? "❌" : "⏭️"} ${r.test}${r.details ? ` — ${r.details}` : ""}`
    );
  }
  console.log(
    `   Screenshots: ${
      fs.existsSync(SCREENSHOT_DIR)
        ? SCREENSHOT_DIR
        : "(none — skipped before browser launch)"
    }`
  );
  console.log("=======================================================\n");
  process.exit(failCount > 0 ? 1 : 0);
}

/** Print the SKIP banner, record it, and exit 0 (missing session/backend/setup). */
function skipRun(reason) {
  console.log(`\n⏭️  SKIPPED — ${reason}\n`);
  record("Coach upgrade E2E", "SKIP", reason.split("\n")[0]);
  finish();
}

/* ------------------------------------------------------------------ */
/* Environment helpers                                                 */
/* ------------------------------------------------------------------ */

async function serverReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

function readEnvFile() {
  const map = {};
  try {
    const text = fs.readFileSync(path.join(FRONTEND_DIR, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      map[match[1]] = value;
    }
  } catch {
    // frontend/.env.local is optional.
  }
  return map;
}

function resolveSupabaseEnv() {
  const fileEnv = readEnvFile();
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  return url && key ? { url, key } : null;
}

/** @returns {{path: string}|{missing: string}|null} */
function resolveStorageState() {
  const explicit = process.env.E2E_STORAGE_STATE || process.env.E2E_AUTH_FILE || "";
  if (explicit) {
    const resolved = path.resolve(explicit);
    return fs.existsSync(resolved) ? { path: resolved } : { missing: resolved };
  }
  const candidates = [
    path.join(FRONTEND_DIR, "e2e-auth-state.json"),
    path.join(FRONTEND_DIR, "playwright", ".auth", "coach.json"),
    path.join(SCRIPT_DIR, ".auth", "coach.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { path: candidate };
  }
  return null;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function createSessionViaPassword(supabaseEnv, email, password) {
  const client = createSupabaseNodeClient(supabaseEnv.url, supabaseEnv.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await withTimeout(
    client.auth.signInWithPassword({ email, password }),
    20_000,
    "Supabase sign-in"
  );
  if (error || !data?.session) {
    return { error: error?.message || "Supabase returned no session" };
  }
  return { session: data.session };
}

/* ------------------------------------------------------------------ */
/* Session → cookie injection (mirrors @supabase/ssr storage)          */
/* ------------------------------------------------------------------ */

const COOKIE_CHUNK_SIZE = 3180; // mirrors @supabase/ssr MAX_CHUNK_SIZE

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * createBrowserClient from @supabase/ssr stores the session in cookies as
 * `sb-<project-ref>-auth-token` = "base64-" + base64url(JSON), chunked at
 * 3180 characters (".0", ".1", …) when oversized. The payload handed to the
 * chunker is already base64url, so encodeURIComponent is the identity and
 * slicing at that boundary matches the library exactly.
 */
function buildSupabaseAuthCookies(supabaseUrl, session, origin) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const encodedValue = `base64-${base64UrlEncode(JSON.stringify(session))}`;

  let chunks;
  if (encodedValue.length <= COOKIE_CHUNK_SIZE) {
    chunks = [{ name: storageKey, value: encodedValue }];
  } else {
    chunks = [];
    for (let i = 0; i * COOKIE_CHUNK_SIZE < encodedValue.length; i += 1) {
      chunks.push({
        name: `${storageKey}.${i}`,
        value: encodedValue.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE),
      });
    }
  }

  return chunks.map(({ name, value }) => ({
    name,
    value,
    url: origin,
    sameSite: "Lax",
    httpOnly: false,
    secure: origin.startsWith("https://"),
  }));
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function capture(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
  console.log(`   📸 ${name}.png`);
}

async function main() {
  console.log("🚀 Coach flow E2E (session-optional)");
  console.log(`   Target: ${BASE_URL}`);

  if (!(await serverReachable(BASE_URL))) {
    skipRun(
      `frontend server is not reachable at ${BASE_URL}.\n` +
        "   Start it (cd frontend && npm run dev) and retry."
    );
  }

  const supabaseEnv = resolveSupabaseEnv();
  const storageState = resolveStorageState();
  const email = process.env.E2E_COACH_EMAIL || process.env.E2E_EMAIL || "";
  const password =
    process.env.E2E_COACH_PASSWORD || process.env.E2E_PASSWORD || "";

  let authCookies = null;

  if (storageState && storageState.missing) {
    skipRun(
      `E2E_STORAGE_STATE was set but the file does not exist: ${storageState.missing}`
    );
  }

  if (!storageState && email && password) {
    if (!supabaseEnv) {
      skipRun(
        "coach credentials were provided but Supabase env is not available.\n" +
          "   Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (env or frontend/.env.local)."
      );
    }
    try {
      const result = await createSessionViaPassword(supabaseEnv, email, password);
      if (result.error) {
        skipRun(`Supabase password sign-in for ${email} failed: ${result.error}`);
      }
      authCookies = buildSupabaseAuthCookies(
        supabaseEnv.url,
        result.session,
        BASE_URL
      );
      console.log(
        `🔑 Signed in as ${email} (Supabase password grant); injected ${authCookies.length} auth cookie chunk(s).`
      );
    } catch (err) {
      skipRun(
        `Supabase password sign-in for ${email} could not run: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (!storageState && !authCookies) {
    // No session: capture the signed-out landing page as evidence, then skip.
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      await capture(page, "00-signed-out-home");
    } finally {
      await browser.close();
    }
    skipRun(
      "no coach session available — the coach flow cannot be exercised.\n" +
        `   Supabase env: ${
          supabaseEnv
            ? `configured (${supabaseEnv.url})`
            : "NOT configured (no NEXT_PUBLIC_SUPABASE_URL found)"
        }\n` +
        "   Provide a session with one of:\n" +
        "     • E2E_STORAGE_STATE=/path/to/storage-state.json  (cookies from a signed-in coach browser)\n" +
        "     • E2E_COACH_EMAIL=coach@example.com E2E_COACH_PASSWORD=…  (Supabase password sign-in)\n" +
        "   Auto-detected storage states: frontend/e2e-auth-state.json, frontend/scripts/.auth/coach.json"
    );
  }

  console.log(`   Screenshots: ${SCREENSHOT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const contextOptions = { viewport: { width: 1440, height: 1100 } };
    if (storageState?.path) {
      contextOptions.storageState = storageState.path;
      console.log(`🔑 Using storage state: ${storageState.path}`);
    }
    const context = await browser.newContext(contextOptions);
    if (authCookies) {
      await context.addCookies(authCookies);
    }
    const page = await context.newPage();

    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    /* Step 1 — Home (account role sanity, first screenshot) */
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    await capture(page, "01-home");
    if (new URL(page.url()).pathname === "/onboarding") {
      skipRun(
        "the session account has no role yet (redirected to /onboarding) — pick a role and rerun"
      );
    }

    /* Step 2 — Coach roster */
    console.log("\nStep 2: /coach roster");
    await page.goto(`${BASE_URL}/coach`, { waitUntil: "domcontentloaded" });
    await Promise.race([
      page
        .locator("section.students-panel")
        .first()
        .waitFor({ state: "visible", timeout: 12000 })
        .catch(() => {}),
      page
        .waitForURL((url) => url.pathname === "/", { timeout: 12000 })
        .catch(() => {}),
    ]);
    await page.waitForTimeout(800);

    if (new URL(page.url()).pathname === "/") {
      skipRun(
        "the app did not recognise a Supabase session (redirected /coach → /).\n" +
          "   The storage state / credentials may be expired or for another origin."
      );
    }
    await capture(page, "02-coach-roster");

    // 2a. Students nav visible for the coach role.
    const studentsNav = page.locator("header a", { hasText: "Students" }).first();
    const navVisible = await studentsNav.isVisible().catch(() => false);
    record(
      "Students nav visible for coach role",
      navVisible ? "PASS" : "FAIL",
      navVisible ? "topbar link 'Students' (→ /coach)" : "no 'Students' link in the topbar header"
    );

    // 2b. Master Coach preview banner (hidden once the coach tier is active).
    const banner = page.locator("text=Master Coach Preview").first();
    if (await banner.isVisible().catch(() => false)) {
      const bannerCta = page
        .locator('a.students-btn-gold', { hasText: "Upgrade to Coach Tier" })
        .first();
      const ctaVisible = await bannerCta.isVisible().catch(() => false);
      record(
        "Master Coach preview banner CTA",
        ctaVisible ? "PASS" : "FAIL",
        ctaVisible
          ? 'banner shows "Upgrade to Coach Tier" → /subscription'
          : "preview banner is visible but its upgrade CTA is missing"
      );
    } else {
      record(
        "Master Coach preview banner",
        "SKIP",
        "no preview banner — account already holds the Master Coach tier"
      );
    }

    // 2c. Roster table: headers, per-row action, row → /progress?student=
    const rosterTable = page.locator("table.students-table");
    if (!(await rosterTable.isVisible().catch(() => false))) {
      const backendError = await page
        .locator(".error-banner")
        .first()
        .innerText()
        .catch(() => "");
      if (backendError) {
        record(
          "Student roster table",
          "SKIP",
          `backend unavailable — roster fetch failed ("${backendError.trim()}")`
        );
      } else if (await page.getByText("No students yet").first().isVisible().catch(() => false)) {
        record(
          "Student roster table",
          "SKIP",
          "coach account has no students yet — add one to exercise roster assertions"
        );
      } else {
        record(
          "Student roster table",
          "FAIL",
          "roster table did not render and neither the error banner nor the empty state appeared"
        );
      }
    } else {
      const expectedHeaders = [
        "STUDENT",
        "RATING",
        "PRIMARY TACTICAL LEAK",
        "HOMEWORK STATUS",
      ];
      const missingHeaders = [];
      for (const header of expectedHeaders) {
        const visible = await page
          .locator("table.students-table thead th", { hasText: header })
          .first()
          .isVisible()
          .catch(() => false);
        if (!visible) missingHeaders.push(header);
      }
      record(
        "Roster table headers (STUDENT / RATING / PRIMARY TACTICAL LEAK / HOMEWORK STATUS)",
        missingHeaders.length === 0 ? "PASS" : "FAIL",
        missingHeaders.length === 0
          ? "all four column headers present"
          : `missing: ${missingHeaders.join(", ")}`
      );

      const rows = page.locator("table.students-table tbody tr");
      const rowCount = await rows.count();

      let rowsMissingAction = 0;
      for (let i = 0; i < rowCount; i += 1) {
        const action = rows
          .nth(i)
          .locator('a:has-text("Analyze game"), button:has-text("Analyze game")');
        if ((await action.count()) === 0) rowsMissingAction += 1;
      }
      record(
        '"Analyze game" action on every roster row',
        rowCount > 0 && rowsMissingAction === 0 ? "PASS" : "FAIL",
        `${rowCount} row(s) · ${rowsMissingAction} missing the action`
      );

      // Clicking a row (not its links/buttons) must open /progress?student=<id>.
      const firstRow = rows.first();
      const nameLink = firstRow.locator("a.students-name").first();
      const href = (await nameLink.getAttribute("href").catch(() => "")) || "";
      const expectedStudentId = href.includes("student=")
        ? new URLSearchParams(href.split("?")[1] ?? "").get("student")
        : null;

      await firstRow.locator("td").nth(2).click();
      let landed = false;
      try {
        await page.waitForURL(
          (url) => url.pathname === "/progress" && url.searchParams.has("student"),
          { timeout: 8000 }
        );
        landed = true;
      } catch {
        // left `landed` false — the explicit URL assertion below reports it
      }
      const landedUrl = new URL(page.url());
      const idMatches =
        expectedStudentId === null ||
        landedUrl.searchParams.get("student") === expectedStudentId;
      record(
        "Clicking a roster row lands on /progress?student=",
        landed && idMatches ? "PASS" : "FAIL",
        `${landedUrl.pathname}${landedUrl.search}` +
          (idMatches ? "" : ` (expected student=${expectedStudentId})`)
      );
      await capture(page, "03-progress-student");
    }

    /* Step 3 — Master Coach card on /subscription */
    console.log("\nStep 3: /subscription Master Coach card");
    await page.goto(`${BASE_URL}/subscription`, { waitUntil: "domcontentloaded" });
    await page
      .locator(".subscription-plan-card")
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    await capture(page, "04-subscription");

    const coachCard = page.locator(".subscription-plan-card", {
      hasText: "Master Coach",
    }).first();
    if (!(await coachCard.isVisible().catch(() => false))) {
      record(
        "Master Coach card on /subscription",
        "FAIL",
        "no Master Coach plan card rendered"
      );
    } else {
      const actionText = (
        (await coachCard
          .locator(".subscription-plan-action")
          .innerText()
          .catch(() => "")) || ""
      )
        .trim()
        .replace(/\s+/g, " ");
      if (/upgrade to coach tier/i.test(actionText)) {
        record(
          "Master Coach card CTA",
          "PASS",
          `"${actionText}" (coach checkout configured)`
        );
      } else if (/contact us to upgrade/i.test(actionText)) {
        record(
          "Master Coach card CTA",
          "PASS",
          `"${actionText}" (coach plan not configured — contact fallback)`
        );
      } else if (/renewed via razorpay|active plan/i.test(actionText)) {
        record(
          "Master Coach card CTA",
          "SKIP",
          `account already on Master Coach ("${actionText}")`
        );
      } else {
        record(
          "Master Coach card CTA",
          "FAIL",
          `unexpected CTA "${actionText}" — expected "Upgrade to Coach Tier" or "Contact us to upgrade"`
        );
      }
    }

    /* Step 4 — uncaught page errors */
    record(
      "No uncaught page errors during the coach flow",
      pageErrors.length === 0 ? "PASS" : "FAIL",
      pageErrors.length === 0 ? "clean" : pageErrors.slice(0, 3).join(" | ")
    );

    if (consoleErrors.length > 0) {
      console.log(
        `\nℹ️  ${consoleErrors.length} console error(s) recorded (backend-dependent calls can produce these):`
      );
      for (const error of consoleErrors.slice(0, 5)) {
        console.log(`   - ${error}`);
      }
    }
  } finally {
    await browser.close();
  }

  finish();
}

main().catch((err) => {
  console.error("❌ Coach E2E crashed:", err);
  process.exit(1);
});
