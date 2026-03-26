/**
 * verify-bags.ts
 * Verifies that the Bags.fm API endpoints return expected data shapes.
 * Tests: /pools/token-mint, /creator/v3, /lifetime-fees
 *
 * Run: npx tsx scripts/verify-bags.ts
 */

import "dotenv/config";
import { BagsClient } from "../server/clients/bags.js";

const KNOWN_MINT = "DitHyRMQiSDhn5cnKMJV2CDDt6sVCpCfNKBNnV7Lpump";

function section(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function ok(label: string, value: unknown) {
  console.log(`[OK]  ${label}:`, JSON.stringify(value, null, 2));
}

function fail(label: string, err: unknown) {
  console.error(`[ERR] ${label}:`, err instanceof Error ? err.message : err);
}

async function resolveTestMint(client: BagsClient): Promise<string> {
  // Try known mint first; if pool lookup fails, pull a live mint from the feed.
  try {
    await client.getPool(KNOWN_MINT);
    console.log(`Using known mint: ${KNOWN_MINT}`);
    return KNOWN_MINT;
  } catch {
    console.log("Known mint not found in pools, fetching feed for a live mint…");
    const feed = await client.getFeed();
    if (!feed.length) throw new Error("Feed returned no tokens");
    const mint = feed[0].tokenMint;
    console.log(`Using feed mint [0]: ${mint} (${feed[0].name})`);
    return mint;
  }
}

async function main() {
  console.log("Bags.fm API Verification");
  console.log("Base URL: https://public-api-v2.bags.fm/api/v1");

  const client = new BagsClient();

  // ── Resolve a valid token mint ──────────────────────────────────────────
  section("Step 0 — Resolve test mint");
  let mint: string;
  try {
    mint = await resolveTestMint(client);
  } catch (err) {
    fail("resolveTestMint", err);
    process.exit(1);
  }

  // ── 1. /solana/bags/pools/token-mint ───────────────────────────────────
  section("Endpoint 1 — getPool  (/solana/bags/pools/token-mint)");
  try {
    const pool = await client.getPool(mint);
    ok("pool response", pool);
    // NOTE: This endpoint returns pool key identifiers, not price/volume/mcap
    console.log(`  tokenMint    : ${pool.tokenMint}`);
    console.log(`  dbcConfigKey : ${pool.dbcConfigKey}`);
    console.log(`  dbcPoolKey   : ${pool.dbcPoolKey}`);
    console.log(`  bagsConfigType: ${pool.bagsConfigType}`);
  } catch (err) {
    fail("getPool", err);
  }

  // ── 2. /token-launch/creator/v3 ────────────────────────────────────────
  section("Endpoint 2 — getCreator  (/token-launch/creator/v3)");
  console.log("NOTE: This endpoint was NOT implemented in the Go codebase.");
  console.log("      Logging full raw response to discover the exact shape.\n");
  try {
    const creator = await client.getCreator(mint);
    ok("creator response (full shape)", creator);
    if ("provider" in creator) console.log(`  provider  : ${creator.provider}`);
    if ("username" in creator) console.log(`  username  : ${creator.username}`);
    // Log all top-level keys so we know everything available
    console.log("  keys present:", Object.keys(creator));
  } catch (err) {
    fail("getCreator", err);
    // Try with the known mint as a fallback in case the feed mint doesn't have creator data
    if (mint !== KNOWN_MINT) {
      console.log(`  Retrying with known mint ${KNOWN_MINT}…`);
      try {
        const creator2 = await client.getCreator(KNOWN_MINT);
        ok("creator response (known mint, full shape)", creator2);
        console.log("  keys present:", Object.keys(creator2));
      } catch (err2) {
        fail("getCreator (known mint)", err2);
      }
    }
  }

  // ── 3. /token-launch/lifetime-fees ─────────────────────────────────────
  section("Endpoint 3 — getLifetimeFees  (/token-launch/lifetime-fees)");
  try {
    const fees = await client.getLifetimeFees(mint);
    ok("fees response", fees);
    console.log(`  lifetimeFees : ${fees.lifetimeFees} SOL`);
  } catch (err) {
    fail("getLifetimeFees", err);
  }

  // ── 4. Feed snapshot (bonus) ────────────────────────────────────────────
  section("Endpoint 4 — getFeed  (/token-launch/feed)  [first 2 entries]");
  try {
    const feed = await client.getFeed();
    console.log(`  total entries: ${feed.length}`);
    feed.slice(0, 2).forEach((t, i) => {
      console.log(`\n  [${i}] ${t.name} (${t.symbol})`);
      console.log(`      mint     : ${t.tokenMint}`);
      console.log(`      status   : ${t.status}`);
      console.log(`      twitter  : ${t.twitter}`);
      console.log(`      accountKeys[2] (creator wallet): ${t.accountKeys[2]}`);
    });
  } catch (err) {
    fail("getFeed", err);
  }

  section("Done");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
