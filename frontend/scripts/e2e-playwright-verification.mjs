#!/usr/bin/env node
/**
 * Playwright end-to-end verification of the rebuilt Chessmasters surfaces.
 *
 * Covers (no session required — every surface is public and degrades honestly):
 *
 *   1. Global bottom dock          — desktop-only quick nav (no dev label, no sound
 *                                    control); sound ON/Muted lives in the topbar with
 *                                    persistence in localStorage (cm_sound_enabled).
 *   2. /tactics                    — live catalog grid from GET /api/tactics,
 *                                    or the honest fallback note + static motif grid.
 *   3. /subscription               — exactly two pricing cards: Pro Student ₹399
 *                                    and Master Coach ₹1,999.
 *   4. /studies                    — curated Lichess study cards, or the
 *                                    "Analyze 3+ games" empty state.
 *   5. /dev-preview (dev only)     — every scenario tab renders with no page errors.
 *
 * A missing backend is fine (surfaces fall back); a missing frontend server is a
 * SKIP. Only real assertion failures exit non-zero.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/e2e-playwright-verification.mjs
 */

import { chromium } from "playwright";
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
  `${RUN_ID}-playwright-verification`
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
    `📊 PLAYWRIGHT VERIFICATION SUMMARY — ${passCount} PASS · ${failCount} FAIL · ${skipCount} SKIP`
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

function skipRun(reason) {
  console.log(`\n⏭️  SKIPPED — ${reason}\n`);
  record("Playwright verification", "SKIP", reason.split("\n")[0]);
  finish();
}

async function serverReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function capture(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
  console.log(`   📸 ${name}.png`);
}

const DEV_PREVIEW_SCENARIOS = [
  {
    slug: "new",
    tab: "New report + replay instrument",
    expectTitle: "Tactical Collapse Under Time Panic",
    extraSelector: null,
  },
  {
    slug: "legacy",
    tab: "Legacy report (PGN fallback instrument)",
    expectTitle: "Italian Game",
    extraSelector: null,
  },
  {
    slug: "verdict-section",
    tab: "Verdict parsed from markdown",
    expectTitle: "Sicilian Defense",
    extraSelector: null,
  },
  {
    slug: "minimal",
    tab: "Minimal / broken parse",
    expectTitle: "Game dQ2mX8kF",
    extraSelector: ".review-workspace.is-solo",
  },
  {
    slug: "batch",
    tab: "Batch / multi-game report",
    expectTitle: "Multi-game report",
    extraSelector: ".review-games-overview",
  },
];

