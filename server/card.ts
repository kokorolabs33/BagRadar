/**
 * Share Card Generator — renders a shareable PNG image from roast results.
 * Uses satori (markup → SVG) + resvg (SVG → PNG).
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { TokenAnalysis } from "./aggregator.js";
import type { RoastResult } from "./roast.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CardInput {
  analysis: TokenAnalysis;
  roast: RoastResult;
}

// ─── Font loading ────────────────────────────────────────────────────────────

let fontData: ArrayBuffer | null = null;

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch font: ${res.status}`);
  return res.arrayBuffer();
}

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  fontData = await fetchFont(
    "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf",
  );
  return fontData;
}

let fontBoldData: ArrayBuffer | null = null;

async function loadFontBold(): Promise<ArrayBuffer> {
  if (fontBoldData) return fontBoldData;
  fontBoldData = await fetchFont(
    "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf",
  );
  return fontBoldData;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6)}`;
}

// Uses the bagTier color directly from roast result

function riskColor(score: number): string {
  if (score >= 7) return "#ef4444";
  if (score >= 4) return "#f97316";
  return "#22c55e";
}

// ─── Card Renderer (vertical / portrait) ─────────────────────────────────────

const TIER_BG: Record<string, { bg: string; glow: string }> = {
  birkin:  { bg: "linear-gradient(180deg, #060e1f 0%, #0c1e3d 40%, #081428 100%)", glow: "#3b82f6" },
  solid:   { bg: "linear-gradient(180deg, #061f0a 0%, #0c3d14 40%, #081e0a 100%)", glow: "#22c55e" },
  mystery: { bg: "linear-gradient(180deg, #1a1706 0%, #332b0c 40%, #1a1706 100%)", glow: "#eab308" },
  trash:   { bg: "linear-gradient(180deg, #1f0e06 0%, #3d1c0c 40%, #1f0e06 100%)", glow: "#f97316" },
  body:    { bg: "linear-gradient(180deg, #1f0606 0%, #3d0c0c 40%, #1f0606 100%)", glow: "#ef4444" },
};

const W = 480;
const H = 720;

export async function renderCard(input: CardInput): Promise<Buffer> {
  const { analysis, roast } = input;
  const [font, fontBold] = await Promise.all([loadFont(), loadFontBold()]);

  const m = analysis.market;
  const tier = roast.bagTier;
  const { bg, glow } = TIER_BG[tier.tier] ?? TIER_BG.mystery;

  const markup = div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    background: bg,
    color: "#ffffff",
    fontFamily: "Inter",
    position: "relative",
    overflow: "hidden",
  }, [
    // Glow circle behind tier score
    div({
      position: "absolute",
      top: "-60px",
      left: "50%",
      width: "300px",
      height: "300px",
      borderRadius: "50%",
      background: `radial-gradient(circle, ${glow}22 0%, transparent 70%)`,
      transform: "translateX(-50%)",
    }),

    // Top bar
    div({ background: tier.color, height: "3px", width: "100%" }),

    // Content
    div({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "32px 36px 24px",
      flex: 1,
    }, [
      // BAGRADAR brand
      text("BAGRADAR", {
        fontSize: 12,
        fontWeight: 700,
        color: "#f97316",
        letterSpacing: "3px",
        marginBottom: "24px",
      }),

      // Token image (large, centered)
      analysis.imageUrl
        ? { type: "img", props: { src: analysis.imageUrl, width: 88, height: 88, style: { borderRadius: "50%", border: `3px solid ${tier.color}44` } } }
        : div({
            width: "88px", height: "88px", borderRadius: "50%",
            backgroundColor: "#1a1a1a", display: "flex",
            alignItems: "center", justifyContent: "center",
            fontSize: 36, fontWeight: 700, border: `3px solid ${tier.color}44`,
          }, (analysis.symbol ?? "?")[0]),

      // Token name + symbol
      text(analysis.name ?? "Unknown", { fontSize: 28, fontWeight: 700, marginTop: "14px", textAlign: "center" as const }),
      text(`$${analysis.symbol ?? "???"}`, { fontSize: 15, color: "#888", marginTop: "2px" }),

      // Risk score - hero element
      div({
        display: "flex",
        alignItems: "baseline",
        gap: "6px",
        marginTop: "20px",
      }, [
        text(String(roast.riskScore), {
          fontSize: 64, fontWeight: 900, color: tier.color, lineHeight: 1,
        }),
        div({ display: "flex", flexDirection: "column" }, [
          text("/100", { fontSize: 18, color: tier.color + "88", fontWeight: 700 }),
          text("RISK", { fontSize: 10, color: "#666", letterSpacing: "1px", marginTop: "2px" }),
        ]),
      ]),

      // Tier label
      div({
        display: "flex",
        background: tier.color + "22",
        border: `1px solid ${tier.color}66`,
        borderRadius: "20px",
        padding: "6px 20px",
        marginTop: "8px",
      }, text(tier.label.toUpperCase(), {
        fontSize: 13, fontWeight: 700, color: tier.color, letterSpacing: "1.5px",
      })),

      // Verdict
      text(stripEmoji(roast.verdict), {
        fontSize: 16,
        fontWeight: 700,
        color: "#fff",
        textAlign: "center" as const,
        marginTop: "18px",
        textTransform: "uppercase" as const,
        letterSpacing: "0.3px",
      }),

      // Stats grid (2x3)
      div({
        display: "flex",
        flexWrap: "wrap" as const,
        gap: "6px",
        marginTop: "18px",
        width: "100%",
      }, [
        statChip("PRICE", m ? formatNum(m.priceUsd) : "N/A"),
        statChip("MCAP", m ? formatNum(m.marketCap) : "N/A"),
        statChip("VOL 24H", m ? formatNum(m.volume24h) : "N/A"),
        statChip(
          "24H",
          m ? `${m.priceChange24h > 0 ? "+" : ""}${m.priceChange24h.toFixed(1)}%` : "N/A",
          m ? (m.priceChange24h >= 0 ? "#22c55e" : "#ef4444") : "#888",
        ),
        statChip("LIQUIDITY", m ? formatNum(m.liquidityUsd) : "N/A"),
        statChip("HOLDERS TOP10", analysis.holders ? `${analysis.holders.top10Pct.toFixed(0)}%` : "N/A",
          analysis.holders && analysis.holders.top10Pct > 80 ? "#ef4444" : "#fff"),
      ]),

      // Roast excerpt
      div({
        fontSize: 12,
        lineHeight: 1.6,
        color: "#999",
        marginTop: "14px",
        textAlign: "center" as const,
        flex: 1,
        overflow: "hidden",
      }, `"${stripEmoji(roast.roast.split("\n\n")[0]).slice(0, 160)}..."`),

      // Footer
      div({
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        marginTop: "12px",
        paddingTop: "12px",
        borderTop: "1px solid #ffffff10",
        width: "100%",
      },
        text(stripEmoji(roast.shareLine).slice(0, 60), { fontSize: 10, color: "#555", textAlign: "center" as const }),
      ),
    ]),
  ]);

  const svg = await satori(markup as any, {
    width: W,
    height: H,
    fonts: [
      { name: "Inter", data: font, weight: 400, style: "normal" },
      { name: "Inter", data: fontBold, weight: 700, style: "normal" },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: W * 2 } });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ─── Markup helpers ──────────────────────────────────────────────────────────

/** Strip emoji characters that satori can't render */
function stripEmoji(str: string): string {
  return str.replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, "").replace(/\s{2,}/g, " ").trim();
}

function div(style: Record<string, unknown>, children?: unknown): any {
  return { type: "div", props: { style, children } };
}

function text(content: string, style: Record<string, unknown> = {}): any {
  return { type: "div", props: { style, children: content } };
}

function statChip(label: string, value: string, valueColor = "#fff") {
  return div({
    display: "flex", flexDirection: "column", alignItems: "center",
    backgroundColor: "#ffffff08", borderRadius: "8px",
    padding: "8px 8px", width: "31%",
    border: "1px solid #ffffff0a",
  }, [
    text(label, { fontSize: 8, color: "#666", textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: "2px" }),
    text(value, { fontSize: 14, fontWeight: 700, color: valueColor }),
  ]);
}
