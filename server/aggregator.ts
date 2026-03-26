/**
 * Data aggregator — pulls from all API clients and builds a unified
 * TokenAnalysis payload ready for AI roast generation.
 *
 * Flow: submit CA → aggregate data → AI analyze/roast → share card
 */

import { getBestPair, type PairData } from "./clients/dexscreener.js";
import {
  getAsset,
  getTokenHolders,
  type AssetInfo,
  type HoldersResult,
} from "./clients/helius.js";
import { BagsClient, type CreatorData, type FeesData } from "./clients/bags.js";
import {
  getTokenSummary,
  getTokenReport,
  type TokenSummary,
  type TokenReport,
} from "./clients/rugcheck.js";

// ─── Aggregated output ───────────────────────────────────────────────────────

export interface TokenAnalysis {
  /** The contract address that was submitted */
  mint: string;
  /** Timestamp when the analysis was performed */
  analyzedAt: string;

  // ── On-chain identity (Helius DAS) ──
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  description: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;

  // ── Market data (DexScreener) ──
  market: {
    priceUsd: number;
    marketCap: number;
    fdv: number;
    volume24h: number;
    priceChange24h: number;
    buys24h: number;
    sells24h: number;
    liquidityUsd: number;
    dex: string;
    pairAddress: string;
    pairCreatedAt: number | null;
    dexUrl: string;
  } | null;

  // ── Social links (DexScreener info) ──
  socials: {
    twitter: string | null;
    website: string | null;
  };

  // ── Creator wallet (from RugCheck or Helius, fallback when no Bags.fm data) ──
  creatorWallet: string | null;

  // ── Holder distribution (Helius RPC) ──
  holders: {
    totalSupply: number;
    top10Pct: number;
    topHolders: Array<{
      address: string;
      percentage: number;
    }>;
  } | null;

  // ── Risk analysis (RugCheck) ──
  risk: {
    /** 0-10 normalised score (lower = safer) */
    scoreNormalised: number;
    scoreRaw: number;
    lpLockedPct: number;
    risks: Array<{
      name: string;
      description: string;
      level: "warn" | "danger" | "info";
      score: number;
    }>;
    // Full report extras (if available)
    rugged: boolean;
    insidersDetected: number;
    totalMarketLiquidity: number;
    deployPlatform: string;
    topHoldersFromReport: Array<{
      address: string;
      pct: number;
      insider: boolean;
    }>;
  } | null;

  // ── Creator info (Bags.fm) ──
  creator: {
    username: string;
    twitterUsername: string | null;
    pfp: string;
    wallet: string;
    royaltyBps: number;
    lifetimeFeesSOL: number;
  } | null;

