/**
 * verify-aggregator.ts
 * End-to-end test of the data aggregation layer.
 * Fetches all data sources in parallel and outputs the unified TokenAnalysis.
 *
 * Run: npx tsx scripts/verify-aggregator.ts [optional-mint]
 */

import "dotenv/config";
import { aggregateToken } from "../server/aggregator.js";

const heliusApiKey = process.env.HELIUS_API_KEY;
const bagsApiKey = process.env.BAGS_API_KEY;

if (!heliusApiKey) {
  console.error("HELIUS_API_KEY not set in .env");
  process.exit(1);
}
if (!bagsApiKey) {
  console.error("BAGS_API_KEY not set in .env");
  process.exit(1);
}

// JUP as default — well-known token with rich data across all sources
const TEST_MINT = process.argv[2] || "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

function section(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

async function main() {
  console.log("Aggregator Verification");
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Mint: ${TEST_MINT}\n`);

  const start = Date.now();
  const analysis = await aggregateToken(TEST_MINT, {
    heliusApiKey: heliusApiKey!,
    bagsApiKey: bagsApiKey!,
  });
  const elapsed = Date.now() - start;

  // ── Identity ──
  section("Identity");
  console.log(`  name          : ${analysis.name}`);
  console.log(`  symbol        : ${analysis.symbol}`);
  console.log(`  imageUrl      : ${analysis.imageUrl}`);
  console.log(`  description   : ${analysis.description?.slice(0, 100) ?? "(none)"}`);
  console.log(`  mintAuthority : ${analysis.mintAuthority}`);
  console.log(`  freezeAuth    : ${analysis.freezeAuthority}`);

  // ── Market ──
  section("Market (DexScreener)");
  if (analysis.market) {
    const m = analysis.market;
    console.log(`  price         : $${m.priceUsd}`);
    console.log(`  marketCap     : $${m.marketCap.toLocaleString()}`);
    console.log(`  fdv           : $${m.fdv.toLocaleString()}`);
    console.log(`  volume24h     : $${m.volume24h.toLocaleString()}`);
    console.log(`  priceChange24h: ${m.priceChange24h}%`);
    console.log(`  buys/sells 24h: ${m.buys24h} / ${m.sells24h}`);
    console.log(`  liquidityUsd  : $${m.liquidityUsd.toLocaleString()}`);
    console.log(`  dex           : ${m.dex}`);
    console.log(`  pairCreatedAt : ${m.pairCreatedAt ? new Date(m.pairCreatedAt).toISOString() : "N/A"}`);
  } else {
    console.log("  (no market data)");
  }

  // ── Holders ──
  section("Holders (Helius)");
  if (analysis.holders) {
    const h = analysis.holders;
    console.log(`  totalSupply   : ${h.totalSupply.toLocaleString()}`);
    console.log(`  top10Pct      : ${h.top10Pct.toFixed(2)}%`);
    console.log(`  top holders:`);
    for (const th of h.topHolders.slice(0, 5)) {
      console.log(`    ${th.address.slice(0, 12)}…  ${th.percentage.toFixed(2)}%`);
    }
  } else {
    console.log("  (no holder data)");
  }

  // ── Risk ──
  section("Risk (RugCheck)");
  if (analysis.risk) {
    const r = analysis.risk;
    console.log(`  scoreNormalised: ${r.scoreNormalised}/10`);
    console.log(`  scoreRaw       : ${r.scoreRaw}`);
    console.log(`  lpLockedPct    : ${r.lpLockedPct.toFixed(2)}%`);
    console.log(`  rugged         : ${r.rugged}`);
    console.log(`  insiders       : ${r.insidersDetected}`);
    console.log(`  risks (${r.risks.length}):`);
    for (const risk of r.risks) {
      console.log(`    [${risk.level}] ${risk.name}: ${risk.description}`);
    }
  } else {
    console.log("  (no risk data)");
  }

  // ── Creator ──
  section("Creator (Bags.fm)");
  if (analysis.creator) {
    const c = analysis.creator;
    console.log(`  username      : ${c.username}`);
    console.log(`  twitter       : ${c.twitterUsername}`);
    console.log(`  wallet        : ${c.wallet}`);
    console.log(`  royaltyBps    : ${c.royaltyBps}`);
    console.log(`  lifetimeFees  : ${c.lifetimeFeesSOL} SOL`);
  } else {
    console.log("  (not a Bags.fm token — expected for non-Bags tokens)");
  }

  // ── Errors ──
  section("Errors");
  if (analysis.errors.length) {
    for (const e of analysis.errors) {
      console.log(`  [${e.source}] ${e.message}`);
    }
  } else {
    console.log("  (none — all sources succeeded)");
  }

  // ── Timing ──
  section("Summary");
  console.log(`  Total time    : ${elapsed}ms`);
  console.log(`  Sources OK    : ${4 - analysis.errors.length}/4`);
  console.log(`  Errors        : ${analysis.errors.length}`);

  // Print compact JSON for AI prompt inspection
  section("Raw JSON (for AI prompt payload)");
  console.log(JSON.stringify(analysis, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
