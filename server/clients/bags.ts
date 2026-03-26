/**
 * Bags.fm public API client.
 * Base URL: https://public-api-v2.bags.fm/api/v1
 * Auth: x-api-key header
 * All responses are wrapped: { success: boolean, response: T }
 */

const BASE_URL = "https://public-api-v2.bags.fm/api/v1";

// ---------- Response wrapper -----------------------------------------------

interface BagsResponse<T> {
  success: boolean;
  response: T;
}

// ---------- Domain types ---------------------------------------------------

/**
 * Pool key data returned by /solana/bags/pools/token-mint.
 * Note: this endpoint returns pool key identifiers, NOT price/volume/mcap.
 */
export interface PoolData {
  tokenMint: string;
  dbcConfigKey: string;
  dbcPoolKey: string;
  bagsConfigType: string;
}

/**
 * Creator record returned by /token-launch/creator/v3.
 * The endpoint returns an array; getCreator() returns the first (primary) entry.
 */
export interface CreatorData {
  username: string;          // Display username (may differ in casing from providerUsername)
  pfp: string;               // Profile picture URL
  provider: string;          // Social provider, e.g. "twitter"
  providerUsername: string;  // Username on the social platform
  twitterUsername: string;   // Twitter-specific username (same as providerUsername for twitter)
  royaltyBps: number;        // Creator royalty in basis points (10000 = 100%)
  isCreator: boolean;
  isAdmin: boolean;
  wallet: string;            // Creator's Solana wallet address
  bagsUsername: string;      // Lowercased bags.fm username
  [key: string]: unknown;    // Future-proof: capture any extra fields
}

export interface FeesData {
  lifetimeFees: number; // in SOL (converted from lamports)
}

export interface FeedToken {
  tokenMint: string;
  name: string;
  symbol: string;
  twitter: string;
  website: string;
  description: string;
  status: string;
  accountKeys: string[];
  uri: string;
}

// ---------- Client ---------------------------------------------------------

export class BagsClient {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.BAGS_API_KEY;
    if (!key) {
      throw new Error("BAGS_API_KEY is not set");
    }
    this.apiKey = key;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      headers: { "x-api-key": this.apiKey },
    });

    if (!res.ok) {
      throw new Error(`Bags API ${url}: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as BagsResponse<T>;

    if (!body.success) {
      throw new Error(`Bags API ${url}: success=false`);
    }

    return body.response;
  }

  /** Returns on-chain pool data (mcap, volume24h, price) for a token mint. */
  async getPool(tokenMint: string): Promise<PoolData> {
    return this.request<PoolData>(
      `/solana/bags/pools/token-mint?tokenMint=${encodeURIComponent(tokenMint)}`
    );
  }

  /**
   * Returns creator info for a token mint.
   * Endpoint: /token-launch/creator/v3
   * NOTE: This endpoint is NOT in the Go codebase — discovered from Bags.fm API docs.
   *
   * The API returns an array of creator records; this method returns the first
   * (primary) entry or throws if the array is empty.
   */
  async getCreator(tokenMint: string): Promise<CreatorData> {
    const results = await this.request<CreatorData[]>(
      `/token-launch/creator/v3?tokenMint=${encodeURIComponent(tokenMint)}`
    );
    if (!results.length) {
      throw new Error(`Bags API: no creator found for tokenMint=${tokenMint}`);
    }
    return results[0];
  }

  /**
   * Returns lifetime fees in SOL for a token mint.
   * The API responds with a lamports string (e.g. "158400"); we convert to SOL.
   */
  async getLifetimeFees(tokenMint: string): Promise<FeesData> {
    const lamportsStr = await this.request<string>(
      `/token-launch/lifetime-fees?tokenMint=${encodeURIComponent(tokenMint)}`
    );
    const lamports = parseFloat(lamportsStr);
    return { lifetimeFees: lamports / 1e9 };
  }

  /** Returns the latest token launches from the feed. */
  async getFeed(): Promise<FeedToken[]> {
    return this.request<FeedToken[]>("/token-launch/feed");
  }
}
