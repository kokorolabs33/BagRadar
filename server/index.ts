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
import {
  getPaymentAmount,
  verifyPayment,
  createSession,
  validateSession,
} from "./payment.js";
import {
  initDb,
  saveShare,
  getShare,
  cleanExpiredShares,
  keepAlive,
} from "./db.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const app = new Hono();

const RPC_URL = "https://mainnet.helius-rpc.com/?api-key=" + process.env.HELIUS_API_KEY;

const env = {
  heliusApiKey: process.env.HELIUS_API_KEY!,
  bagsApiKey: process.env.BAGS_API_KEY!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  twitterAuthToken: process.env.TWITTER_AUTH_TOKEN,
  twitterCt0: process.env.TWITTER_CT0,
  skipPayment: process.env.SKIP_PAYMENT === "true",
  port: Number(process.env.PORT ?? 3000),
};

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use("*", cors());

// ─── Routes ──────────────────────────────────────────────────────────────────

/** Health check */
app.get("/api/health", (c) => c.json({ status: "ok", service: "bagradar" }));

/** Frontend config — tells the frontend if payment is required */
app.get("/api/config", (c) => c.json({ skipPayment: env.skipPayment }));

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

// ─── Payment ─────────────────────────────────────────────────────────────────

/** RPC proxy — lets frontend send transactions without exposing API key */
app.post("/api/rpc", async (c) => {
  const body = await c.req.text();
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.text();
  return new Response(data, {
    headers: { "Content-Type": "application/json" },
  });
});

/** Get current SOL price and payment amount */
app.get("/api/payment/price", async (c) => {
  const info = await getPaymentAmount();
  return c.json(info);
});

/**
 * Verify a SOL payment transaction.
 * Body: { signature: string, mint: string }
 * Returns: { valid, sessionToken?, error? }
 */
app.post("/api/payment/verify", async (c) => {
  const body = await c.req.json<{ signature?: string; mint?: string }>();
  if (!body.signature || !body.mint) {
    return c.json({ error: "signature and mint are required" }, 400);
  }

  const result = await verifyPayment(body.signature, RPC_URL);

  if (result.valid && result.sessionToken) {
    createSession(result.sessionToken, body.mint);
  }

  return c.json(result);
});

/**
 * Paid roast — requires a valid session token from payment verification.
 * Body: { sessionToken: string, analysis: TokenAnalysis, scraped?: ScrapedLinks }
 */
app.post("/api/paid-roast", async (c) => {
  const body = await c.req.json<{
    sessionToken?: string;
    analysis?: TokenAnalysis;
    scraped?: ScrapedLinks | null;
  }>();

  if (!body.analysis) {
    return c.json({ error: "analysis is required" }, 400);
  }

  if (!env.skipPayment) {
    if (!body.sessionToken) {
      return c.json({ error: "sessionToken is required" }, 400);
    }
    if (!validateSession(body.sessionToken, body.analysis.mint)) {
      return c.json({ error: "Invalid or expired session. Please pay again." }, 403);
    }
  }

  const result = await generateRoast(
    body.analysis,
    { openaiApiKey: env.openaiApiKey },
    body.scraped,
  );

  return c.json(result);
});

// ─── Share ────────────────────────────────────────────────────────────────────

const SHARE_BASE_URL = process.env.SHARE_BASE_URL || "https://bags.fm";

/**
 * Save analysis + roast to DB, return share ID.
 * Body: { analysis: TokenAnalysis, roast: RoastResult }
 * Response: { id, shareUrl }
 */
app.post("/api/share", async (c) => {
  const body = await c.req.json<{ analysis?: TokenAnalysis; roast?: any }>();
  if (!body.analysis || !body.roast) {
    return c.json({ error: "analysis and roast are required" }, 400);
  }

  const id = await saveShare(body.analysis, body.roast);
  return c.json({ id, shareUrl: `${SHARE_BASE_URL}/share/${id}` });
});

/** Get share data as JSON */
app.get("/api/share/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getShare(id);
  if (!row) return c.json({ error: "Share not found or expired" }, 404);
  return c.json({ analysis: row.analysis, roast: row.roast, createdAt: row.created_at });
});

