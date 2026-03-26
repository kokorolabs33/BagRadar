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

// ─── Card Renderer ───────────────────────────────────────────────────────────

// Tier-specific background gradients
const TIER_GRADIENTS: Record<string, string> = {
  birkin:  "linear-gradient(135deg, #0a1628 0%, #0f2847 50%, #0a1628 100%)",
  solid:   "linear-gradient(135deg, #0a1a0a 0%, #0f2e14 50%, #0a1a0a 100%)",
  mystery: "linear-gradient(135deg, #1a1a0a 0%, #2e2a0f 50%, #1a1a0a 100%)",
  trash:   "linear-gradient(135deg, #1a100a 0%, #2e1a0f 50%, #1a100a 100%)",
  body:    "linear-gradient(135deg, #1a0a0a 0%, #2e0f0f 50%, #1a0a0a 100%)",
};

export async function renderCard(input: CardInput): Promise<Buffer> {
  const { analysis, roast } = input;
  const [font, fontBold] = await Promise.all([loadFont(), loadFontBold()]);

  const m = analysis.market;
  const tier = roast.bagTier;
  const bg = TIER_GRADIENTS[tier.tier] ?? TIER_GRADIENTS.mystery;

  const markup = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: bg,
        color: "#ffffff",
        fontFamily: "Inter",
        padding: "0",
        position: "relative",
      },
      children: [
        // Top accent bar
        div({
          background: tier.color,
          height: "4px",
          width: "100%",
        }),

        // Main content
        div({
          display: "flex",
          flexDirection: "column",
          padding: "36px 44px 28px",
          flex: 1,
        }, [
          // Row 1: Token info + Tier badge
          div({ display: "flex", alignItems: "center", marginBottom: "20px" }, [
            // Token image
            analysis.imageUrl
              ? { type: "img", props: { src: analysis.imageUrl, width: 64, height: 64, style: { borderRadius: "50%", border: "2px solid #333" } } }
              : div({
                  width: "64px", height: "64px", borderRadius: "50%", backgroundColor: "#1f1f1f",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26, fontWeight: 700, border: "2px solid #333",
                }, (analysis.symbol ?? "?")[0]),
            // Name block
            div({ display: "flex", flexDirection: "column", marginLeft: "16px" }, [
              text(analysis.name ?? "Unknown", { fontSize: 32, fontWeight: 700, lineHeight: 1.1 }),
              text(`$${analysis.symbol ?? "???"}`, { fontSize: 16, color: "#888", marginTop: "2px" }),
            ]),
            // Tier badge - the hero element
            div({
              marginLeft: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              background: tier.color + "18",
              border: `2px solid ${tier.color}`,
              borderRadius: "14px",
              padding: "12px 24px",
            }, [
              text(String(roast.riskScore), { fontSize: 36, fontWeight: 700, color: tier.color, lineHeight: 1 }),
              text(tier.label, { fontSize: 12, fontWeight: 700, color: tier.color + "cc", marginTop: "4px", textTransform: "uppercase" as const, letterSpacing: "0.5px" }),
            ]),
          ]),

          // Row 2: Verdict - big and bold
          text(roast.verdict, {
            fontSize: 22,
            fontWeight: 700,
            color: tier.color,
            textTransform: "uppercase" as const,
            letterSpacing: "0.5px",
            marginBottom: "16px",
          }),

          // Row 3: Stats strip
          div({ display: "flex", gap: "8px", marginBottom: "16px" }, [
            statChip("PRICE", m ? formatNum(m.priceUsd) : "N/A"),
            statChip("MCAP", m ? formatNum(m.marketCap) : "N/A"),
            statChip("VOL 24H", m ? formatNum(m.volume24h) : "N/A"),
            statChip(
              "24H",
              m ? `${m.priceChange24h > 0 ? "+" : ""}${m.priceChange24h.toFixed(1)}%` : "N/A",
              m ? (m.priceChange24h >= 0 ? "#22c55e" : "#ef4444") : "#888",
            ),
            statChip("LIQUIDITY", m ? formatNum(m.liquidityUsd) : "N/A"),
          ]),

          // Row 4: Roast excerpt
          div({
            fontSize: 14,
            lineHeight: 1.6,
            color: "#bbb",
            flex: 1,
            overflow: "hidden",
          }, roast.roast.split("\n\n")[0].slice(0, 280) + "..."),

          // Row 5: Footer
          div({
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "16px",
            paddingTop: "14px",
            borderTop: "1px solid #ffffff14",
          }, [
            text(roast.shareLine.slice(0, 80), { fontSize: 12, color: "#666" }),
            div({ display: "flex", alignItems: "center", gap: "6px" }, [
              div({
                width: "8px", height: "8px", borderRadius: "50%",
                backgroundColor: "#f97316",
              }),
              text("BAGRADAR", { fontSize: 16, fontWeight: 700, color: "#f97316", letterSpacing: "1px" }),
            ]),
          ]),
        ]),
      ],
    },
  };

  const svg = await satori(markup as any, {
    width: 800,
    height: 440,
    fonts: [
      { name: "Inter", data: font, weight: 400, style: "normal" },
      { name: "Inter", data: fontBold, weight: 700, style: "normal" },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1600 } }); // 2x for crisp
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ─── Markup helpers ──────────────────────────────────────────────────────────

function div(style: Record<string, unknown>, children?: unknown): any {
  return { type: "div", props: { style, children } };
}

function text(content: string, style: Record<string, unknown> = {}): any {
  return { type: "div", props: { style, children: content } };
}

function statChip(label: string, value: string, valueColor = "#fff") {
  return div({
    display: "flex", flexDirection: "column",
    backgroundColor: "#ffffff08", borderRadius: "8px",
    padding: "8px 12px", flex: 1,
    border: "1px solid #ffffff0a",
  }, [
    text(label, { fontSize: 9, color: "#666", textTransform: "uppercase" as const, marginBottom: "3px", letterSpacing: "0.5px" }),
    text(value, { fontSize: 14, fontWeight: 700, color: valueColor }),
  ]);
}
