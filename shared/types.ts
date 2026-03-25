export interface TokenData {
  name: string | null;
  symbol: string | null;
  mint: string | null;
  description: string | null;
  twitter: string | null;
  website: string | null;
  image: string | null;
  launchpad: string | null;
  creatorWallet: string | null;
  creatorUsername: string | null;
}

export interface SafetyData {
  lpLocked: boolean | null;
  lpLockedBy: string | null;
  mintRevoked: boolean | null;
  freezeRevoked: boolean | null;
  devWalletPct: number | null;
  top10HoldersPct: number | null;
}

export interface SocialData {
  twitterFollowers: number | null;
  twitterAccountAgeDays: number | null;
  twitterVerified: boolean | null;
  hasWebsite: boolean | null;
  hasDescription: boolean | null;
}

export interface MarketData {
  volume24h: number | null;
  marketCap: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  buySellRatio: number | null;
  uniqueBuyers: number | null;
}

export interface LegitimacyData {
  descriptionLength: number | null;
  githubStars: number | null;
  githubLastCommitDays: number | null;
  githubCommitCount30d: number | null;
  creatorPastTokens: number | null;
  creatorAbandonedTokens: number | null;
  lifetimeFeesSol: number | null;
  projectAgeDays: number | null;
  hasWebsite: boolean | null;
}

export interface AggregatedData {
  token: TokenData;
  safety: SafetyData;
  social: SocialData;
  market: MarketData;
  legitimacy: LegitimacyData;
  missingData: string[];
}

export interface ScoreBreakdown {
  safety: number;   // 0-25
  social: number;   // 0-25
  market: number;   // 0-25
  legitimacy: number; // 0-25
  total: number;    // 0-100
}

export type Verdict = 'gem' | 'decent' | 'sketchy' | 'rug_alert';

export interface AIAnalysis {
  summary: string;
  strengths: string[];
  redFlags: string[];
  roast: string; // one-liner for card headline
}

export interface Report {
  id: string;
  mint: string;
  status: 'processing' | 'done' | 'error';
  tokenData?: TokenData;
  scores?: ScoreBreakdown;
  aiAnalysis?: AIAnalysis;
  verdict?: Verdict;
  errorMessage?: string;
  createdAt: string;
}
