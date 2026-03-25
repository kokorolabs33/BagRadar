/**
 * Twitter scraper client.
 * Uses @the-convocation/twitter-scraper with cookie-based auth.
 * Env: TWITTER_AUTH_TOKEN, TWITTER_CT0
 */

import { Scraper } from "@the-convocation/twitter-scraper";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TwitterProfile {
  username: string;
  name: string | null;
  bio: string | null;
  followersCount: number;
  followingCount: number;
  tweetsCount: number;
  isVerified: boolean;
  joined: string | null;
  profileUrl: string;
  avatarUrl: string | null;
}

export interface Tweet {
  id: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  createdAt: string | null;
}

export interface TwitterData {
  profile: TwitterProfile;
  recentTweets: Tweet[];
}

// ─── Client ──────────────────────────────────────────────────────────────────

async function createScraper(authToken: string, ct0: string): Promise<Scraper> {
  const scraper = new Scraper();

  await scraper.setCookies([
    `auth_token=${authToken}; Domain=.x.com; Path=/; Secure; HttpOnly`,
    `ct0=${ct0}; Domain=.x.com; Path=/; Secure`,
  ]);

  return scraper;
}

/**
 * Extracts a Twitter username from various input formats.
 */
function extractUsername(input: string): string {
  const match = input.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/);
  if (match) return match[1];
  return input.replace(/^@/, "");
}

/**
 * Scrape a Twitter profile and recent tweets.
 */
export async function scrapeTwitterProfile(
  usernameOrUrl: string,
  config: { authToken: string; ct0: string },
  maxTweets = 5,
): Promise<TwitterData> {
  const username = extractUsername(usernameOrUrl);
  const scraper = await createScraper(config.authToken, config.ct0);

  // Get profile
  const profile = await scraper.getProfile(username);

  const twitterProfile: TwitterProfile = {
    username: profile.username ?? username,
    name: profile.name ?? null,
    bio: profile.biography ?? null,
    followersCount: profile.followersCount ?? 0,
    followingCount: profile.followingCount ?? 0,
    tweetsCount: profile.tweetsCount ?? 0,
    isVerified: profile.isBlueVerified ?? false,
    joined: profile.joined?.toISOString() ?? null,
    profileUrl: `https://x.com/${profile.username ?? username}`,
    avatarUrl: profile.avatar ?? null,
  };

  // Get recent tweets
  const recentTweets: Tweet[] = [];
  const tweetsIter = scraper.getTweets(username, maxTweets);
  for await (const tweet of tweetsIter) {
    recentTweets.push({
      id: tweet.id ?? "",
      text: tweet.text ?? "",
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
      createdAt: tweet.timeParsed?.toISOString() ?? null,
    });
    if (recentTweets.length >= maxTweets) break;
  }

  return { profile: twitterProfile, recentTweets };
}
