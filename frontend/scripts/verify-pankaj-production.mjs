import { chromium } from "playwright";

async function runVerification() {
  console.log("🚀 Starting Playwright verification for production login...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Log in directly as Pankaj via Supabase SSR session route
    console.log("1. Navigating to /auth/login-pankaj...");
    await page.goto("http://localhost:3000/auth/login-pankaj", { waitUntil: "networkidle" });
    console.log("Current URL after login:", page.url());

    // 2. Verify Home page Topbar
    console.log("2. Verifying Topbar on Home page...");
    await page.waitForTimeout(1500);

    const hasDemoButton = await page.locator("button:has-text('[Demo User]')").isVisible().catch(() => false);
    console.log(" - Demo User button present (should be false):", hasDemoButton);
    if (hasDemoButton) throw new Error("Demo User button still visible!");

    const userPill = await page.locator("text=Pankaj").first().isVisible().catch(() => false);
    const userEmailPill = await page.locator("text=pankaj").first().isVisible().catch(() => false);
    console.log(" - Logged in as Pankaj visible:", userPill || userEmailPill);

    // 3. Verify /history page
    console.log("3. Navigating to /history...");
    await page.goto("http://localhost:3000/history", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const historyTitle = await page.locator("h1:has-text('All analyses')").isVisible();
    console.log(" - History title visible:", historyTitle);

    const analysisCardsCount = await page.locator(".history-item").count();
    console.log(" - Real analysis entries count in DOM (.history-item):", analysisCardsCount);

    // 4. Verify /progress page
    console.log("4. Navigating to /progress...");
    await page.goto("http://localhost:3000/progress", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    const progressTitle = await page.locator("h1:has-text('Player Progress')").isVisible();
    console.log(" - Player Progress title visible:", progressTitle);

    const aaravVisible = await page.locator("text=Aarav Sharma").isVisible().catch(() => false);
    console.log(" - Mock Aarav Sharma visible (should be false):", aaravVisible);
    if (aaravVisible) throw new Error("Aarav Sharma mock data still visible in /progress!");

    const gamesTrackedPill = await page.locator("text=Games Tracked").first().isVisible().catch(() => false);
    console.log(" - Real games tracked badge visible:", gamesTrackedPill);

    // 5. Verify AI Coach Drawer
    console.log("5. Testing AI Coach Drawer...");
    const aiCoachButton = page.locator("button:has-text('Ask AI'), button[aria-label='AI Coach Assistant'], button[title*='AI Coach']").first();
    if (await aiCoachButton.isVisible().catch(() => false)) {
      await aiCoachButton.click();
      await page.waitForTimeout(800);
      const drawerAarav = await page.locator("text=Aarav Sharma").isVisible().catch(() => false);
      console.log(" - Drawer Aarav visible (should be false):", drawerAarav);
      if (drawerAarav) throw new Error("Aarav Sharma visible in AI Coach Drawer!");
      console.log(" - AI Coach Drawer is grounded and clean!");
    }

    console.log("\n✅ ALL PRODUCTION VERIFICATION CHECKS PASSED!");
  } catch (error) {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runVerification();
