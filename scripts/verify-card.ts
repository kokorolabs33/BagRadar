/**
 * verify-card.ts
 * Tests share card generation with mock roast data.
 *
 * Run: npx tsx scripts/verify-card.ts
 * Output: /tmp/bagradar-card.png
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { aggregateToken } from "../server/aggregator.js";
import { renderCard } from "../server/card.js";
import { riskToTier, type RoastResult } from "../server/roast.js";

const heliusApiKey = process.env.HELIUS_API_KEY!;
const bagsApiKey = process.env.BAGS_API_KEY!;

const MINT = process.argv[2] || "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OUT = "/tmp/bagradar-card.png";

async function main() {
  console.log(`Generating share card for ${MINT}...\n`);

  // Get real analysis data
  const t0 = Date.now();
  const analysis = await aggregateToken(MINT, { heliusApiKey, bagsApiKey });
  console.log(`  Aggregated in ${Date.now() - t0}ms — ${analysis.name} (${analysis.symbol})`);

  // Mock roast result (so we don't need OpenAI key)
  const mockRoast: RoastResult = {
    roast:
      `${analysis.name} ($${analysis.symbol}) is sitting at a market cap of $${analysis.market?.marketCap?.toLocaleString() ?? "???"} with ${analysis.holders?.top10Pct?.toFixed(0) ?? "?"}% of supply locked in the top 10 wallets. ` +
      `The 24h volume is a measly $${analysis.market?.volume24h?.toLocaleString() ?? "0"} — that's barely enough to buy a decent lunch. ` +
      `Risk score of ${analysis.risk?.scoreNormalised ?? "?"}/10 from RugCheck tells you everything you need to know. ` +
      `LP locked at ${analysis.risk?.lpLockedPct?.toFixed(2) ?? "0"}%? That liquidity could vanish faster than your dad going to get milk.`,
    verdict: analysis.risk?.scoreNormalised && analysis.risk.scoreNormalised >= 7
      ? "Proceed With Extreme Caution"
      : "Not The Worst I've Seen",
    riskScore: Math.min(99, Math.max(1, Math.round(
      (analysis.risk?.scoreNormalised ?? 5) * 8 +
      (analysis.holders?.top10Pct ?? 50 > 80 ? 20 : 0)
    ))),
    bagTier: riskToTier(Math.min(99, Math.max(1, Math.round(
      (analysis.risk?.scoreNormalised ?? 5) * 8 +
      (analysis.holders?.top10Pct ?? 50 > 80 ? 20 : 0)
    )))),
    shareLine: `${analysis.name} gets a ${analysis.risk?.scoreNormalised ?? "?"}/10 risk score. DYOR.`,
    model: "mock",
    tokensUsed: { prompt: 0, completion: 0 },
  };

  // Render card
  const t1 = Date.now();
  const png = await renderCard({ analysis, roast: mockRoast });
  console.log(`  Card rendered in ${Date.now() - t1}ms (${png.length} bytes)`);

  // Save
  writeFileSync(OUT, png);
  console.log(`\n  Saved to: ${OUT}`);
  console.log(`  Open with: open ${OUT}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
