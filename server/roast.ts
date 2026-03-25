/**
 * AI Roast Generator — takes TokenAnalysis + ScrapedLinks and produces a
 * witty, brutally honest analysis report via OpenAI.
 */

import OpenAI from "openai";
import type { TokenAnalysis } from "./aggregator.js";
import type { ScrapedLinks } from "./scraper.js";

// ─── Output ──────────────────────────────────────────────────────────────────

// ─── Bag Tiers ───────────────────────────────────────────────────────────────

export type BagTier = "birkin" | "solid" | "mystery" | "trash" | "body";

export interface BagTierInfo {
  tier: BagTier;
  label: string;
  emoji: string;
  description: string;
  color: string;
}

const BAG_TIERS: Record<BagTier, Omit<BagTierInfo, "tier">> = {
  birkin:  { label: "Birkin Bag",   emoji: "💎", description: "Luxury grade — legit project",          color: "#3b82f6" },
  solid:   { label: "Solid Pack",   emoji: "🎒", description: "Reliable — does the job",               color: "#22c55e" },
  mystery: { label: "Mystery Bag",  emoji: "🛍️", description: "Could be anything — roll the dice",     color: "#eab308" },
  trash:   { label: "Trash Bag",    emoji: "🗑️", description: "Exactly what it sounds like",            color: "#f97316" },
  body:    { label: "Body Bag",     emoji: "💀", description: "You're not coming out of this one",      color: "#ef4444" },
};

