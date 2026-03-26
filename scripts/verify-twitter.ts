/**
 * verify-twitter.ts
 * Tests Twitter scraper with cookie auth.
 *
 * Run: npx tsx scripts/verify-twitter.ts [@username or URL]
 */

import "dotenv/config";
import { scrapeTwitterProfile } from "../server/clients/twitter.js";

const authToken = process.env.TWITTER_AUTH_TOKEN;
const ct0 = process.env.TWITTER_CT0;

if (!authToken || !ct0) {
  console.error("Required env vars: TWITTER_AUTH_TOKEN, TWITTER_CT0");
  process.exit(1);
}

const TEST_INPUT = process.argv[2] || "https://twitter.com/JupiterExchange";

async function main() {
  console.log("Twitter Scraper Verification");
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Input: ${TEST_INPUT}\n`);

  const t0 = Date.now();
  const data = await scrapeTwitterProfile(TEST_INPUT, { authToken: authToken!, ct0: ct0! });
  const elapsed = Date.now() - t0;

  console.log("=".repeat(60));
  console.log("  Profile");
  console.log("=".repeat(60));
  console.log(`  username    : @${data.profile.username}`);
  console.log(`  name        : ${data.profile.name}`);
  console.log(`  bio         : ${data.profile.bio}`);
  console.log(`  followers   : ${data.profile.followersCount.toLocaleString()}`);
  console.log(`  following   : ${data.profile.followingCount.toLocaleString()}`);
  console.log(`  tweets      : ${data.profile.tweetsCount.toLocaleString()}`);
  console.log(`  verified    : ${data.profile.isVerified}`);
  console.log(`  joined      : ${data.profile.joined}`);
  console.log(`  avatar      : ${data.profile.avatarUrl}`);

  console.log("\n" + "=".repeat(60));
  console.log(`  Recent Tweets (${data.recentTweets.length})`);
  console.log("=".repeat(60));
  for (const t of data.recentTweets) {
    console.log(`\n  [${t.createdAt ?? "?"}]`);
    console.log(`  ${t.text.slice(0, 150)}`);
    console.log(`  likes: ${t.likes} | retweets: ${t.retweets} | replies: ${t.replies}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Done in ${elapsed}ms`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
