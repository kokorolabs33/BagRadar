/**
 * verify-card.ts
 * Full pipeline: aggregate → scrape → real AI roast → render card.
 *
 * Run: npx tsx scripts/verify-card.ts [optional-mint]
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { aggregateToken } from "../server/aggregator.js";
import { scrapeAllLinks } from "../server/scraper.js";
import { generateRoast } from "../server/roast.js";
import { renderCard } from "../server/card.js";

const heliusApiKey = process.env.HELIUS_API_KEY!;
const bagsApiKey = process.env.BAGS_API_KEY!;
const openaiApiKey = process.env.OPENAI_API_KEY!;
const twitterAuthToken = process.env.TWITTER_AUTH_TOKEN;
const twitterCt0 = process.env.TWITTER_CT0;

if (!openaiApiKey) {
  console.error("OPENAI_API_KEY required for real AI roast");
  process.exit(1);
}

const MINT = process.argv[2] || "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OUT = "/tmp/bagradar-card.png";

async function main() {
  console.log("Full pipeline card generation for " + MINT + "\n");

  // Stage 1
  console.log("[1/4] Aggregating...");
  const t0 = Date.now();
  const analysis = await aggregateToken(MINT, { heliusApiKey, bagsApiKey });
  console.log("  " + (Date.now() - t0) + "ms — " + analysis.name + " (" + analysis.symbol + ")");

  // Stage 2
  console.log("[2/4] Scraping links...");
  const t1 = Date.now();
  const scraped = await scrapeAllLinks(
    {
      twitter: analysis.socials.twitter,
      website: analysis.socials.website,
      github: null,
    },
    { twitterAuthToken, twitterCt0 },
  );
  console.log("  " + (Date.now() - t1) + "ms");

  // Stage 3
  console.log("[3/4] AI Roast...");
  const t2 = Date.now();
  const roast = await generateRoast(analysis, { openaiApiKey }, scraped);
  console.log("  " + (Date.now() - t2) + "ms — " + roast.bagTier.emoji + " " + roast.bagTier.label + " (" + roast.riskScore + "/100)");
  console.log("  Verdict: " + roast.verdict);

  // Stage 4
  console.log("[4/4] Rendering card...");
  const t3 = Date.now();
  const png = await renderCard({ analysis, roast });
  console.log("  " + (Date.now() - t3) + "ms (" + png.length + " bytes)");

  writeFileSync(OUT, png);

  // Also copy to public for easy viewing
  writeFileSync("public/card-preview.png", png);
  console.log("\n  Saved to: " + OUT);
  console.log("  View at: http://localhost:3000/card-preview.png");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
