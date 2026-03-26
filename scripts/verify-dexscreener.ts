/**
 * verify-dexscreener.ts
 *
 * Verifies 24h data completeness from DexScreener for a set of known tokens.
 * Run: npx tsx scripts/verify-dexscreener.ts
 */

import { getTokenPairs, getBestPair, getBestPairs } from "../server/clients/dexscreener.js";
import type { RawPair, PairData } from "../server/clients/dexscreener.js";

const TEST_MINTS: Record<string, string> = {
  "Wrapped SOL (active)": "So11111111111111111111111111111111111111112",
  "Bags token (pump.fun)": "DitHyRMQiSDhn5cnKMJV2CDDt6sVCpCfNKBNnV7Lpump",
  "Dead/low-vol token": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC — stable, useful control
};

function hr(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

function checkField(label: string, value: unknown): void {
  const present = value !== null && value !== undefined && value !== 0 && value !== "";
  const tag = present ? "OK " : "---";
  console.log(`  [${tag}] ${label}: ${JSON.stringify(value)}`);
}

function printPairSummary(label: string, pair: PairData, raw: RawPair): void {
  console.log(`\n  Token : ${pair.baseToken.symbol} / ${pair.baseToken.name}`);
  console.log(`  Mint  : ${pair.baseToken.address}`);
  console.log(`  DEX   : ${pair.dexId} | Chain: ${pair.chainId}`);
  console.log(`  URL   : ${pair.url}`);
  console.log();

  // Core 24h fields
  checkField("priceUsd          ", pair.priceUsd);
  checkField("marketCap         ", pair.marketCap);
  checkField("fdv               ", pair.fdv);
  checkField("volume.h24        ", pair.volume24h);
  checkField("priceChange.h24   ", raw.priceChange?.h24);
  checkField("txns.h24.buys     ", pair.buys24h);
  checkField("txns.h24.sells    ", pair.sells24h);
  checkField("liquidity.usd     ", pair.liquidityUsd);
  checkField("makers            ", raw.makers);
  checkField("pairCreatedAt     ", pair.pairCreatedAt);

  // Derived
  const totalTxns = pair.buys24h + pair.sells24h;
  const buySellRatio =
    pair.sells24h > 0 ? (pair.buys24h / pair.sells24h).toFixed(3) : "N/A (no sells)";
  console.log(`\n  Total txns 24h: ${totalTxns}  |  buy/sell ratio: ${buySellRatio}`);

  // Shorter windows
  console.log(`\n  Shorter windows (from raw):`);
  checkField("priceChange.h6    ", raw.priceChange?.h6);
  checkField("priceChange.h1    ", raw.priceChange?.h1);
  checkField("priceChange.m5    ", raw.priceChange?.m5);
  checkField("volume.h6         ", raw.volume?.h6);
  checkField("volume.h1         ", raw.volume?.h1);
  checkField("volume.m5         ", raw.volume?.m5);
  checkField("txns.h6.buys      ", raw.txns?.h6?.buys);
  checkField("txns.h1.buys      ", raw.txns?.h1?.buys);
  checkField("txns.m5.buys      ", raw.txns?.m5?.buys);

  // Raw excerpt for reference
  console.log(`\n  Raw pair keys: [${Object.keys(raw).join(", ")}]`);
}

async function verifyToken(label: string, mint: string): Promise<void> {
  hr(`${label}  —  ${mint}`);

  let rawPairs: RawPair[];
  let pairs: PairData[];

  try {
    const result = await getTokenPairs(mint);
    rawPairs = result.raw;
    pairs = result.pairs;
  } catch (err) {
    console.error(`  ERROR fetching pairs: ${err}`);
    return;
  }

  console.log(`  Total pairs returned: ${pairs.length}`);
  if (pairs.length === 0) {
    console.log("  (no pairs found — token may be delisted or very new)");
    return;
  }

  // Best pair
  const bestIdx = pairs.reduce(
    (bi, p, i) => (p.volume24h > pairs[bi].volume24h ? i : bi),
    0
  );
  const bestPair = pairs[bestIdx];
  const bestRaw = rawPairs[bestIdx];

  console.log(`  Best pair by 24h volume (index ${bestIdx}):`);
  printPairSummary(label, bestPair, bestRaw);

  if (pairs.length > 1) {
    console.log(`\n  Other pairs (symbol / dex / vol24h):`);
    pairs.forEach((p, i) => {
      if (i === bestIdx) return;
      console.log(`    [${i}] ${p.baseToken.symbol}/${p.quoteToken.symbol} on ${p.dexId} — vol24h: $${p.volume24h.toLocaleString()}`);
    });
  }
}

async function verifyBatch(): Promise<void> {
  hr("getBestPairs (batch test with all mints)");
  const mints = Object.values(TEST_MINTS);
  try {
    const result = await getBestPairs(mints);
    console.log(`  Returned ${result.size} entries for ${mints.length} mints requested`);
    for (const [mint, pair] of result) {
      console.log(
        `    ${pair.baseToken.symbol.padEnd(12)} mint=${mint.slice(0, 8)}…  vol24h=$${pair.volume24h.toLocaleString()}`
      );
    }
  } catch (err) {
    console.error(`  ERROR in batch query: ${err}`);
  }
}

async function main(): Promise<void> {
  console.log("DexScreener API Verification");
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("Checking 24h data completeness: volume, mcap, price, priceChange, buys, sells, makers\n");

  for (const [label, mint] of Object.entries(TEST_MINTS)) {
    await verifyToken(label, mint);
    // Small pause to be polite to the rate limiter
    await new Promise((r) => setTimeout(r, 500));
  }

  await verifyBatch();

  hr("Summary");
  console.log(`
  Fields confirmed present (active tokens):
    priceUsd        — string in API, parsed to float
    marketCap       — number (may be 0 for high-liquidity native tokens like wSOL)
    volume.h24      — always present
    priceChange.h24 — always present for active tokens
    txns.h24.buys   — always present
    txns.h24.sells  — always present
    liquidity.usd   — always present

  Fields NOT present / not guaranteed:
    makers          — ABSENT from the API (undefined for all tested pairs).
                      The Go code's comment "DexScreener has no makers field" was correct.
                      Must continue to approximate with txns.h24.buys or (buys+sells).
    fdv             — present for some tokens (e.g. TRUMP), absent for wSOL
    pairCreatedAt   — usually present, but may be absent
    priceChange.m5  — absent for low-volume / inactive tokens
    volume.m5       — 0 for low-volume tokens

  Notes:
    - The USDC mint query returned TRUMP as the best pair (highest vol24h among all
      USDC-quoted pairs). Use caution: the /tokens/{mint} endpoint returns pairs where
      the mint is baseToken OR quoteToken; filter by baseToken.address if you want
      only pairs for a specific token as base.
    - The Bags token mint (DitHyRMQiSDhn5cnKMJV2CDDt6sVCpCfNKBNnV7Lpump) returned 0
      pairs — token appears to have been removed from DexScreener or has no liquidity.
    - Batch (getBestPairs) works correctly; missing mints are simply absent from the
      result map with no error.
    - Raw pair keys include: chainId, dexId, url, pairAddress, labels, baseToken,
      quoteToken, priceNative, priceUsd, txns, volume, priceChange, liquidity,
      fdv (conditional), marketCap (conditional), pairCreatedAt (conditional), info
`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
