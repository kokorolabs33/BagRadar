/**
 * DexScreener API client.
 * Base URL: https://api.dexscreener.com/latest/dex
 * No authentication required. Rate limits may apply.
 *
 * Reference: internal/api/dexscreener/client.go
 */

const BASE_URL = "https://api.dexscreener.com/latest/dex";

// Raw API response shapes
export interface RawToken {
  address: string;
  name: string;
  symbol: string;
}

export interface RawPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  /** Price in USD — string in the API response */
  priceUsd?: string;
  /** Market cap in USD — number or absent */
  marketCap?: number;
  /** Unique traders over rolling window (may be absent) */
  makers?: number;
  baseToken: RawToken;
  quoteToken: RawToken;
  txns: {
    h24: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    m5?: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  priceChange: {
    h24?: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  pairCreatedAt?: number;
  url?: string;
}

// Parsed, normalised pair data for use inside BagRadar
export interface PairData {
  chainId: string;
  dexId: string;
  pairAddress: string;
  priceUsd: number;
  marketCap: number;
  /** Unique traders (makers) — present in API; 0 when absent */
  makers: number;
  baseToken: RawToken;
  quoteToken: RawToken;
  volume24h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  liquidityUsd: number;
  fdv: number;
  pairCreatedAt: number | null;
  url: string;
}

function rawToPairData(rp: RawPair): PairData {
  return {
    chainId: rp.chainId,
    dexId: rp.dexId,
    pairAddress: rp.pairAddress,
    priceUsd: rp.priceUsd ? parseFloat(rp.priceUsd) : 0,
    marketCap: rp.marketCap ?? 0,
    makers: rp.makers ?? 0,
    baseToken: rp.baseToken,
    quoteToken: rp.quoteToken,
    volume24h: rp.volume.h24 ?? 0,
    priceChange24h: rp.priceChange.h24 ?? 0,
    buys24h: rp.txns.h24.buys ?? 0,
    sells24h: rp.txns.h24.sells ?? 0,
    liquidityUsd: rp.liquidity?.usd ?? 0,
    fdv: rp.fdv ?? 0,
    pairCreatedAt: rp.pairCreatedAt ?? null,
    url: rp.url ?? "",
  };
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`DexScreener API error: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Returns all trading pairs for a token mint address.
 * Pairs are returned in the order DexScreener provides (typically highest liquidity first).
 */
export async function getTokenPairs(mint: string): Promise<{ pairs: PairData[]; raw: RawPair[] }> {
  const url = `${BASE_URL}/tokens/${mint}`;
  const result = await get<{ pairs: RawPair[] | null }>(url);
  const rawPairs = result.pairs ?? [];
  return {
    pairs: rawPairs.map(rawToPairData),
    raw: rawPairs,
  };
}

/**
 * Returns the pair with the highest 24h volume for a given mint.
 * Returns null if no pairs are found.
 */
export async function getBestPair(mint: string): Promise<PairData | null> {
  const { pairs } = await getTokenPairs(mint);
  if (pairs.length === 0) return null;
  return pairs.reduce((best, p) => (p.volume24h > best.volume24h ? p : best));
}

/**
 * Batch query: returns the best pair (highest 24h volume) for each mint.
 * DexScreener supports comma-separated mints, max 30 per call.
 * Input arrays larger than 30 are automatically chunked.
 */
export async function getBestPairs(mints: string[]): Promise<Map<string, PairData>> {
  const CHUNK = 30;
  const out = new Map<string, PairData>();

  for (let i = 0; i < mints.length; i += CHUNK) {
    const chunk = mints.slice(i, i + CHUNK);
    const url = `${BASE_URL}/tokens/${chunk.join(",")}`;
    const result = await get<{ pairs: RawPair[] | null }>(url);
    const rawPairs = result.pairs ?? [];

    for (const rp of rawPairs) {
      const addr = rp.baseToken.address;
      const pd = rawToPairData(rp);
      const existing = out.get(addr);
      if (!existing || pd.volume24h > existing.volume24h) {
        out.set(addr, pd);
      }
    }
  }

  return out;
}
