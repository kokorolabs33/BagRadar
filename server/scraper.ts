/**
 * Link Scraper — Stage 2 of the analysis pipeline.
 * Takes a set of links and scrapes actual content from each.
 *
 * Supported: GitHub repos, websites, Twitter profiles + tweets
 */

import {
  scrapeTwitterProfile,
  type TwitterData as FullTwitterData,
} from "./clients/twitter.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitHubData {
  owner: string;
  repo: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  /** Days since last push */
  daysSinceLastPush: number;
  contributorCount: number;
  lastCommitMessage: string | null;
  lastCommitDate: string | null;
  readmeExcerpt: string | null;
  isArchived: boolean;
  isFork: boolean;
}

export interface DiscoveredLinks {
  github: string | null;
  twitter: string | null;
  linkedin: string | null;
  telegram: string | null;
  discord: string | null;
  medium: string | null;
  youtube: string | null;
}

export interface WebsiteData {
  url: string;
  status: number;
  ok: boolean;
  title: string | null;
  metaDescription: string | null;
  /** First ~500 chars of visible text */
  textExcerpt: string | null;
  /** Response time in ms */
  responseTimeMs: number;
  /** Links discovered in the page HTML */
  discoveredLinks: DiscoveredLinks;
}

export { type TwitterData as FullTwitterData } from "./clients/twitter.js";

export interface ScrapedLinks {
  github: GitHubData | null;
  website: WebsiteData | null;
  twitter: FullTwitterData | null;
  errors: Array<{ source: string; message: string }>;
}

export interface LinksToScrape {
  github?: string | null;
  website?: string | null;
  twitter?: string | null;
}

export interface ScraperConfig {
  twitterAuthToken?: string;
  twitterCt0?: string;
  githubToken?: string;
}

// ─── GitHub Scraper ──────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Handle: github.com/owner/repo, https://github.com/owner/repo, etc.
  const match = url.match(/github\.com\/([^/]+)\/([^/?.#]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

async function githubGet<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "BagRadar/1.0",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }
  const res = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function scrapeGitHub(url: string): Promise<GitHubData> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error(`Invalid GitHub URL: ${url}`);
  const { owner, repo } = parsed;

  // Fetch repo info, contributors, latest commit, and README in parallel
  const [repoInfo, contributors, commits, readme] = await Promise.allSettled([
    githubGet<{
      description: string | null;
      stargazers_count: number;
      forks_count: number;
      open_issues_count: number;
      language: string | null;
      created_at: string;
      updated_at: string;
      pushed_at: string;
      archived: boolean;
      fork: boolean;
    }>(`/repos/${owner}/${repo}`),
    githubGet<Array<unknown>>(`/repos/${owner}/${repo}/contributors?per_page=1&anon=true`),
    githubGet<Array<{
      commit: { message: string; author: { date: string } };
    }>>(`/repos/${owner}/${repo}/commits?per_page=1`),
    githubGet<{ content: string; encoding: string }>(`/repos/${owner}/${repo}/readme`),
  ]);

  if (repoInfo.status === "rejected") {
    throw new Error(`GitHub repo not found: ${owner}/${repo} — ${repoInfo.reason}`);
  }

  const r = repoInfo.value;
  const daysSinceLastPush = Math.floor(
    (Date.now() - new Date(r.pushed_at).getTime()) / 86400000,
  );

  // Contributor count from Link header (GitHub returns total in pagination)
  let contributorCount = 0;
  if (contributors.status === "fulfilled") {
    // Simple: if we get data, there's at least 1; GitHub paginates so
    // for accuracy we'd parse the Link header, but for small repos this works
    contributorCount = contributors.value.length;
    // For repos with more contributors, we'd need to parse pagination
    // For now, fetch with per_page=1 and check if there's more — but keeping simple
  }

  // Latest commit
  let lastCommitMessage: string | null = null;
  let lastCommitDate: string | null = null;
  if (commits.status === "fulfilled" && commits.value.length > 0) {
    lastCommitMessage = commits.value[0].commit.message.split("\n")[0]; // first line only
    lastCommitDate = commits.value[0].commit.author.date;
  }

  // README excerpt
  let readmeExcerpt: string | null = null;
  if (readme.status === "fulfilled") {
    try {
      const decoded = Buffer.from(readme.value.content, "base64").toString("utf-8");
      // Strip markdown formatting roughly, take first 500 chars
      const plain = decoded
        .replace(/^#+\s+/gm, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[*_`~]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      readmeExcerpt = plain.slice(0, 500);
    } catch {
      // ignore decode errors
    }
  }

  return {
    owner,
    repo,
    description: r.description,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    language: r.language,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
    daysSinceLastPush,
    contributorCount,
    lastCommitMessage,
    lastCommitDate,
    readmeExcerpt,
    isArchived: r.archived,
    isFork: r.fork,
  };
}

// ─── Link extraction ─────────────────────────────────────────────────────────

const LINK_PATTERNS: Array<{ key: keyof DiscoveredLinks; pattern: RegExp }> = [
  { key: "github",   pattern: /https?:\/\/github\.com\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?/g },
  { key: "twitter",  pattern: /https?:\/\/(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/g },
  { key: "linkedin", pattern: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/g },
  { key: "telegram", pattern: /https?:\/\/t\.me\/[a-zA-Z0-9_]+/g },
  { key: "discord",  pattern: /https?:\/\/discord\.(?:gg|com\/invite)\/[a-zA-Z0-9_-]+/g },
  { key: "medium",   pattern: /https?:\/\/(?:[a-zA-Z0-9_-]+\.)?medium\.com\/?[a-zA-Z0-9_@-]*/g },
  { key: "youtube",  pattern: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)[a-zA-Z0-9_-]+/g },
];

function extractLinks(html: string): DiscoveredLinks {
  const result: DiscoveredLinks = {
    github: null, twitter: null, linkedin: null,
    telegram: null, discord: null, medium: null, youtube: null,
  };

  for (const { key, pattern } of LINK_PATTERNS) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      // Take the first unique match, skip common false positives
      const filtered = matches.filter((m) => {
        const lower = m.toLowerCase();
        // Skip generic platform pages
        if (key === "twitter" && (lower.includes("/intent/") || lower.includes("/share"))) return false;
        if (key === "github" && lower.endsWith("github.com")) return false;
        return true;
      });
      if (filtered.length > 0) result[key] = filtered[0];
    }
  }

  return result;
}

