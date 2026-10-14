import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const SCREENSHOT_DIR = path.resolve("./e2e-screenshots");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const issues = [];
const consoleLogs = [];
const pageErrors = [];

async function runAudit() {
  console.log("Launching Chromium headless...");
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    const type = msg.type();
    consoleLogs.push({ type, text });
    if (type === "error") {
      issues.push(`Console error on ${page.url()}: ${text}`);
    }
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    issues.push(`Page exception on ${page.url()}: ${err.message}`);
  });

  // 1. Desktop Home
  console.log("1. Testing Desktop Home...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01_desktop_home.png"), fullPage: false });

  // Check topbar layout
  const topbar = page.locator("header");
  const topbarDisplay = await topbar.evaluate((el) => {
    const brand = el.querySelector("a[href='/']");
    const desktopNav = el.querySelector("div.hidden.sm\\:flex");
    const mobileNav = el.querySelector("div.flex.sm\\:hidden");
    const desktopNavDisplay = desktopNav ? window.getComputedStyle(desktopNav).display : null;
    const mobileNavDisplay = mobileNav ? window.getComputedStyle(mobileNav).display : null;
    return { desktopNavDisplay, mobileNavDisplay };
  });
  console.log("Topbar display check (Desktop):", topbarDisplay);
  if (topbarDisplay.desktopNavDisplay !== "flex") {
    issues.push(`Desktop nav should be display: flex, got: ${topbarDisplay.desktopNavDisplay}`);
  }
  if (topbarDisplay.mobileNavDisplay !== "none") {
    issues.push(`Mobile nav button on desktop should be display: none, got: ${topbarDisplay.mobileNavDisplay}`);
  }

  // Check hero board visibility
  const heroBoard = page.locator(".hero-board");
  const heroBoardBox = await heroBoard.boundingBox();
  console.log("HeroBoard bounding box:", heroBoardBox);
  if (!heroBoardBox || heroBoardBox.width < 100 || heroBoardBox.height < 100) {
    issues.push(`Hero board is not properly rendered or has 0 size: ${JSON.stringify(heroBoardBox)}`);
  }

  // 2. Feature: 1-Click Sample Game
  console.log("2. Testing 1-Click Sample Game launcher...");
  const sampleBtn = page.getByText("Try sample game");
  if (await sampleBtn.isVisible()) {
    await sampleBtn.click();
    await page.waitForTimeout(400);
    const inputVal = await page.locator("input[placeholder*='lichess.org']").inputValue();
    console.log("Input value after clicking sample game:", inputVal);
    if (!inputVal.includes("lichess.org")) {
      issues.push("Sample game button clicked but URL input was not populated.");
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02_sample_game_filled.png") });
  } else {
    issues.push("✦ Try sample game button is not visible!");
  }

  // 3. Feature: Platform Toggle (Lichess -> Chess.com)
  console.log("3. Testing Platform Toggle to Chess.com...");
  const chesscomTab = page.getByRole("tab", { name: /Chess\.com/i });
  if (await chesscomTab.isVisible()) {
    await chesscomTab.click();
    await page.waitForTimeout(400);
    const usernameField = page.locator("input[placeholder*='username' i], input[id*='username' i]");
    const usernameVisible = await usernameField.isVisible();
    console.log("Chess.com username field visible:", usernameVisible);
    if (!usernameVisible) {
      issues.push("Switching to Chess.com did not reveal the Username input field.");
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03_chesscom_toggle.png") });
    // Switch back to Lichess
    await page.getByRole("tab", { name: /Lichess/i }).click();
    await page.waitForTimeout(300);
  } else {
    issues.push("Chess.com platform toggle tab not found!");
  }

  // 4. Feature: Add/Remove game rows
  console.log("4. Testing Add another game row...");
  const addGameBtn = page.getByText("+ Add another game");
  const isDisabled = await addGameBtn.isDisabled();
  console.log("+ Add another game button disabled for guest:", isDisabled);
  if (!isDisabled) {
    await addGameBtn.click();
    await page.waitForTimeout(300);
    const count = await page.locator("input[placeholder*='lichess.org']").count();
    console.log("Input count after Add Game:", count);
    if (count !== 2) {
      issues.push(`Expected 2 game inputs after clicking Add, found: ${count}`);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "04_batch_two_rows.png") });
  } else {
    console.log("Verified: + Add another game is correctly gated for single guest analysis.");
  }

  // 5. Mobile Viewport (390x844) & Mobile Drawer Navigation
  console.log("5. Testing Mobile Viewport (390x844)...");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await mobilePage.screenshot({ path: path.join(SCREENSHOT_DIR, "05_mobile_home.png") });

  const mobileNavDisplay = await mobilePage.locator("header").evaluate((el) => {
    const desktopNav = el.querySelector("div.hidden.sm\\:flex");
    const mobileNav = el.querySelector("div.flex.sm\\:hidden");
    return {
      desktop: desktopNav ? window.getComputedStyle(desktopNav).display : null,
      mobile: mobileNav ? window.getComputedStyle(mobileNav).display : null,
    };
  });
  console.log("Topbar display check (Mobile 390px):", mobileNavDisplay);
  if (mobileNavDisplay.desktop !== "none") {
    issues.push(`On 390px mobile, desktop nav should be display: none, got: ${mobileNavDisplay.desktop}`);
  }

  // 6. Test Key Pages
  console.log("6. Testing Key Content Pages...");
  const pagesToTest = [
    { url: "http://localhost:3000/sample-report", name: "07_sample_report" },
    { url: "http://localhost:3000/history", name: "08_history" },
    { url: "http://localhost:3000/subscription", name: "09_subscription" },
    { url: "http://localhost:3000/coach", name: "10_coach" },
    { url: "http://localhost:3000/faq", name: "11_faq" },
    { url: "http://localhost:3000/about", name: "12_about" },
    { url: "http://localhost:3000/terms", name: "13_terms" },
    { url: "http://localhost:3000/privacy", name: "14_privacy" },
    { url: "http://localhost:3000/contact", name: "15_contact" },
  ];

  for (const item of pagesToTest) {
    try {
      const res = await page.goto(item.url, { waitUntil: "networkidle" });
      const status = res ? res.status() : null;
      console.log(`Page ${item.name} (${item.url}) status:`, status);
      if (status && status >= 400) {
        issues.push(`Page ${item.url} returned HTTP ${status}`);
      }
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${item.name}.png`), fullPage: false });
    } catch (e) {
      issues.push(`Error loading ${item.url}: ${e.message}`);
    }
  }

  // 7. Interactive Drills & Accordions on Sample Report
  console.log("7. Testing Sample Report Drills & Accordions...");
  await page.goto("http://localhost:3000/sample-report", { waitUntil: "networkidle" });
  const drillCard = page.locator(".drill-card").first();
  if (await drillCard.isVisible()) {
    const drillTitle = await drillCard.locator("h3, h4").first().textContent();
    console.log("First drill found:", drillTitle);
    const expandBtn = drillCard.locator("button:has-text('Solve drill'), button:has-text('View solution')").first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "16_sample_report_drill_expanded.png") });
    }
  }

  // 8. Test Live Analysis Pipeline on Sample Game
  console.log("8. Testing Live Analysis Pipeline on Home...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.getByText("Try sample game").click();
  await page.waitForTimeout(300);
  
  const analyzeBtn = page.getByRole("button", { name: "Analyze game" });
  if (await analyzeBtn.isVisible()) {
    console.log("Clicking 'Analyze game'...");
    await analyzeBtn.click();
    // Wait for pipeline status indicator to appear
    try {
      await page.waitForSelector(".analysis-pipeline, .status-slot", { timeout: 8000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "17_pipeline_in_progress.png") });
      console.log("Captured pipeline in progress screenshot!");
    } catch (e) {
      console.log("Could not capture in-progress pipeline:", e.message);
    }
  }

  await browser.close();

  console.log("\n=================================");
  console.log("AUDIT SUMMARY:");
  console.log(`Total Issues Logged: ${issues.length}`);
  issues.forEach((iss, idx) => console.log(`  ${idx + 1}. ${iss}`));
  console.log("=================================\n");

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, "audit-report.json"),
    JSON.stringify({ issues, consoleLogs, pageErrors }, null, 2)
  );
}

runAudit().catch((err) => {
  console.error("Audit script failed:", err);
  process.exit(1);
});
