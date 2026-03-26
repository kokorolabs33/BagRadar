/**
 * verify-roast.ts
 * Full pipeline: aggregate → scrape links → AI roast.
 *
 * Run: npx tsx scripts/verify-roast.ts [optional-mint]
 */

import "dotenv/config";
import { aggregateToken } from "../server/aggregator.js";
import { scrapeAllLinks } from "../server/scraper.js";
import { generateRoast } from "../server/roast.js";

const heliusApiKey = process.env.HELIUS_API_KEY;
const bagsApiKey = process.env.BAGS_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const twitterAuthToken = process.env.TWITTER_AUTH_TOKEN;
const twitterCt0 = process.env.TWITTER_CT0;

if (!heliusApiKey || !bagsApiKey || !openaiApiKey) {
  console.error("Required env vars: HELIUS_API_KEY, BAGS_API_KEY, OPENAI_API_KEY");
  process.exit(1);
}

const TEST_MINT = process.argv[2] || "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

async function main() {
  console.log("=== BagRadar Full Pipeline ===");
  console.log(`Mint: ${TEST_MINT}\n`);

  // Stage 1: Aggregate
  console.log("[1/3] Aggregating on-chain + market data...");
  const t0 = Date.now();
  const analysis = await aggregateToken(TEST_MINT, {
    heliusApiKey: heliusApiKey!,
    bagsApiKey: bagsApiKey!,
  });
  const aggregateMs = Date.now() - t0;
  console.log(`  Done in ${aggregateMs}ms — ${analysis.name} (${analysis.symbol})`);
  console.log(`  twitter: ${analysis.socials.twitter ?? "none"}`);
  console.log(`  website: ${analysis.socials.website ?? "none"}`);
  console.log(`  creatorWallet: ${analysis.creatorWallet ?? "unknown"}`);
  console.log(`  errors: ${analysis.errors.length}\n`);

  // Stage 2: Scrape links
  console.log("[2/3] Scraping link content...");
  const t1 = Date.now();
  const scraped = await scrapeAllLinks(
    {
      twitter: analysis.socials.twitter,
      website: analysis.socials.website,
      github: TEST_MINT === "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"
        ? "https://github.com/jup-ag/jupiter-swap-api-client"
        : null,
    },
    { twitterAuthToken, twitterCt0 },
  );
  const scrapeMs = Date.now() - t1;
  console.log(`  Done in ${scrapeMs}ms`);
  console.log(`  github: ${scraped.github ? `${scraped.github.owner}/${scraped.github.repo} (${scraped.github.stars} stars, ${scraped.github.daysSinceLastPush}d since push)` : "none"}`);
  console.log(`  website: ${scraped.website ? `${scraped.website.title} (${scraped.website.status})` : "none"}`);
  console.log(`  twitter: ${scraped.twitter ? `@${scraped.twitter.profile.username}` : "none"}`);
  console.log(`  errors: ${scraped.errors.length}\n`);

  // Stage 3: AI Roast
  console.log("[3/3] Generating AI roast...");
  const t2 = Date.now();
  const result = await generateRoast(analysis, { openaiApiKey: openaiApiKey! }, scraped);
  const roastMs = Date.now() - t2;

  console.log(`  Done in ${roastMs}ms (model: ${result.model})\n`);

  // Output
  console.log("=".repeat(60));
  console.log(`  ${analysis.name} (${analysis.symbol})`);
  console.log("=".repeat(60));
  console.log(`\nVerdict: ${result.verdict}`);
  console.log(`Bag Tier: ${result.bagTier.emoji} ${result.bagTier.label} (risk: ${result.riskScore}/100)`);
  console.log(`Share: ${result.shareLine}`);
  console.log(`\n--- Roast ---\n`);
  console.log(result.roast);
  console.log(`\n--- Stats ---`);
  console.log(`Tokens: ${result.tokensUsed.prompt} prompt + ${result.tokensUsed.completion} completion`);
  console.log(`Pipeline: aggregate ${aggregateMs}ms + scrape ${scrapeMs}ms + roast ${roastMs}ms = ${aggregateMs + scrapeMs + roastMs}ms total`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