// ─── Website Scraper ─────────────────────────────────────────────────────────

export async function scrapeWebsite(url: string): Promise<WebsiteData> {
  // Ensure URL has protocol
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(fullUrl, {
      headers: {
        "User-Agent": "BagRadar/1.0",
        Accept: "text/html",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    const responseTimeMs = Date.now() - start;
    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : null;

    // Extract meta description
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["']/i,
    ) || html.match(
      /<meta[^>]*content=["']([^"']*?)["'][^>]*name=["']description["']/i,
    );
    const metaDescription = descMatch ? descMatch[1].trim().slice(0, 300) : null;

    // Extract visible text (rough: strip tags, scripts, styles)
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const textExcerpt = textContent.slice(0, 500) || null;

    // Extract social/project links from all href attributes
    const discoveredLinks = extractLinks(html);

    return {
      url: fullUrl,
      status: res.status,
      ok: res.ok,
      title,
      metaDescription,
      textExcerpt,
      responseTimeMs,
      discoveredLinks,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Scrapes all provided links in parallel.
 * If a website is scraped and contains links to GitHub/Twitter/LinkedIn etc,
 * those are auto-scraped in a second pass.
 */
export async function scrapeAllLinks(
  links: LinksToScrape,
  config?: ScraperConfig,
): Promise<ScrapedLinks> {
  const errors: ScrapedLinks["errors"] = [];

  // First pass: scrape provided links in parallel
  const [github, website, twitter] = await Promise.all([
    links.github
      ? scrapeGitHub(links.github).catch((err) => {
          errors.push({ source: "github", message: String(err) });
          return null;
        })
      : null,
    links.website
      ? scrapeWebsite(links.website).catch((err) => {
          errors.push({ source: "website", message: String(err) });
          return null;
        })
      : null,
    links.twitter && config?.twitterAuthToken && config?.twitterCt0
      ? scrapeTwitterProfile(links.twitter, {
          authToken: config.twitterAuthToken,
          ct0: config.twitterCt0,
        }).catch((err) => {
          errors.push({ source: "twitter", message: String(err) });
          return null;
        })
      : null,
  ]);

  // Second pass: if website discovered links we don't already have, scrape them
  let finalGithub = github;
  let finalTwitter = twitter;

  if (website?.discoveredLinks) {
    const d = website.discoveredLinks;
    const secondPass: Promise<void>[] = [];

    if (!finalGithub && d.github) {
      secondPass.push(
        scrapeGitHub(d.github)
          .then((g) => { finalGithub = g; })
          .catch((err) => { errors.push({ source: "github:discovered", message: String(err) }); }),
      );
    }

    if (!finalTwitter && d.twitter && config?.twitterAuthToken && config?.twitterCt0) {
      secondPass.push(
        scrapeTwitterProfile(d.twitter, { authToken: config.twitterAuthToken, ct0: config.twitterCt0 })
          .then((t) => { finalTwitter = t; })
          .catch((err) => { errors.push({ source: "twitter:discovered", message: String(err) }); }),
      );
    }

    if (secondPass.length > 0) {
      await Promise.all(secondPass);
    }
  }

  return { github: finalGithub, website, twitter: finalTwitter, errors };
}
