/**
 * Helius API client — DAS RPC + enhanced REST endpoints.
 *
 * RPC endpoint:  https://mainnet.helius-rpc.com/?api-key=<key>  (JSON-RPC 2.0)
 * REST endpoint: https://api.helius.xyz/v0                       (enhanced REST)
 */

const RPC_BASE = "https://mainnet.helius-rpc.com";
const REST_BASE = "https://api.helius.xyz/v0";

// ─── raw RPC helpers ─────────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[] | Record<string, unknown>;
}

interface RpcEnvelope<T> {
  result?: T;
  error?: { code: number; message: string };
}

async function doRpc<T>(
  apiKey: string,
  method: string,
  params: unknown[] | Record<string, unknown>,
): Promise<T> {
  const url = `${RPC_BASE}/?api-key=${apiKey}`;
  const body: RpcRequest = { jsonrpc: "2.0", id: 1, method, params };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Helius RPC ${method}: HTTP ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as RpcEnvelope<T>;
  if (json.error) {
    throw new Error(`Helius RPC ${method}: ${json.error.message} (code ${json.error.code})`);
  }
  if (json.result === undefined) {
    throw new Error(`Helius RPC ${method}: empty result`);
  }
  return json.result;
}

async function doRest<T>(apiKey: string, path: string, body: unknown): Promise<T> {
  const url = `${REST_BASE}${path}?api-key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Helius REST ${path}: HTTP ${res.status} ${res.statusText} — ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── DAS getAsset ─────────────────────────────────────────────────────────────

export interface AssetAuthority {
  address: string;
  scopes: string[];
}

export interface AssetSupply {
  print_max_supply: number;
  print_current_supply: number;
  edition_nonce: number | null;
  // Fungible tokens may have these fields
  mint_authority?: string | null;
  freeze_authority?: string | null;
}

export interface AssetContent {
  $schema?: string;
  json_uri: string;
  files?: unknown[];
  metadata?: {
    name?: string;
    symbol?: string;
    description?: string;
    [key: string]: unknown;
  };
  links?: {
    image?: string;
    [key: string]: unknown;
  };
}

export interface AssetOwnership {
  frozen: boolean;
  delegated: boolean;
  delegate: string | null;
  ownership_model: string;
  owner: string;
}

export interface AssetRoyalty {
  royalty_model: string;
  target: string | null;
  percent: number;
  basis_points: number;
  primary_sale_happened: boolean;
  locked: boolean;
}

export interface AssetResult {
  // Top-level identifiers
  id: string;
  interface: string;

  // Content block — contains json_uri
  content: AssetContent;

  // Authorities array — contains mint/freeze/update authority addresses
  authorities: AssetAuthority[];

  // Compression info
  compression?: {
    eligible: boolean;
    compressed: boolean;
    data_hash: string;
    creator_hash: string;
    asset_hash: string;
    tree: string;
    seq: number;
    leaf_id: number;
  };

  // Grouping (e.g. collection)
  grouping?: Array<{ group_key: string; group_value: string }>;

  royalty?: AssetRoyalty;

  // Creators
  creators?: Array<{
    address: string;
    share: number;
    verified: boolean;
  }>;

  // Ownership
  ownership: AssetOwnership;

  // Supply — for fungible tokens contains mint_authority / freeze_authority
  supply?: AssetSupply | null;

  mutable?: boolean;
  burnt?: boolean;

  // Token info for fungible assets
  token_info?: {
    symbol?: string;
    supply?: number;
    decimals?: number;
    token_program?: string;
    associated_token_address?: string;
    mint_authority?: string;
    freeze_authority?: string;
    price_info?: {
      price_per_token?: number;
      currency?: string;
    };
  };
}

/** Normalised result from getAsset */
export interface AssetInfo {
  /** Raw DAS result — log everything for verification */
  raw: AssetResult;

  // Convenience fields extracted from raw
  name: string | null;
  symbol: string | null;
  /** URI pointing at off-chain JSON (IPFS / Arweave) */
  jsonUri: string | null;
  /** All authority addresses extracted from the authorities array */
  authorities: string[];
  /** Mint authority (from token_info or supply) */
  mintAuthority: string | null;
  /** Freeze authority (from token_info or supply) */
  freezeAuthority: string | null;
}

export async function getAsset(apiKey: string, mint: string): Promise<AssetInfo> {
  const raw = await doRpc<AssetResult>(apiKey, "getAsset", {
    id: mint,
    displayOptions: { showFungible: true, showUnverifiedCollections: true },
  });

  const name =
    raw.content?.metadata?.name ??
    raw.token_info?.symbol ??  // fallback
    null;

  const symbol =
    raw.content?.metadata?.symbol ??
    raw.token_info?.symbol ??
    null;

  const jsonUri = raw.content?.json_uri ?? null;

  const authorities = (raw.authorities ?? []).map((a) => a.address);

  // mint_authority / freeze_authority live in token_info for fungibles,
  // or in supply for compressed/edition NFTs.
  const mintAuthority =
    raw.token_info?.mint_authority ??
    raw.supply?.mint_authority ??
    null;

  const freezeAuthority =
    raw.token_info?.freeze_authority ??
    raw.supply?.freeze_authority ??
    null;

  return { raw, name, symbol, jsonUri, authorities, mintAuthority, freezeAuthority };
}

// ─── Token holders ────────────────────────────────────────────────────────────

export interface TokenHolder {
  address: string;
  uiAmount: number;
  percentage: number;
}

export interface HoldersResult {
  totalSupply: number;
  holders: TokenHolder[];
  /** Combined percentage held by the top-10 accounts */
  top10Pct: number;
}

interface SupplyRpcResult {
  value: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

interface LargestAccountsRpcResult {
  value: Array<{
    address: string;
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  }>;
}

export async function getTokenHolders(apiKey: string, mint: string): Promise<HoldersResult> {
  const [supplyResp, largestResp] = await Promise.all([
    doRpc<SupplyRpcResult>(apiKey, "getTokenSupply", [mint]),
    doRpc<LargestAccountsRpcResult>(apiKey, "getTokenLargestAccounts", [mint]),
  ]);

  const totalSupply = supplyResp.value.uiAmount ?? 0;
  if (totalSupply === 0) {
    throw new Error(`getTokenHolders: supply is zero for ${mint}`);
  }

  const holders: TokenHolder[] = largestResp.value.map((v) => ({
    address: v.address,
    uiAmount: v.uiAmount ?? 0,
    percentage: ((v.uiAmount ?? 0) / totalSupply) * 100,
  }));

  const top10Pct = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);

  return { totalSupply, holders, top10Pct };
}

// ─── Dev wallet balance ───────────────────────────────────────────────────────

interface TokenAccountsByOwnerResult {
  value: Array<{
    pubkey: string;
    account: {
      data: {
        parsed: {
          info: {
            tokenAmount: {
              uiAmount: number | null;
            };
          };
        };
      };
    };
  }>;
}

/**
 * Returns the percentage of total supply held by `wallet` for the given `mint`.
 * Returns 0 if the wallet holds no tokens.
 */
export async function getDevWalletBalance(
  apiKey: string,
  wallet: string,
  mint: string,
): Promise<number> {
  const [supplyResp, accountsResp] = await Promise.all([
    doRpc<SupplyRpcResult>(apiKey, "getTokenSupply", [mint]),
    doRpc<TokenAccountsByOwnerResult>(apiKey, "getTokenAccountsByOwner", [
      wallet,
      { mint },
      { encoding: "jsonParsed" },
    ]),
  ]);

  const totalSupply = supplyResp.value.uiAmount ?? 0;
  if (totalSupply === 0) return 0;

  const totalHeld = accountsResp.value.reduce(
    (sum, v) => sum + (v.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
    0,
  );

  return (totalHeld / totalSupply) * 100;
}

// ─── Dev token history ────────────────────────────────────────────────────────

export interface PastToken {
  mint: string;
}

const BAGS_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

interface SignatureInfo {
  signature: string;
  slot?: number;
  err?: unknown;
  memo?: string | null;
  blockTime?: number | null;
}

interface EnhancedTx {
  instructions?: Array<{
    programId: string;
    innerInstructions?: Array<{ programId: string }>;
  }>;
  tokenTransfers?: Array<{ mint: string }>;
}

/**
 * Returns unique token mints created by `wallet` via the Bags.fm program.
 * Uses getSignaturesForAddress (RPC) + /v0/transactions (Helius enhanced REST).
 */
export async function getDevTokenHistory(apiKey: string, wallet: string): Promise<PastToken[]> {
  const sigsResp = await doRpc<SignatureInfo[]>(apiKey, "getSignaturesForAddress", [
    wallet,
    { limit: 100 },
  ]);

  if (!sigsResp.length) return [];

  const sigs = sigsResp.map((s) => s.signature);
  const txs = await doRest<EnhancedTx[]>(apiKey, "/transactions", { transactions: sigs });

  const seen = new Set<string>();
  const mints: PastToken[] = [];

  for (const tx of txs) {
    const hasBags = (tx.instructions ?? []).some(
      (instr) =>
        instr.programId === BAGS_PROGRAM ||
        (instr.innerInstructions ?? []).some((i) => i.programId === BAGS_PROGRAM),
    );
    if (!hasBags) continue;

    for (const tt of tx.tokenTransfers ?? []) {
      if (tt.mint && !seen.has(tt.mint)) {
        seen.add(tt.mint);
        mints.push({ mint: tt.mint });
      }
    }
  }

  return mints;
}