/** Get share card as PNG image (for og:image) */
app.get("/api/share/:id/card", async (c) => {
  const id = c.req.param("id");
  const row = await getShare(id);
  if (!row) return c.text("Not found", 404);

  const png = await renderCard({
    analysis: row.analysis as TokenAnalysis,
    roast: row.roast as any,
  });
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

/**
 * Share landing page — returns HTML with OG meta tags so Twitter/X
 * renders the card image as a preview. The page itself redirects to
 * the main site with the share data rendered inline.
 */
app.get("/share/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getShare(id);

  if (!row) {
    return c.html(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <meta http-equiv="refresh" content="0;url=/">
      <title>BagRadar</title>
    </head><body><p>Share expired or not found. Redirecting...</p></body></html>`, 404);
  }

  const analysis = row.analysis as any;
  const roast = row.roast as any;
  const name = analysis.name || "Unknown";
  const symbol = analysis.symbol || "???";
  const tier = roast.bagTier?.label || "Unknown";
  const riskScore = roast.riskScore ?? "?";
  const verdict = roast.verdict || "";
  const cardUrl = `${SHARE_BASE_URL}/api/share/${id}/card`;
  const pageUrl = `${SHARE_BASE_URL}/share/${id}`;

  const title = `${name} ($${symbol}) — ${tier} (${riskScore}/100)`;
  const description = verdict;

  // Escape HTML entities for safe embedding
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | BagRadar</title>

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(cardUrl)}" />
  <meta property="og:url" content="${esc(pageUrl)}" />
  <meta property="og:site_name" content="BagRadar" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@BagRadar_" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(cardUrl)}" />

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
    .container { max-width: 520px; width: 100%; padding: 40px 20px; text-align: center; }
    .brand { font-size: 14px; font-weight: 700; color: #f97316; letter-spacing: 3px; margin-bottom: 24px; }
    .card-img { width: 100%; max-width: 480px; border-radius: 16px; margin-bottom: 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
    .verdict { font-size: 18px; font-weight: 700; color: #ccc; margin-bottom: 12px; }
    .roast-text { font-size: 14px; line-height: 1.7; color: #999; white-space: pre-wrap; margin-bottom: 24px; text-align: left; }
    .expired-note { font-size: 12px; color: #555; margin-bottom: 24px; }
    .cta-btn {
      display: inline-block; padding: 14px 32px; border-radius: 14px; border: none;
      background: linear-gradient(135deg, #f97316, #ea580c); color: #fff;
      font-size: 15px; font-weight: 700; cursor: pointer; text-decoration: none;
      transition: all 0.2s; letter-spacing: 0.5px;
    }
    .cta-btn:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 16px #f9731644; }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">BAGRADAR</div>
    <img class="card-img" src="/api/share/${esc(id)}/card" alt="${esc(title)}" />
    <div class="verdict">${esc(verdict)}</div>
    <div class="roast-text">${esc(roast.roast || "")}</div>
    <div class="expired-note">Data expires 7 days after generation. Market data is a snapshot at time of analysis.</div>
    <a class="cta-btn" href="/">Get Your Bag Roasted</a>
  </div>
</body>
</html>`;

  return c.html(html);
});

// ─── Static files ────────────────────────────────────────────────────────────

app.use("/*", serveStatic({ root: "./public" }));

// ─── Start ───────────────────────────────────────────────────────────────────

// Initialize DB + scheduled tasks, then start server
(async () => {
  try {
    if (process.env.DATABASE_URL) {
      await initDb();

      // Clean expired shares every hour
      setInterval(async () => {
        const n = await cleanExpiredShares();
        if (n > 0) console.log(`[db] Cleaned ${n} expired shares`);
      }, 60 * 60 * 1000);

      // Keep database alive — run once every 24h
      setInterval(async () => {
        await keepAlive();
        console.log("[db] Keepalive ping sent");
      }, 24 * 60 * 60 * 1000);
    } else {
      console.warn("[db] DATABASE_URL not set — share feature disabled");
    }
  } catch (err) {
    console.error("[db] Init failed:", err);
  }

  serve({ fetch: app.fetch, hostname: "0.0.0.0", port: env.port }, (info) => {
    console.log(`BagRadar API running on http://0.0.0.0:${info.port}`);
  });
})();