  // ── Errors — track which sources failed without breaking the whole analysis ──
  errors: Array<{ source: string; message: string }>;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AggregatorConfig {
  heliusApiKey: string;
  bagsApiKey: string;
  /** If true, fetch the full RugCheck report (slower but more data). Default: false */
  fullRugReport?: boolean;
}

// ─── Aggregator ──────────────────────────────────────────────────────────────

/**
 * Aggregates data from all sources for a given token mint.
 * Each source is fetched independently — a failure in one does not block the others.
 */
export async function aggregateToken(
  mint: string,
  config: AggregatorConfig,
): Promise<TokenAnalysis> {
  const errors: TokenAnalysis["errors"] = [];

  // Fire all requests in parallel
  const [dexResult, assetResult, holdersResult, rugResult, creatorResult] =
    await Promise.allSettled([
      getBestPair(mint),
      getAsset(config.heliusApiKey, mint),
      getTokenHolders(config.heliusApiKey, mint),
      config.fullRugReport
        ? getTokenReport(mint)
        : getTokenSummary(mint),
      fetchCreatorAndFees(config.bagsApiKey, mint),
    ]);

  // ── DexScreener ──
  let market: TokenAnalysis["market"] = null;
  if (dexResult.status === "fulfilled" && dexResult.value) {
    const p = dexResult.value;
    market = {
      priceUsd: p.priceUsd,
      marketCap: p.marketCap,
      fdv: p.fdv,
      volume24h: p.volume24h,
      priceChange24h: p.priceChange24h,
      buys24h: p.buys24h,
      sells24h: p.sells24h,
      liquidityUsd: p.liquidityUsd,
      dex: p.dexId,
      pairAddress: p.pairAddress,
      pairCreatedAt: p.pairCreatedAt,
      dexUrl: p.url,
    };
  } else if (dexResult.status === "rejected") {
    errors.push({ source: "dexscreener", message: String(dexResult.reason) });
  }

  // ── Social links from DexScreener ──
  const socials: TokenAnalysis["socials"] = { twitter: null, website: null };
  if (dexResult.status === "fulfilled" && dexResult.value) {
    const p = dexResult.value;
    for (const s of p.socials) {
      if (s.type === "twitter" && !socials.twitter) socials.twitter = s.url;
    }
    if (p.websites.length > 0) socials.website = p.websites[0].url;
  }

  // ── Helius asset ──
  let name: string | null = null;
  let symbol: string | null = null;
  let imageUrl: string | null = null;
  let description: string | null = null;
  let mintAuthority: string | null = null;
  let freezeAuthority: string | null = null;

  if (assetResult.status === "fulfilled") {
    const a = assetResult.value;
    name = a.name;
    symbol = a.symbol;
    imageUrl = a.raw.content?.links?.image ?? null;
    description = a.raw.content?.metadata?.description ?? null;
    mintAuthority = a.mintAuthority;
    freezeAuthority = a.freezeAuthority;
  } else {
    errors.push({ source: "helius:asset", message: String(assetResult.reason) });
  }

  // ── Helius holders ──
  let holders: TokenAnalysis["holders"] = null;
  if (holdersResult.status === "fulfilled") {
    const h = holdersResult.value;
    holders = {
      totalSupply: h.totalSupply,
      top10Pct: h.top10Pct,
      topHolders: h.holders.slice(0, 10).map((th) => ({
        address: th.address,
        percentage: th.percentage,
      })),
    };
  } else {
    errors.push({ source: "helius:holders", message: String(holdersResult.reason) });
  }

  // ── RugCheck ──
  let risk: TokenAnalysis["risk"] = null;
  if (rugResult.status === "fulfilled") {
    const r = rugResult.value;
    const isFullReport = "mint" in r; // full report has `mint` field, summary does not

    const risks = (r.risks ?? []).map((rr) => ({
      name: rr.name,
      description: rr.description,
      level: rr.level,
      score: rr.score,
    }));

    if (isFullReport) {
      const full = r as TokenReport;
      risk = {
        scoreNormalised: full.score_normalised,
        scoreRaw: full.score,
        lpLockedPct: 0, // computed from markets
        risks,
        rugged: full.rugged,
        insidersDetected: full.graphInsidersDetected,
        totalMarketLiquidity: full.totalMarketLiquidity,
        deployPlatform: full.deployPlatform,
        topHoldersFromReport: (full.topHolders ?? []).slice(0, 10).map((h) => ({
          address: h.owner,
          pct: h.pct,
          insider: h.insider,
        })),
      };
    } else {
      const summary = r as TokenSummary;
      risk = {
        scoreNormalised: summary.score_normalised,
        scoreRaw: summary.score,
        lpLockedPct: summary.lpLockedPct ?? 0,
        risks,
        rugged: false,
        insidersDetected: 0,
        totalMarketLiquidity: 0,
        deployPlatform: "",
        topHoldersFromReport: [],
      };
    }
  } else {
    errors.push({ source: "rugcheck", message: String(rugResult.reason) });
  }

  // ── Bags.fm creator ──
  let creator: TokenAnalysis["creator"] = null;
  if (creatorResult.status === "fulfilled" && creatorResult.value) {
    creator = creatorResult.value;
  } else if (creatorResult.status === "rejected") {
    errors.push({ source: "bags", message: String(creatorResult.reason) });
  }
  // fulfilled with null = token not on Bags.fm, not an error

  // ── Fill in name/symbol from RugCheck if Helius didn't have it ──
  if (!name && rugResult.status === "fulfilled" && "tokenMeta" in rugResult.value) {
    const meta = (rugResult.value as TokenReport).tokenMeta;
    name = meta?.name ?? name;
    symbol = meta?.symbol ?? symbol;
  }
  if (!imageUrl && rugResult.status === "fulfilled" && "fileMeta" in rugResult.value) {
    imageUrl = (rugResult.value as TokenReport).fileMeta?.image ?? imageUrl;
  }

  // ── Creator wallet fallback: Bags.fm > RugCheck > Helius authority ──
  let creatorWallet: string | null = creator?.wallet ?? null;
  if (!creatorWallet && rugResult.status === "fulfilled" && "creator" in rugResult.value) {
    creatorWallet = (rugResult.value as TokenReport).creator ?? null;
  }
  if (!creatorWallet && assetResult.status === "fulfilled") {
    const authorities = assetResult.value.authorities;
    if (authorities.length > 0) creatorWallet = authorities[0];
  }

  // ── Fill twitter from DexScreener if Bags.fm didn't have it ──
  if (creator && !creator.twitterUsername && socials.twitter) {
    // Extract username from URL like "https://twitter.com/JupiterExchange"
    const match = socials.twitter.match(/(?:twitter\.com|x\.com)\/([^/?]+)/);
    if (match) creator = { ...creator, twitterUsername: match[1] };
  }

  return {
    mint,
    analyzedAt: new Date().toISOString(),
    name,
    symbol,
    imageUrl,
    description,
    mintAuthority,
    freezeAuthority,
    market,
    socials,
    creatorWallet,
    holders,
    risk,
    creator,
    errors,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CreatorWithFees {
  username: string;
  twitterUsername: string | null;
  pfp: string;
  wallet: string;
  royaltyBps: number;
  lifetimeFeesSOL: number;
}

/**
 * Fetches creator info + lifetime fees from Bags.fm.
 * Returns null if the token is not on Bags.fm (instead of throwing).
 */
async function fetchCreatorAndFees(
  apiKey: string,
  mint: string,
): Promise<CreatorWithFees | null> {
  const client = new BagsClient(apiKey);

  let creatorData: CreatorData;
  try {
    creatorData = await client.getCreator(mint);
  } catch {
    // Token not on Bags.fm — not an error
    return null;
  }

  let feesSOL = 0;
  try {
    const fees = await client.getLifetimeFees(mint);
    feesSOL = fees.lifetimeFees;
  } catch {
    // Fees endpoint might fail for some tokens; still return creator data
  }

  return {
    username: creatorData.username,
    twitterUsername: creatorData.twitterUsername || null,
    pfp: creatorData.pfp,
    wallet: creatorData.wallet,
    royaltyBps: creatorData.royaltyBps,
    lifetimeFeesSOL: feesSOL,
  };
}