async function main() {
  console.log("🚀 Playwright E2E verification of the rebuilt Chessmasters surfaces");
  console.log(`   Target: ${BASE_URL}`);

  if (!(await serverReachable(BASE_URL))) {
    skipRun(
      `frontend server is not reachable at ${BASE_URL}.\n` +
        "   Start it (cd frontend && npm run dev) and retry."
    );
  }

  console.log(`   Screenshots: ${SCREENSHOT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    /* ---------------------------------------------------------------- */
    /* 1. Home + global bottom dock                                      */
    /* ---------------------------------------------------------------- */
    console.log("\n🔍 Home page & bottom dock (/)");
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    const dock = page.locator("nav.app-dock").first();
    const dockVisible = await dock.isVisible().catch(() => false);
    const dockLabelText = (
      (await dock
        .locator(".app-dock-label")
        .first()
        .textContent()
        .catch(() => "")) || ""
    ).trim();
    const dockButtonCount = await dock.locator("a.app-dock-btn").count();
    const dockSoundCount = await dock
      .locator("button[aria-pressed]")
      .count()
      .catch(() => 0);
    record(
      "Bottom dock: desktop-only quick nav (no dev label, no sound control)",
      dockVisible && dockLabelText === "" && dockSoundCount === 0 && dockButtonCount >= 4
        ? "PASS"
        : "FAIL",
      `dock: ${dockVisible}, label: "${dockLabelText}", page links: ${dockButtonCount}, dock sound controls: ${dockSoundCount}`
    );
    await capture(page, "01-home-dock");

    // Dock is phone-only chrome? No: phones use the hamburger. Hidden < 768px.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobileDock = page.locator("nav.app-dock").first();
    const mobileDockHidden =
      (await mobileDock.isHidden().catch(() => false)) ||
      (await mobileDock
        .evaluate((el) => getComputedStyle(el).display === "none")
        .catch(() => false));
    const bodyBottomPadding = await page
      .evaluate(() => getComputedStyle(document.body).paddingBottom)
      .catch(() => "");
    record(
      "Bottom dock hidden on mobile (hamburger owns navigation)",
      mobileDockHidden && bodyBottomPadding === "0px" ? "PASS" : "FAIL",
      `dock hidden: ${mobileDockHidden}, body padding-bottom: ${bodyBottomPadding}`
    );
    await capture(page, "01b-home-mobile-no-dock");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    // Sound ON / Muted toggle + localStorage persistence (topbar).
    const soundBtn = page.locator("header .sound-toggle").first();
    const pressedAttr = await soundBtn.getAttribute("aria-pressed").catch(() => "");
    const initialOn = pressedAttr === "true";
    const expectedStored = initialOn ? "0" : "1";

    await soundBtn.click();
    await page.waitForTimeout(300);
    const toggledPressed = await soundBtn.getAttribute("aria-pressed").catch(() => "");
    const storedAfterClick = await page.evaluate(() =>
      window.localStorage.getItem("cm_sound_enabled")
    );
    const labelToggled = toggledPressed === (initialOn ? "false" : "true");

    await page.reload({ waitUntil: "domcontentloaded" });
    const expectedPressed = initialOn ? "false" : "true";
    // The toggle syncs from storage right after hydration — poll for the
    // settled state instead of racing a fixed timeout.
    await page
      .waitForFunction(
        (pressed) =>
          document
            .querySelector("header .sound-toggle")
            ?.getAttribute("aria-pressed") === pressed,
        expectedPressed,
        { timeout: 8000 }
      )
      .catch(() => {});
    const reloadSoundBtn = page.locator("header .sound-toggle").first();
    const pressedAfterReload = await reloadSoundBtn
      .getAttribute("aria-pressed")
      .catch(() => "");
    const storedAfterReload = await page.evaluate(() =>
      window.localStorage.getItem("cm_sound_enabled")
    );
    const labelPersisted = pressedAfterReload === (initialOn ? "false" : "true");
    const persisted =
      storedAfterReload === expectedStored && labelPersisted && labelToggled;

    // Restore the original preference so the run leaves no side effects.
    await reloadSoundBtn.click();
    await page.waitForTimeout(200);

    record(
      "Sound toggle + persistence (cm_sound_enabled)",
      persisted ? "PASS" : "FAIL",
      `initial aria-pressed: "${pressedAttr}", after click: "${toggledPressed}" (localStorage=${JSON.stringify(
        storedAfterClick
      )}), after reload: "${pressedAfterReload}" (localStorage=${JSON.stringify(
        storedAfterReload
      )})`
    );

    /* ---------------------------------------------------------------- */
    /* 2. /tactics — live catalog or honest fallback                     */
    /* ---------------------------------------------------------------- */
    console.log("\n🔍 /tactics catalog & fallback");
    await page.goto(`${BASE_URL}/tactics`, { waitUntil: "domcontentloaded" });
    await page
      .locator("h1", { hasText: "Chess tactics map" })
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .catch(() => {});
    // Wait for the catalog fetch to settle (real cards, fallback note, or timeout).
    await page
      .locator(".studies-tactic-card:not(.studies-skeleton), .studies-inline-note")
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(300);

    const tacticsH1 = await page
      .locator("h1", { hasText: "Chess tactics map" })
      .first()
      .isVisible()
      .catch(() => false);
    const liveCatalogCards = await page
      .locator(".studies-tactic-card:not(.studies-skeleton)")
      .count();
    const fallbackNoteVisible = await page
      .locator(".studies-inline-note")
      .first()
      .isVisible()
      .catch(() => false);
    const fallbackNoteText = (
      (await page
        .locator(".studies-inline-note")
        .first()
        .textContent()
        .catch(() => "")) || ""
    ).trim();
    const staticMotifCards = await page.locator(".tactics-grid .tactics-card").count();
    const stillLoading = await page.locator(".studies-skeleton").first().isVisible().catch(() => false);

    let tacticsStatus;
    let tacticsDetail = `h1: ${tacticsH1}, live catalog cards: ${liveCatalogCards}, fallback note: ${fallbackNoteVisible}, static motif cards: ${staticMotifCards}`;
    if (tacticsH1 && liveCatalogCards > 0) {
      tacticsStatus = "PASS";
      tacticsDetail += " (live catalog)";
    } else if (
      tacticsH1 &&
      fallbackNoteVisible &&
      /unavailable|no training themes/i.test(fallbackNoteText) &&
      staticMotifCards >= 2
    ) {
      tacticsStatus = "PASS";
      tacticsDetail += ` (honest fallback: "${fallbackNoteText.slice(0, 80)}…")`;
    } else if (tacticsH1 && stillLoading && liveCatalogCards === 0 && !fallbackNoteVisible) {
      tacticsStatus = "SKIP";
      tacticsDetail += " (catalog still loading — backend slow or unreachable)";
    } else {
      tacticsStatus = "FAIL";
    }
    record("/tactics renders catalog grid or honest fallback", tacticsStatus, tacticsDetail);
    await capture(page, "02-tactics");

    /* ---------------------------------------------------------------- */
    /* 3. /subscription — exactly two pricing cards                      */
    /* ---------------------------------------------------------------- */
    console.log("\n🔍 /subscription pricing cards");
    await page.goto(`${BASE_URL}/subscription`, { waitUntil: "domcontentloaded" });
    await page
      .locator(".subscription-plan-card")
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(300);

    const planCardCount = await page.locator(".subscription-plan-card").count();
    const studentCard = page.locator(".subscription-plan-card", {
      hasText: "Pro Student",
    }).first();
    const coachCard = page.locator(".subscription-plan-card", {
      hasText: "Master Coach",
    }).first();
    const studentCardVisible = await studentCard.isVisible().catch(() => false);
    const coachCardVisible = await coachCard.isVisible().catch(() => false);
    const studentPrice = (
      (await studentCard
        .locator(".subscription-plan-price")
        .first()
        .textContent()
        .catch(() => "")) || ""
    ).replace(/\s+/g, " ").trim();
    const coachPrice = (
      (await coachCard
        .locator(".subscription-plan-price")
        .first()
        .textContent()
        .catch(() => "")) || ""
    ).replace(/\s+/g, " ").trim();

    const subscriptionPassed =
      planCardCount === 2 &&
      studentCardVisible &&
      coachCardVisible &&
      studentPrice.includes("₹399") &&
      coachPrice.includes("₹1,999");
    record(
      "/subscription shows exactly two pricing cards (₹399 / ₹1,999)",
      subscriptionPassed ? "PASS" : "FAIL",
      `cards: ${planCardCount}, Pro Student: "${studentPrice}", Master Coach: "${coachPrice}"`
    );
    await capture(page, "03-subscription");

    /* ---------------------------------------------------------------- */
    /* 4. /studies — curated cards or empty state                        */
    /* ---------------------------------------------------------------- */
    console.log("\n🔍 /studies curated library");
    await page.goto(`${BASE_URL}/studies`, { waitUntil: "domcontentloaded" });
    await page
      .locator(".studies-empty, .studies-card:not(.studies-skeleton)")
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(300);

    const studiesTitle = await page
      .locator("h1", { hasText: "Curated Lichess Studies" })
      .first()
      .isVisible()
      .catch(() => false);
    const curatedCards = await page
      .locator(".studies-card:not(.studies-skeleton)")
      .count();
    const emptyStateVisible = await page.locator(".studies-empty").first().isVisible().catch(() => false);
    const emptyStateText = (
      (await page
        .locator(".studies-empty-title")
        .first()
        .textContent()
        .catch(() => "")) || ""
    ).trim();
    const studiesLoading = await page.locator(".studies-skeleton").first().isVisible().catch(() => false);

    let studiesStatus;
    let studiesDetail = `title: ${studiesTitle}, curated cards: ${curatedCards}, empty state: ${emptyStateVisible} ("${emptyStateText}")`;
    if (studiesTitle && curatedCards > 0) {
      studiesStatus = "PASS";
      studiesDetail += " (curated cards)";
    } else if (studiesTitle && emptyStateVisible && /analyze 3\+ games/i.test(emptyStateText)) {
      studiesStatus = "PASS";
      studiesDetail += " (empty state)";
    } else if (!curatedCards && !emptyStateVisible && studiesLoading) {
      studiesStatus = "SKIP";
      studiesDetail += " (still loading — backend slow or unreachable)";
    } else {
      studiesStatus = "FAIL";
    }
    record("/studies renders curated cards or the Analyze 3+ games empty state", studiesStatus, studiesDetail);
    await capture(page, "04-studies");

    /* ---------------------------------------------------------------- */
    /* 5. /dev-preview — every scenario tab, no page errors              */
    /* ---------------------------------------------------------------- */
    console.log("\n🔍 /dev-preview scenario harness");
    const devPreviewResponse = await page.goto(`${BASE_URL}/dev-preview`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(600);
    const devPreviewStatus = devPreviewResponse ? devPreviewResponse.status() : 0;
    const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";

    if (devPreviewStatus === 404 || /could not be found/i.test(bodyText)) {
      record(
        "/dev-preview scenarios render without page errors",
        "SKIP",
        "dev-preview is dev-mode only (404 in production builds)"
      );
    } else {
      const tabCount = await page.locator("button.toggle").count();
      const scenarioDetails = [];
      let allScenariosOk = tabCount === DEV_PREVIEW_SCENARIOS.length;

      for (const scenario of DEV_PREVIEW_SCENARIOS) {
        const errorsBefore = pageErrors.length;
        await page
          .locator("button.toggle", { hasText: scenario.tab })
          .first()
          .click();
        await page.waitForTimeout(450);

        const activeLabel = (
          (await page
            .locator("button.toggle.active")
            .first()
            .textContent()
            .catch(() => "")) || ""
        ).trim();
        const headerTitle = (
          (await page
            .locator(".review-game-header-title")
            .first()
            .textContent()
            .catch(() => "")) || ""
        ).trim();
        const workspaceVisible = await page
          .locator(".review-workspace")
          .first()
          .isVisible()
          .catch(() => false);
        const extraOk = scenario.extraSelector
          ? await page
              .locator(scenario.extraSelector)
              .first()
              .isVisible()
              .catch(() => false)
          : true;
        const newErrors = pageErrors.length - errorsBefore;

        const ok =
          activeLabel === scenario.tab &&
          headerTitle.includes(scenario.expectTitle) &&
          workspaceVisible &&
          extraOk &&
          newErrors === 0;
        if (!ok) allScenariosOk = false;
        scenarioDetails.push(
          `${scenario.slug}: ${
            ok
              ? "ok"
              : `FAIL (active="${activeLabel}", title="${headerTitle}", workspace=${workspaceVisible}, extra=${extraOk}, pageErrors=${newErrors})`
          }`
        );
        await capture(page, `05-dev-preview-${scenario.slug}`);
      }

      record(
        "/dev-preview scenarios render without page errors",
        allScenariosOk ? "PASS" : "FAIL",
        `${tabCount} tabs · ${scenarioDetails.join(" · ")}`
      );
    }

    /* ---------------------------------------------------------------- */
    /* Summary                                                           */
    /* ---------------------------------------------------------------- */
    if (pageErrors.length > 0) {
      console.log(`\n⚠️  ${pageErrors.length} uncaught page error(s) recorded:`);
      for (const error of pageErrors.slice(0, 5)) {
        console.log(`   - ${error}`);
      }
    }
    if (consoleErrors.length > 0) {
      console.log(`\nℹ️  ${consoleErrors.length} console error(s) recorded (shown for context):`);
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
  console.error("❌ Playwright verification crashed:", err);
  process.exit(1);
});