export function riskToTier(riskScore: number): BagTierInfo {
  let tier: BagTier;
  if (riskScore <= 20) tier = "birkin";
  else if (riskScore <= 40) tier = "solid";
  else if (riskScore <= 60) tier = "mystery";
  else if (riskScore <= 80) tier = "trash";
  else tier = "body";

  return { tier, ...BAG_TIERS[tier] };
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface RoastResult {
  /** The roast text (markdown-ish, suitable for share card) */
  roast: string;
  /** One-line verdict, e.g. "Certified Rugpull Material" */
  verdict: string;
  /** 0-100 risk score — higher = more dangerous */
  riskScore: number;
  /** Bag tier based on risk score */
  bagTier: BagTierInfo;
  /** Short emoji-rich summary for social sharing */
  shareLine: string;
  /** Model used */
  model: string;
  /** Prompt tokens + completion tokens */
  tokensUsed: { prompt: number; completion: number };
}

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are BagRadar — a savage, witty Web3 analyst who roasts Solana tokens.

Your job: receive raw token data and produce a brutally honest, entertaining analysis.
Be funny but factual. Reference the actual numbers. Don't sugarcoat.

BagRadar uses a Bag Tier system to rate tokens:
  💎 Birkin Bag (0-20 risk)  — Luxury grade, legit project
  🎒 Solid Pack (21-40 risk) — Reliable, does the job
  🛍️ Mystery Bag (41-60 risk) — Could be anything, roll the dice
  🗑️ Trash Bag (61-80 risk)  — Exactly what it sounds like
  💀 Body Bag (81-100 risk)  — You're not coming out of this one

You MUST respond in valid JSON with exactly this shape:
{
  "roast": "string — 3-5 paragraphs of roast/analysis. Use line breaks. Be specific about the data. Reference the bag tier naturally (e.g. 'this is a certified Body Bag situation').",
  "verdict": "string — one punchy line (max 50 chars), e.g. 'Certified Body Bag' or 'Birkin Energy Only'",
  "riskScore": number 0-100 — overall risk assessment. 0=safest, 100=maximum danger. This determines the bag tier.,
  "shareLine": "string — one line with emojis for social sharing, max 100 chars. Include the bag tier emoji."
}

Risk scoring guide (be harsh and realistic):
- mintAuthority NOT null → +30 risk (can mint infinite tokens)
- freezeAuthority NOT null → +20 risk (can freeze your bags)
- top10 holders own >90% → +30 risk, >50% → +15 risk
- RugCheck score >5 → +15 risk
- volume24h < $1k → +20 risk, < $10k → +10 risk
- liquidity $0 or < $1k → +25 risk
- lpLockedPct < 10% → +15 risk
- No Twitter AND no website AND no GitHub → +20 risk
- Token age < 7 days → +10 risk
- Token is rugged → instant 95+ risk
- priceChange24h < -50% → +15 risk

A token with >90% whale hold, $0 liquidity, and no socials should score 80+.
A legit project like JUP with real liquidity, active socials, and GitHub should score 20-40.

Guidelines for scraped data (when available):
- GitHub: mention stars, last commit date, days since last push. Dead repos (>90 days) = red flag. Archived repos = abandoned. Low stars = nobody cares. If README is just a template = lazy devs.
- Website: if status is not 200 = site is down/broken. If title is generic or a template = low effort. Reference the actual meta description if it's funny or vague. If the site just says "JavaScript is not available" = SPA with no SEO = probably fine but worth noting.
- Twitter: mention the handle. If no twitter at all = sus. If username looks like a bot = sus.
- If GitHub, website, AND twitter are all missing = maximum sus, probably a rug.

General:
- Reference the actual token name, symbol, and numbers in your roast
- Keep it entertaining — this is meant to be shared on social media
- Write in English
- Weave the scraped data naturally into the roast, don't just list it`;

// ─── Generator ───────────────────────────────────────────────────────────────

export interface RoastConfig {
  openaiApiKey: string;
  /** Override model. Default: gpt-4.1-mini */
  model?: string;
}

function buildUserPrompt(
  analysis: TokenAnalysis,
  scraped?: ScrapedLinks | null,
): string {
  const sections: string[] = [];

  sections.push(`Token: ${analysis.name ?? "Unknown"} (${analysis.symbol ?? "???"})`);
  sections.push(`Mint: ${analysis.mint}`);
  sections.push(`Analyzed: ${analysis.analyzedAt}`);

  // Identity
  sections.push(`\n## Identity`);
  sections.push(`mintAuthority: ${analysis.mintAuthority ?? "none (renounced)"}`);
  sections.push(`freezeAuthority: ${analysis.freezeAuthority ?? "none (renounced)"}`);
  if (analysis.description) sections.push(`description: ${analysis.description}`);

  // Market
  if (analysis.market) {
    const m = analysis.market;
    sections.push(`\n## Market Data`);
    sections.push(`price: $${m.priceUsd}`);
    sections.push(`marketCap: $${m.marketCap.toLocaleString()}`);
    sections.push(`fdv: $${m.fdv.toLocaleString()}`);
    sections.push(`volume24h: $${m.volume24h.toLocaleString()}`);
    sections.push(`priceChange24h: ${m.priceChange24h}%`);
    sections.push(`buys24h: ${m.buys24h} | sells24h: ${m.sells24h}`);
    sections.push(`liquidityUsd: $${m.liquidityUsd.toLocaleString()}`);
    sections.push(`dex: ${m.dex}`);
    if (m.pairCreatedAt) {
      const age = Date.now() - m.pairCreatedAt;
      const days = Math.floor(age / 86400000);
      sections.push(`age: ${days} days`);
    }
  } else {
    sections.push(`\n## Market Data\n(no market data found — possibly delisted)`);
  }

  // Holders
  if (analysis.holders) {
    const h = analysis.holders;
    sections.push(`\n## Holder Distribution`);
    sections.push(`totalSupply: ${h.totalSupply.toLocaleString()}`);
    sections.push(`top10 concentration: ${h.top10Pct.toFixed(2)}%`);
    for (const th of h.topHolders.slice(0, 5)) {
      sections.push(`  ${th.address.slice(0, 8)}…: ${th.percentage.toFixed(2)}%`);
    }
  }

  // Risk
  if (analysis.risk) {
    const r = analysis.risk;
    sections.push(`\n## Risk Analysis (RugCheck)`);
    sections.push(`riskScore: ${r.scoreNormalised}/10`);
    sections.push(`lpLockedPct: ${r.lpLockedPct.toFixed(2)}%`);
    sections.push(`rugged: ${r.rugged}`);
    if (r.insidersDetected > 0) sections.push(`insidersDetected: ${r.insidersDetected}`);
    if (r.risks.length) {
      sections.push(`risks:`);
      for (const risk of r.risks) {
        sections.push(`  - [${risk.level}] ${risk.name}: ${risk.description}`);
      }
    } else {
      sections.push(`risks: none detected`);
    }
  }

  // Creator
  if (analysis.creator) {
    const c = analysis.creator;
    sections.push(`\n## Creator (Bags.fm)`);
    sections.push(`username: ${c.username}`);
    if (c.twitterUsername) sections.push(`twitter: @${c.twitterUsername}`);
    sections.push(`royalty: ${(c.royaltyBps / 100).toFixed(1)}%`);
    sections.push(`lifetimeFees: ${c.lifetimeFeesSOL.toFixed(4)} SOL`);
  }

  // Socials
  sections.push(`\n## Social Links`);
  sections.push(`twitter: ${analysis.socials.twitter ?? "NOT FOUND"}`);
  sections.push(`website: ${analysis.socials.website ?? "NOT FOUND"}`);
  sections.push(`creatorWallet: ${analysis.creatorWallet ?? "unknown"}`);

  // ── Scraped content (Stage 2) ──
  if (scraped) {
    if (scraped.github) {
      const g = scraped.github;
      sections.push(`\n## GitHub (scraped)`);
      sections.push(`repo: ${g.owner}/${g.repo}`);
      sections.push(`stars: ${g.stars}`);
      sections.push(`forks: ${g.forks}`);
      sections.push(`language: ${g.language ?? "unknown"}`);
      sections.push(`openIssues: ${g.openIssues}`);
      sections.push(`lastPush: ${g.pushedAt} (${g.daysSinceLastPush} days ago)`);
      if (g.lastCommitMessage) sections.push(`lastCommitMsg: "${g.lastCommitMessage}"`);
      sections.push(`archived: ${g.isArchived}`);
      sections.push(`isFork: ${g.isFork}`);
      if (g.description) sections.push(`repoDescription: ${g.description}`);
      if (g.readmeExcerpt) sections.push(`readme (first 300 chars): ${g.readmeExcerpt.slice(0, 300)}`);
    }

    if (scraped.website) {
      const w = scraped.website;
      sections.push(`\n## Website (scraped)`);
      sections.push(`url: ${w.url}`);
      sections.push(`status: ${w.status} ${w.ok ? "OK" : "BROKEN"}`);
      sections.push(`responseTime: ${w.responseTimeMs}ms`);
      if (w.title) sections.push(`title: ${w.title}`);
      if (w.metaDescription) sections.push(`metaDescription: ${w.metaDescription}`);
      if (w.textExcerpt) sections.push(`pageContent (first 300 chars): ${w.textExcerpt.slice(0, 300)}`);
    }

    if (scraped.twitter) {
      const t = scraped.twitter;
      sections.push(`\n## Twitter (scraped)`);
      sections.push(`handle: @${t.profile.username}`);
      sections.push(`name: ${t.profile.name}`);
      sections.push(`bio: ${t.profile.bio}`);
      sections.push(`followers: ${t.profile.followersCount.toLocaleString()}`);
      sections.push(`following: ${t.profile.followingCount.toLocaleString()}`);
      sections.push(`totalTweets: ${t.profile.tweetsCount.toLocaleString()}`);
      sections.push(`verified: ${t.profile.isVerified}`);
      if (t.profile.joined) sections.push(`joined: ${t.profile.joined}`);
      if (t.recentTweets.length) {
        sections.push(`recentTweets (${t.recentTweets.length}):`);
        for (const tw of t.recentTweets.slice(0, 3)) {
          sections.push(`  - "${tw.text.slice(0, 120)}" (${tw.likes} likes, ${tw.retweets} RTs)`);
        }
      }
    }

    if (!scraped.github && !scraped.website && !scraped.twitter) {
      sections.push(`\n## Scraped Data\n(no GitHub, website, or Twitter found — very suspicious)`);
    }
  }

  // Errors
  if (analysis.errors.length) {
    sections.push(`\n## Data Gaps`);
    for (const e of analysis.errors) {
      sections.push(`  - ${e.source}: failed`);
    }
  }

  return sections.join("\n");
}

export async function generateRoast(
  analysis: TokenAnalysis,
  config: RoastConfig,
  scraped?: ScrapedLinks | null,
): Promise<RoastResult> {
  const model = config.model ?? "gpt-4.1-mini";
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const response = await client.chat.completions.create({
    model,
    temperature: 0.9,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(analysis, scraped) },
    ],
  });

  const choice = response.choices[0];
  if (!choice?.message?.content) {
    throw new Error("OpenAI returned empty response");
  }

  const parsed = JSON.parse(choice.message.content) as {
    roast: string;
    verdict: string;
    riskScore: number;
    shareLine: string;
  };

  const riskScore = Math.max(0, Math.min(100, Math.round(parsed.riskScore)));

  return {
    roast: parsed.roast,
    verdict: parsed.verdict,
    riskScore,
    bagTier: riskToTier(riskScore),
    shareLine: parsed.shareLine,
    model,
    tokensUsed: {
      prompt: response.usage?.prompt_tokens ?? 0,
      completion: response.usage?.completion_tokens ?? 0,
    },
  };
}
