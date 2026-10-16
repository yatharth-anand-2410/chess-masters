import { chromium } from "playwright";

async function runE2EVerification() {
  console.log("🚀 Starting Playwright End-to-End Verification of Chessmasters...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(`[Browser Console Error] ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`[Uncaught Page Error] ${err.message}`);
  });

  const testResults = [];

  // TEST 1: HOME PAGE & TOPBAR
  console.log("🔍 Testing Home Page (/)...");
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  const topbarExists = await page.locator("header").isVisible();
  const upgradeBtnExists = await page.locator("a:has-text('Upgrade to Pro')").first().isVisible();
  const googleBtnExists = await page.locator("button:has-text('Sign in')").first().isVisible();

  testResults.push({
    test: "Home Page & Navigation Bar",
    passed: topbarExists && upgradeBtnExists && googleBtnExists,
    details: `Topbar: ${topbarExists}, UpgradeBtn: ${upgradeBtnExists}, GoogleBtn: ${googleBtnExists}`,
  });
  await page.screenshot({ path: "e2e-screenshots/e2e_live_home.png" });

  // TEST 2: STUDENT PROGRESS & LEAKS (/progress)
  console.log("🔍 Testing Student Progress Dashboard (/progress)...");
  await page.goto("http://localhost:3000/progress", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  const personaCard = await page.locator("text=Aarav Sharma").first().isVisible();
  const movementMatrix = await page.locator("text=Movement Matrix").first().isVisible();
  const threePillars = await page.locator("text=What Has Improved").first().isVisible();
  const ghostRadar = await page.locator("svg").first().isVisible();

  testResults.push({
    test: "Student Progress & Telemetry",
    passed: personaCard && movementMatrix && threePillars && ghostRadar,
    details: `Persona: ${personaCard}, MovementMatrix: ${movementMatrix}, 3Pillars: ${threePillars}, Radar: ${ghostRadar}`,
  });
  await page.screenshot({ path: "e2e-screenshots/e2e_live_progress.png" });

  // TEST 3: CURATED STUDIES (/studies)
  console.log("🔍 Testing Curated Studies Library (/studies)...");
  await page.goto("http://localhost:3000/studies", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  const studiesHeader = await page.locator("h1:has-text('Curated Lichess Studies')").isVisible();
  const studyCards = await page.locator("text=Deflection & Decoy Traps").isVisible();

  testResults.push({
    test: "Curated Studies Library",
    passed: studiesHeader && studyCards,
    details: `Header: ${studiesHeader}, Cards: ${studyCards}`,
  });
  await page.screenshot({ path: "e2e-screenshots/e2e_live_studies.png" });

  // TEST 4: STUDY DETAIL & CHAPTER DRILL (/study/deflection-najdorf-842)
  console.log("🔍 Testing Interactive Study View (/study/deflection-najdorf-842)...");
  await page.goto("http://localhost:3000/study/deflection-najdorf-842", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  const chapter2Btn = page.locator("button:has-text('Chapter 2')");
  await chapter2Btn.click();
  await page.waitForTimeout(300);

  const drillPlayBtn = page.locator("button:has-text('Play:')");
  await drillPlayBtn.click();
  await page.waitForTimeout(300);

  const drillSuccess = await page.locator("text=Excellent!").isVisible();

  testResults.push({
    test: "Interactive Study & Drill Execution",
    passed: drillSuccess,
    details: `Drill solved feedback: ${drillSuccess}`,
  });
  await page.screenshot({ path: "e2e-screenshots/e2e_live_study_chapter.png" });

  // TEST 5: OPPONENT SCOUTING HUB & DOSSIER (/scout)
  console.log("🔍 Testing Opponent Scouting Hub & Dossier (/scout)...");
  await page.goto("http://localhost:3000/scout", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);

  const scoutHeading = await page.locator("h1:has-text('Opponent Scouting Dossier')").isVisible();
  await page.goto("http://localhost:3000/scout/Grandmaster_Opponent", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);

  const dossierPlayer = await page.locator("h1:has-text('Grandmaster_Opponent')").isVisible();
  const repertoireTree = await page.locator("text=Opening Repertoire Tree").isVisible();
  const leakCards = await page.locator("text=LEAK 1: CLOCK PANIC").isVisible();

  testResults.push({
    test: "Opponent Scouting Dossier",
    passed: scoutHeading && dossierPlayer && repertoireTree && leakCards,
    details: `Hub: ${scoutHeading}, Dossier: ${dossierPlayer}, Trie: ${repertoireTree}, Leaks: ${leakCards}`,
  });
  await page.screenshot({ path: "e2e-screenshots/e2e_live_scout_dossier.png" });

  // TEST 6: CONTEXT-AWARE AI COACH COPILOT DRAWER
  console.log("🔍 Testing Context-Aware AI Coach Drawer (⌘K)...");
  // Trigger drawer via keyboard shortcut or event
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("open-ai-coach-drawer"));
  });
  await page.waitForTimeout(500);

  const drawerVisible = await page.locator("text=AI Coach & Copilot").isVisible();
  const aaravContext = await page.locator("text=Aarav Sharma (2145 Elo)").isVisible();

  // Click a quick query chip: "Analyze this game's turning point"
  const chipTurningPoint = page.locator("button:has-text('Analyze this game')");
  if (await chipTurningPoint.isVisible()) {
    await chipTurningPoint.click();
    await page.waitForTimeout(600);
  }

  // Click a quick query chip: "Where am I making the most mistakes?"
  const chipMistakes = page.locator("button:has-text('Where am I making')");
  if (await chipMistakes.isVisible()) {
    await chipMistakes.click();
    await page.waitForTimeout(600);
  }

  testResults.push({
    test: "Context-Aware AI Copilot Drawer",
    passed: drawerVisible && aaravContext,
    details: `Drawer visible: ${drawerVisible}, Student Context: ${aaravContext}`,
  });
  await page.screenshot({ path: "e2e-screenshots/e2e_live_ai_copilot_drawer.png" });

  await browser.close();

  console.log("\n=======================================================");
  console.log("📊 PLAYWRIGHT E2E EXECUTION REPORT");
  console.log("=======================================================");
  let allPassed = true;
  for (const r of testResults) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} - ${r.test} (${r.details})`);
    if (!r.passed) allPassed = false;
  }

  if (consoleErrors.length > 0) {
    console.log(`\n⚠️  Browser Console Warnings/Errors: ${consoleErrors.length}`);
    for (const err of consoleErrors.slice(0, 5)) {
      console.log(`  - ${err}`);
    }
  } else {
    console.log("\n✨ Zero browser console errors recorded!");
  }

  if (!allPassed) {
    process.exit(1);
  } else {
    console.log("\n🎉 ALL END-TO-END BROWSER TESTS PASSED PERFECTLY!");
    process.exit(0);
  }
}

runE2EVerification().catch((err) => {
  console.error("FATAL E2E ERROR:", err);
  process.exit(1);
});
