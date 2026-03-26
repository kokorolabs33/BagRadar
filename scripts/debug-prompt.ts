/**
 * debug-prompt.ts
 * Runs Stage 1 + Stage 2 and outputs the final prompt that would be sent to AI.
 *
 * Run: npx tsx scripts/debug-prompt.ts <mint>
 */

import "dotenv/config";
import { aggregateToken } from "../server/aggregator.js";
import { scrapeAllLinks, type ScrapedLinks } from "../server/scraper.js";
import type { TokenAnalysis } from "../server/aggregator.js";

const heliusApiKey = process.env.HELIUS_API_KEY!;
const bagsApiKey = process.env.BAGS_API_KEY!;
const twitterAuthToken = process.env.TWITTER_AUTH_TOKEN;
const twitterCt0 = process.env.TWITTER_CT0;

const MINT = process.argv[2] || "EMNTeTJmGmLRBhJ19i6YK9763TyRSBbTAfj7kecABAGS";

// Replicate the prompt builder from roast.ts
function buildUserPrompt(analysis: TokenAnalysis, scraped?: ScrapedLinks | null): string {
  const sections: string[] = [];

  sections.push(`Token: ${analysis.name ?? "Unknown"} (${analysis.symbol ?? "???"})`);
  sections.push(`Mint: ${analysis.mint}`);
  sections.push(`Analyzed: ${analysis.analyzedAt}`);

  sections.push(`\n## Identity`);
  sections.push(`mintAuthority: ${analysis.mintAuthority ?? "none (renounced)"}`);
  sections.push(`freezeAuthority: ${analysis.freezeAuthority ?? "none (renounced)"}`);
  if (analysis.description) sections.push(`description: ${analysis.description}`);

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
      const days = Math.floor((Date.now() - m.pairCreatedAt) / 86400000);
      sections.push(`age: ${days} days`);
    }
  } else {
    sections.push(`\n## Market Data\n(no market data found — possibly delisted)`);
  }

  if (analysis.holders) {
    const h = analysis.holders;
    sections.push(`\n## Holder Distribution`);
    sections.push(`totalSupply: ${h.totalSupply.toLocaleString()}`);
    sections.push(`top10 concentration: ${h.top10Pct.toFixed(2)}%`);
    for (const th of h.topHolders.slice(0, 5)) {
      sections.push(`  ${th.address.slice(0, 8)}…: ${th.percentage.toFixed(2)}%`);
    }
  }

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

  if (analysis.creator) {
    const c = analysis.creator;
    sections.push(`\n## Creator (Bags.fm)`);
    sections.push(`username: ${c.username}`);
    if (c.twitterUsername) sections.push(`twitter: @${c.twitterUsername}`);
    sections.push(`royalty: ${(c.royaltyBps / 100).toFixed(1)}%`);
    sections.push(`lifetimeFees: ${c.lifetimeFeesSOL.toFixed(4)} SOL`);
  }

  sections.push(`\n## Social Links`);
  sections.push(`twitter: ${analysis.socials.twitter ?? "NOT FOUND"}`);
  sections.push(`website: ${analysis.socials.website ?? "NOT FOUND"}`);
  sections.push(`creatorWallet: ${analysis.creatorWallet ?? "unknown"}`);

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

  if (analysis.errors.length) {
    sections.push(`\n## Data Gaps`);
    for (const e of analysis.errors) {
      sections.push(`  - ${e.source}: failed`);
    }
  }

  return sections.join("\n");
}

async function main() {
  console.log(`=== Debug Prompt for ${MINT} ===\n`);

  // Stage 1
  console.log("[Stage 1] Aggregating...");
  const t0 = Date.now();
  const analysis = await aggregateToken(MINT, { heliusApiKey, bagsApiKey });
  console.log(`  Done in ${Date.now() - t0}ms\n`);

  // Determine what to scrape
  const twitterUrl = analysis.socials.twitter
    ?? (analysis.creator?.twitterUsername ? `https://x.com/${analysis.creator.twitterUsername}` : null);

  // Stage 2
  console.log("[Stage 2] Scraping links...");
  const t1 = Date.now();
  const scraped = await scrapeAllLinks(
    {
      twitter: twitterUrl,
      website: analysis.socials.website,
      github: null, // would come from user input
    },
    { twitterAuthToken, twitterCt0 },
  );
  console.log(`  Done in ${Date.now() - t1}ms\n`);

  // Build prompt
  const userPrompt = buildUserPrompt(analysis, scraped);

  console.log("=".repeat(70));
  console.log("  SYSTEM PROMPT");
  console.log("=".repeat(70));
  console.log(`You are BagRadar — a savage, witty Web3 analyst who roasts Solana tokens.

Your job: receive raw token data and produce a brutally honest, entertaining analysis.
Be funny but factual. Reference the actual numbers. Don't sugarcoat.

[... response format + guidelines ...]`);

  console.log("\n" + "=".repeat(70));
  console.log("  USER PROMPT (this is what gets sent to AI)");
  console.log("=".repeat(70));
  console.log(userPrompt);

  console.log("\n" + "=".repeat(70));
  console.log("  RAW DATA (JSON)");
  console.log("=".repeat(70));
  console.log(JSON.stringify({ analysis, scraped }, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
