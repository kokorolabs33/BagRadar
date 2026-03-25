/**
 * BagRadar API Server — Hono
 *
 * POST /api/analyze  — Stage 1: aggregate on-chain + market data, discover links
 * POST /api/scrape   — Stage 2: scrape link content (GitHub, Website, Twitter)
 * POST /api/roast    — Stage 3: generate AI roast from all collected data
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { serveStatic } from "@hono/node-server/serve-static";

import { aggregateToken, type TokenAnalysis } from "./aggregator.js";
import { scrapeAllLinks, type ScrapedLinks } from "./scraper.js";
import { generateRoast } from "./roast.js";
import { renderCard } from "./card.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const app = new Hono();

const env = {
  heliusApiKey: process.env.HELIUS_API_KEY!,
  bagsApiKey: process.env.BAGS_API_KEY!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  twitterAuthToken: process.env.TWITTER_AUTH_TOKEN,
  twitterCt0: process.env.TWITTER_CT0,
  port: Number(process.env.PORT ?? 3000),
};

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use("*", cors());

// ─── Routes ──────────────────────────────────────────────────────────────────

/** Health check */
app.get("/api/health", (c) => c.json({ status: "ok", service: "bagradar" }));

/**
 * Stage 1: Aggregate on-chain + market data for a token mint.
 * Returns the analysis payload + discovered social links.
 *
 * Body: { mint: string }
 * Response: TokenAnalysis
 */
app.post("/api/analyze", async (c) => {
  const body = await c.req.json<{ mint?: string }>();
  const mint = body.mint?.trim();

  if (!mint) {
    return c.json({ error: "mint is required" }, 400);
  }

  const analysis = await aggregateToken(mint, {
    heliusApiKey: env.heliusApiKey,
    bagsApiKey: env.bagsApiKey,
  });

  return c.json(analysis);
});

/**
 * Stage 2: Scrape link content.
 * Takes auto-discovered + user-provided links and scrapes actual content.
 *
 * Body: { twitter?: string, website?: string, github?: string }
 * Response: ScrapedLinks
 */
app.post("/api/scrape", async (c) => {
  const body = await c.req.json<{
    twitter?: string | null;
    website?: string | null;
    github?: string | null;
  }>();

  const scraped = await scrapeAllLinks(
    {
      twitter: body.twitter,
      website: body.website,
      github: body.github,
    },
    {
      twitterAuthToken: env.twitterAuthToken,
      twitterCt0: env.twitterCt0,
    },
  );

  return c.json(scraped);
});

/**
 * Stage 3: Generate AI roast from aggregated data + scraped content.
 *
 * Body: { analysis: TokenAnalysis, scraped?: ScrapedLinks }
 * Response: RoastResult
 */
app.post("/api/roast", async (c) => {
  const body = await c.req.json<{
    analysis?: TokenAnalysis;
    scraped?: ScrapedLinks | null;
  }>();

  if (!body.analysis) {
    return c.json({ error: "analysis is required" }, 400);
  }

  const result = await generateRoast(
    body.analysis,
    { openaiApiKey: env.openaiApiKey },
    body.scraped,
  );

  return c.json(result);
});

/**
 * All-in-one: aggregate + scrape + roast in a single call.
 * Useful for quick testing or when the frontend doesn't need the interactive flow.
 *
 * Body: { mint: string, links?: { twitter?, website?, github? } }
 * Response: { analysis, scraped, roast }
 */
app.post("/api/full", async (c) => {
  const body = await c.req.json<{
    mint?: string;
    links?: {
      twitter?: string | null;
      website?: string | null;
      github?: string | null;
    };
  }>();

  const mint = body.mint?.trim();
  if (!mint) {
    return c.json({ error: "mint is required" }, 400);
  }

  // Stage 1
  const analysis = await aggregateToken(mint, {
    heliusApiKey: env.heliusApiKey,
    bagsApiKey: env.bagsApiKey,
  });

  // Build scrape links: auto-discovered + user-provided overrides
  const twitterUrl = body.links?.twitter
    ?? analysis.socials.twitter
    ?? (analysis.creator?.twitterUsername ? `https://x.com/${analysis.creator.twitterUsername}` : null);

  // Stage 2
  const scraped = await scrapeAllLinks(
    {
      twitter: twitterUrl,
      website: body.links?.website ?? analysis.socials.website,
      github: body.links?.github ?? null,
    },
    {
      twitterAuthToken: env.twitterAuthToken,
      twitterCt0: env.twitterCt0,
    },
  );

  // Stage 3
  const roast = await generateRoast(
    analysis,
    { openaiApiKey: env.openaiApiKey },
    scraped,
  );

  return c.json({ analysis, scraped, roast });
});

/**
 * Generate a share card PNG from analysis + roast data.
 *
 * Body: { analysis: TokenAnalysis, roast: RoastResult }
 * Response: PNG image
 */
app.post("/api/card", async (c) => {
  const body = await c.req.json<{ analysis?: TokenAnalysis; roast?: any }>();
  if (!body.analysis || !body.roast) {
    return c.json({ error: "analysis and roast are required" }, 400);
  }

  const png = await renderCard({ analysis: body.analysis, roast: body.roast });
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

// ─── Static files ────────────────────────────────────────────────────────────

app.use("/*", serveStatic({ root: "./public" }));

// ─── Start ───────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`BagRadar API running on http://localhost:${info.port}`);
});
