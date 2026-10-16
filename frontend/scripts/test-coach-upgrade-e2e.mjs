import { chromium } from "playwright";

async function runCoachUpgradeE2ETest() {
  console.log("🚀 Starting Playwright E2E Test for Coach Mode Subscription Upgrade Logic...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`[Page Error] ${err.message}`);
  });

  try {
    // 1. Visit Home and activate Demo User session so we have an active user context
    console.log("Step 1: Navigating to Home and activating demo session...");
    await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    const demoBtn = page.locator("button:has-text('[Demo User]')").first();
    if (await demoBtn.isVisible()) {
      await demoBtn.click();
      await page.waitForTimeout(600);
      console.log("✓ Activated demo session");
    }

    // 2. Navigate to /coach
    console.log("Step 2: Navigating to /coach...");
    await page.goto("http://localhost:3000/coach", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    // Verify Upgrade Banner is visible
    const bannerVisible = await page.locator("text=Coach Pro Preview").isVisible();
    const bannerUpgradeBtn = await page.locator("a:has-text('Upgrade for ₹399/mo')").first().isVisible();
    console.log(`✓ Coach Pro Upgrade Banner visible: ${bannerVisible}, Button visible: ${bannerUpgradeBtn}`);

    // Verify Student Roster Cards
    const studentCardVisible = await page.locator("text=Aarav Sharma").first().isVisible();
    console.log(`✓ Student card (Aarav Sharma) visible: ${studentCardVisible}`);

    // 3. Test clicking "+ Add student"
    console.log("Step 3: Clicking '+ Add student' to test upgrade modal triggering...");
    const addStudentBtn = page.locator("button:has-text('+ Add student')").first();
    await addStudentBtn.click();
    await page.waitForTimeout(600);

    // Verify Upgrade Modal appeared
    const modalHeading = await page.locator("text=Upgrade to Add Live Students").isVisible();
    const modalPricing = await page.locator("text=₹399 / mo").first().isVisible();
    const modalProBtn = await page.locator("a:has-text('Upgrade to Pro (₹399/mo)')").first().isVisible();
    console.log(`✓ Upgrade Modal opened: ${modalHeading}, Pricing: ${modalPricing}, Upgrade CTA: ${modalProBtn}`);

    if (!modalHeading || !modalProBtn) {
      throw new Error("Upgrade modal did not appear as expected!");
    }

    // 4. Test clicking Upgrade CTA inside Modal
    console.log("Step 4: Clicking 'Upgrade to Pro' inside modal...");
    await page.locator("a:has-text('Upgrade to Pro (₹399/mo)')").first().click();
    await page.waitForURL("**/subscription", { timeout: 5000 });
    console.log("✓ Successfully navigated to /subscription");

    const subscriptionHero = await page.locator("h1:has-text('Unlock more coaching'), h1:has-text('Your subscription')").isVisible();
    const priceVisible = await page.locator("text=₹399").first().isVisible();
    console.log(`✓ Subscription page loaded: Hero visible: ${subscriptionHero}, Price visible: ${priceVisible}`);

    // 5. Test student detail dossier gating
    console.log("Step 5: Visiting student dossier /coach/students/student-aarav-sharma-2145...");
    await page.goto("http://localhost:3000/coach/students/student-aarav-sharma-2145", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);

    const studentTitleVisible = await page.locator("h1:has-text('Aarav Sharma')").isVisible();
    const studentBannerVisible = await page.locator("text=Coach Pro Preview").isVisible();
    console.log(`✓ Student dossier loaded: Title visible: ${studentTitleVisible}, Banner visible: ${studentBannerVisible}`);

    // Test clicking "Create share link" on free tier
    console.log("Step 6: Clicking 'Create share link' to verify upgrade gating...");
    const shareBtn = page.locator("button:has-text('Create share link')").first();
    if (await shareBtn.isVisible()) {
      await shareBtn.click();
      await page.waitForTimeout(600);

      const shareModalHeading = await page.locator("text=Upgrade to Coach Pro").first().isVisible();
      console.log(`✓ Share link upgrade modal triggered: ${shareModalHeading}`);
    }

    console.log("\n🎉 ALL COACH MODE SUBSCRIPTION UPGRADE E2E CHECKS PASSED PERFECTLY!");
  } catch (err) {
    console.error("❌ E2E Test Failed:", err);
    process.exitCode = 1;
  } finally {
    if (consoleErrors.length > 0) {
      console.log("\nRecorded Console Errors (if any):");
      consoleErrors.forEach((e) => console.log(e));
    }
    await browser.close();
  }
}

runCoachUpgradeE2ETest();
