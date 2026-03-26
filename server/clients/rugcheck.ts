/**
 * RugCheck API client.
 * Base URL: https://api.rugcheck.xyz
 * No authentication required for read-only endpoints.
 *
 * Endpoints used:
 *   GET /v1/tokens/{mint}/report/summary  — lightweight risk summary
 *   GET /v1/tokens/{mint}/report          — full token safety report
 */

const BASE_URL = "https://api.rugcheck.xyz";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Risk {
  name: string;
  value: string;
  description: string;
  score: number;
  level: "warn" | "danger" | "info";
}

/** Lightweight summary from /report/summary */
export interface TokenSummary {
  tokenProgram: string;
  tokenType: string;
  risks: Risk[];
  score: number;
  /** 0-10 normalised risk score (lower = safer) */
  score_normalised: number;
  lpLockedPct: number;
}

/** Token metadata from full report */
export interface TokenMeta {
  name: string;
  symbol: string;
  uri: string;
  mutable: boolean;
  updateAuthority: string;
}

export interface FileMeta {
  description: string;
  name: string;
  symbol: string;
  image: string;
}

export interface TopHolder {
  address: string;
  amount: number;
  decimals: number;
  pct: number;
  uiAmount: number;
  uiAmountString: string;
  owner: string;
  insider: boolean;
}

export interface Market {
  pubkey: string;
  marketType: string;
  mintA: string;
  mintB: string;
  mintLP: string;
  liquidityA: string;
  liquidityB: string;
  lp: {
    lpLockedPct: number;
    lpLockedUSD: number;
    quoteUSD: number;
    baseUSD: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TransferFee {
  pct: number;
  maxAmount: number;
  authority: string;
}

/** Full report from /report */
export interface TokenReport {
  mint: string;
  tokenProgram: string;
  creator: string | null;
  creatorBalance: number;
  tokenMeta: TokenMeta | null;
  fileMeta: FileMeta | null;
  topHolders: TopHolder[] | null;
  freezeAuthority: string | null;
  mintAuthority: string | null;
  risks: Risk[] | null;
  score: number;
  score_normalised: number;
  markets: Market[] | null;
  totalMarketLiquidity: number;
  totalStableLiquidity: number;
  totalLPProviders: number;
  totalHolders: number;
  price: number;
  rugged: boolean;
  tokenType: string;
  transferFee: TransferFee;
  graphInsidersDetected: number;
  detectedAt: string;
  launchpad: string | null;
  deployPlatform: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`RugCheck API error: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Returns a lightweight risk summary for a token.
 * Fast, no auth required.
 */
export async function getTokenSummary(mint: string): Promise<TokenSummary> {
  return get<TokenSummary>(`/v1/tokens/${mint}/report/summary`);
}

/**
 * Returns the full safety report for a token.
 * Slower but includes holders, markets, insider detection, etc.
 * No auth required.
 */
export async function getTokenReport(mint: string): Promise<TokenReport> {
  return get<TokenReport>(`/v1/tokens/${mint}/report`);
}
