/**
 * verify-scraper.ts
 * Tests all scrapers: GitHub, Website, Twitter.
 *
 * Run: npx tsx scripts/verify-scraper.ts
 */

import "dotenv/config";
import { scrapeAllLinks } from "../server/scraper.js";

const twitterAuthToken = process.env.TWITTER_AUTH_TOKEN;
const twitterCt0 = process.env.TWITTER_CT0;

async function main() {
  console.log("Link Scraper Verification");
  console.log(`Date: ${new Date().toISOString()}\n`);

  const t0 = Date.now();
  const result = await scrapeAllLinks(
    {
      github: "https://github.com/jup-ag/jupiter-swap-api-client",
      website: "https://jup.ag",
      twitter: "https://twitter.com/JupiterExchange",
    },
    {
      twitterAuthToken: twitterAuthToken,
      twitterCt0: twitterCt0,
    },
  );
  const elapsed = Date.now() - t0;

  console.log("=".repeat(60));
  console.log(`  Results (${elapsed}ms)`);
  console.log("=".repeat(60));

  // GitHub
  console.log(`\n  GitHub: ${result.github ? `${result.github.owner}/${result.github.repo}` : "null"}`);
  if (result.github) {
    const g = result.github;
    console.log(`    stars: ${g.stars} | forks: ${g.forks} | language: ${g.language}`);
    console.log(`    lastPush: ${g.daysSinceLastPush} days ago`);
    console.log(`    lastCommit: "${g.lastCommitMessage}"`);
  }

  // Website
  console.log(`\n  Website: ${result.website ? `${result.website.title} (${result.website.status})` : "null"}`);
  if (result.website) {
    console.log(`    metaDesc: ${result.website.metaDescription?.slice(0, 100)}`);
  }

  // Twitter
  console.log(`\n  Twitter: ${result.twitter ? `@${result.twitter.profile.username}` : "null"}`);
  if (result.twitter) {
    const t = result.twitter;
    console.log(`    name: ${t.profile.name} | followers: ${t.profile.followersCount.toLocaleString()}`);
    console.log(`    bio: ${t.profile.bio}`);
    console.log(`    recentTweets: ${t.recentTweets.length}`);
    if (t.recentTweets.length) {
      console.log(`    latest: "${t.recentTweets[0].text.slice(0, 100)}..." (${t.recentTweets[0].likes} likes)`);
    }
  }

  // Errors
  console.log(`\n  Errors: ${result.errors.length}`);
  for (const e of result.errors) {
    console.log(`    [${e.source}] ${e.message}`);
  }

  console.log(`\n  Total time: ${elapsed}ms`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
