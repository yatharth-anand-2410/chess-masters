/**
 * IndexNow submission for the Chessmasters site.
 *
 * IndexNow notifies Bing (and other participating engines) about changed URLs.
 * Bing's index is the retrieval pipeline behind ChatGPT search, so keeping it
 * fresh matters for AI visibility. Run this after a deploy that changes pages:
 *
 *   node scripts/indexnow.mjs
 *
 * The matching key file must be live at /<KEY>.txt on the site.
 */

const KEY = "7b1e4c9a2f8d43e6b05a3c9d1f7e2a48";
const BASE = process.argv[2] ?? "https://www.chessmasterss.in";

const PATHS = [
  "/",
  "/chess-game-analyzer",
  "/chess-com-game-review-alternative",
  "/lichess-game-analysis",
  "/how-to-analyze-your-chess-games",
  "/sample-report",
  "/studies",
  "/tactics",
  "/scout",
  "/faq",
  "/subscription",
  "/about",
];

const main = async () => {
  const endpoint = "https://api.indexnow.org/indexnow";
  const body = {
    host: new URL(BASE).host,
    key: KEY,
    keyLocation: `${BASE}/${KEY}.txt`,
    urlList: PATHS.map((path) => `${BASE}${path}`),
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  console.log(`IndexNow responded ${response.status}: ${text || "(no body)"}`);
  if (!response.ok) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error("IndexNow submission failed:", error);
  process.exitCode = 1;
});
