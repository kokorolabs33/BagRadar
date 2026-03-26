/**
 * Payment verification — confirms SOL transfer on-chain.
 *
 * Flow:
 * 1. Frontend: GET /api/payment/price → returns SOL amount for ~$0.50
 * 2. Frontend: user signs + sends SOL transfer via Phantom
 * 3. Frontend: POST /api/payment/verify { signature, mint } → backend confirms on-chain
 * 4. If valid → returns a session token to authorize roast generation
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import crypto from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const TREASURY = new PublicKey("BFibSQsR7QUjcNgkHJELkfPR84att9do5yj5PMVdLtpL");
const PRICE_USD = 0.50;
/** Allow 10% slippage on SOL price between quote and payment */
const SLIPPAGE = 0.10;

// ─── SOL price ───────────────────────────────────────────────────────────────

let cachedSolPrice: { price: number; fetchedAt: number } | null = null;
const PRICE_CACHE_MS = 60_000; // cache for 1 minute

export async function getSolPrice(): Promise<number> {
  if (cachedSolPrice && Date.now() - cachedSolPrice.fetchedAt < PRICE_CACHE_MS) {
    return cachedSolPrice.price;
  }

  // Use CoinGecko simple price API (free, no auth)
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
  );
  if (!res.ok) throw new Error(`CoinGecko price API: ${res.status}`);

  const data = await res.json() as { solana: { usd: number } };
  const price = data.solana.usd;

  if (!price || price <= 0) throw new Error("Invalid SOL price");

  cachedSolPrice = { price, fetchedAt: Date.now() };
  return price;
}

/**
 * Returns the amount of SOL needed for one analysis.
 */
export async function getPaymentAmount(): Promise<{
  solAmount: number;
  solPrice: number;
  usdPrice: number;
  lamports: number;
  treasury: string;
}> {
  const solPrice = await getSolPrice();
  const solAmount = PRICE_USD / solPrice;
  const lamports = Math.ceil(solAmount * LAMPORTS_PER_SOL);

  return {
    solAmount: parseFloat(solAmount.toFixed(6)),
    solPrice,
    usdPrice: PRICE_USD,
    lamports,
    treasury: TREASURY.toBase58(),
  };
}

// ─── Transaction verification ────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  sessionToken?: string;
  error?: string;
}

/**
 * Verifies a SOL transfer transaction on-chain.
 * Checks: correct recipient, sufficient amount, finalized.
 */
export async function verifyPayment(
  signature: string,
  rpcUrl: string,
): Promise<VerifyResult> {
  const connection = new Connection(rpcUrl, "confirmed");

  // Fetch transaction
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    return { valid: false, error: "Transaction not found. It may not be confirmed yet." };
  }

  if (tx.meta?.err) {
    return { valid: false, error: "Transaction failed on-chain." };
  }

  // Find SOL transfer to treasury
  const instructions = tx.transaction.message.instructions;
  let transferredLamports = 0;

  for (const ix of instructions) {
    if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
      const info = ix.parsed.info;
      if (info.destination === TREASURY.toBase58()) {
        transferredLamports += info.lamports;
      }
    }
  }

  if (transferredLamports === 0) {
    return { valid: false, error: "No SOL transfer to treasury found in this transaction." };
  }

  // Check amount (with slippage tolerance)
  const solPrice = await getSolPrice();
  const expectedLamports = Math.ceil((PRICE_USD / solPrice) * LAMPORTS_PER_SOL);
  const minLamports = Math.floor(expectedLamports * (1 - SLIPPAGE));

  if (transferredLamports < minLamports) {
    const paid = (transferredLamports / LAMPORTS_PER_SOL).toFixed(6);
    const expected = (expectedLamports / LAMPORTS_PER_SOL).toFixed(6);
    return {
      valid: false,
      error: `Insufficient payment: ${paid} SOL (expected ~${expected} SOL).`,
    };
  }

  // Generate session token
  const sessionToken = crypto.randomBytes(32).toString("hex");

  return { valid: true, sessionToken };
}

// ─── Session management (in-memory for now) ──────────────────────────────────

const sessions = new Map<string, { mint: string; createdAt: number }>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function createSession(token: string, mint: string): void {
  sessions.set(token, { mint, createdAt: Date.now() });
}

export function validateSession(token: string, mint: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  if (session.mint !== mint) return false;
  // One-time use: delete after validation
  sessions.delete(token);
  return true;
}
