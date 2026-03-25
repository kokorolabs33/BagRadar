/**
 * verify-rugcheck.ts
 * Verifies RugCheck API endpoints return expected data shapes.
 * Tests: /report/summary (lightweight) and /report (full)
 *
 * Run: npx tsx scripts/verify-rugcheck.ts [optional-mint]
 */

import {
  getTokenSummary,
  getTokenReport,
  type Risk,
} from "../server/clients/rugcheck.js";

const TEST_MINT = process.argv[2] || "So11111111111111111111111111111111111111112"; // wSOL as default

function section(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function checkField(label: string, value: unknown) {
  const present = value !== null && value !== undefined && value !== "" && value !== 0;
  const tag = present ? "OK " : "---";
  console.log(`  [${tag}] ${label}: ${JSON.stringify(value)}`);
}

function printRisks(risks: Risk[]) {
  if (!risks.length) {
    console.log("  (no risks detected)");
    return;
  }
  for (const r of risks) {
    const icon = r.level === "danger" ? "!!!" : r.level === "warn" ? " ! " : " i ";
    console.log(`  [${icon}] ${r.name} (score: ${r.score}, level: ${r.level})`);
    console.log(`        ${r.description}`);
    if (r.value) console.log(`        value: ${r.value}`);
  }
}

async function main() {
  console.log("RugCheck API Verification");
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Test mint: ${TEST_MINT}`);

  // ── 1. Summary endpoint ─────────────────────────────────────────────────
  section("Endpoint 1 — getTokenSummary (/v1/tokens/{id}/report/summary)");
  try {
    const summary = await getTokenSummary(TEST_MINT);
    checkField("tokenProgram   ", summary.tokenProgram);
    checkField("tokenType      ", summary.tokenType);
    checkField("score (raw)    ", summary.score);
    checkField("score_normalised", summary.score_normalised);
    checkField("lpLockedPct    ", summary.lpLockedPct);
    checkField("risks.length   ", summary.risks?.length ?? 0);

    console.log("\n  Risks:");
    printRisks(summary.risks ?? []);

    console.log("\n  All top-level keys:", Object.keys(summary));
  } catch (err) {
    console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }

  // ── 2. Full report endpoint ──────────────────────────────────────────────
  section("Endpoint 2 — getTokenReport (/v1/tokens/{id}/report)");
  try {
    const report = await getTokenReport(TEST_MINT);
    checkField("mint             ", report.mint);
    checkField("tokenProgram     ", report.tokenProgram);
    checkField("creator          ", report.creator);
    checkField("creatorBalance   ", report.creatorBalance);
    checkField("score (raw)      ", report.score);
    checkField("score_normalised ", report.score_normalised);
    checkField("price            ", report.price);
    checkField("totalHolders     ", report.totalHolders);
    checkField("totalMarketLiq   ", report.totalMarketLiquidity);
    checkField("totalStableLiq   ", report.totalStableLiquidity);
    checkField("totalLPProviders ", report.totalLPProviders);
    checkField("rugged           ", report.rugged);
    checkField("tokenType        ", report.tokenType);
    checkField("deployPlatform   ", report.deployPlatform);
    checkField("launchpad        ", report.launchpad);
    checkField("freezeAuthority  ", report.freezeAuthority);
    checkField("mintAuthority    ", report.mintAuthority);
    checkField("insidersDetected ", report.graphInsidersDetected);
    checkField("detectedAt       ", report.detectedAt);

    // Transfer fee
    if (report.transferFee) {
      console.log(`\n  Transfer fee: ${report.transferFee.pct}% (max: ${report.transferFee.maxAmount})`);
    }

    // Token metadata
    if (report.tokenMeta) {
      console.log("\n  Token metadata:");
      console.log(`    name    : ${report.tokenMeta.name}`);
      console.log(`    symbol  : ${report.tokenMeta.symbol}`);
      console.log(`    mutable : ${report.tokenMeta.mutable}`);
      console.log(`    uri     : ${report.tokenMeta.uri}`);
    }

    if (report.fileMeta) {
      console.log("\n  File metadata:");
      console.log(`    name    : ${report.fileMeta.name}`);
      console.log(`    image   : ${report.fileMeta.image}`);
      console.log(`    desc    : ${report.fileMeta.description?.slice(0, 100)}`);
    }

    // Top holders
    if (report.topHolders?.length) {
      console.log(`\n  Top holders (${report.topHolders.length} returned, showing top 5):`);
      for (const h of report.topHolders.slice(0, 5)) {
        const insider = h.insider ? " [INSIDER]" : "";
        console.log(`    ${h.owner.slice(0, 8)}… — ${h.pct.toFixed(2)}% (${h.uiAmountString})${insider}`);
      }
    }

    // Markets
    if (report.markets?.length) {
      console.log(`\n  Markets (${report.markets.length}):`);
      for (const m of report.markets.slice(0, 3)) {
        console.log(`    ${m.marketType} — LP locked: ${m.lp?.lpLockedPct?.toFixed(2) ?? "?"}%`);
      }
    }

    // Risks
    console.log(`\n  Risks (${report.risks?.length ?? 0}):`);
    printRisks(report.risks ?? []);

    console.log("\n  All top-level keys:", Object.keys(report));
  } catch (err) {
    console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }

  // ── 3. Test with a known pump.fun token ──────────────────────────────────
  const PUMP_MINT = "DitHyRMQiSDhn5cnKMJV2CDDt6sVCpCfNKBNnV7Lpump";
  if (TEST_MINT !== PUMP_MINT) {
    section(`Endpoint 1 (repeat) — Summary for pump.fun token: ${PUMP_MINT.slice(0, 12)}…`);
    try {
      const summary = await getTokenSummary(PUMP_MINT);
      checkField("score_normalised", summary.score_normalised);
      checkField("lpLockedPct    ", summary.lpLockedPct);
      checkField("risks.length   ", summary.risks?.length ?? 0);
      console.log("\n  Risks:");
      printRisks(summary.risks ?? []);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  section("Done");
  console.log(`
  Summary:
    - /report/summary returns: score, score_normalised (0-10), risks[], lpLockedPct
    - /report returns: full holder data, markets, insider detection, token meta, risks
    - No auth required for either endpoint
    - score_normalised: lower = safer (0 = no risks, 7+ = significant concerns)
`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
