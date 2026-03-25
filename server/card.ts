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

export async function renderCard(input: CardInput): Promise<Buffer> {
  const { analysis, roast } = input;
  const [font, fontBold] = await Promise.all([loadFont(), loadFontBold()]);

  const m = analysis.market;
  const r = analysis.risk;

  // Build the card markup (satori uses React-like elements as plain objects)
  const markup = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#0a0a0a",
        color: "#ffffff",
        fontFamily: "Inter",
        padding: "48px",
      },
      children: [
        // Header: logo area + token info
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "20px",
              marginBottom: "24px",
            },
            children: [
              // Token image
              analysis.imageUrl
                ? {
                    type: "img",
                    props: {
                      src: analysis.imageUrl,
                      width: 72,
                      height: 72,
                      style: { borderRadius: "50%" },
                    },
                  }
                : {
                    type: "div",
                    props: {
                      style: {
                        width: 72,
                        height: 72,
                        borderRadius: "50%",
                        backgroundColor: "#1f1f1f",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 28,
                        fontWeight: 700,
                      },
                      children: (analysis.symbol ?? "?")[0],
                    },
                  },
              // Name + symbol
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { fontSize: 36, fontWeight: 700 },
                        children: analysis.name ?? "Unknown Token",
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { fontSize: 20, color: "#888888" },
                        children: `$${analysis.symbol ?? "???"}`,
                      },
                    },
                  ],
                },
              },
              // Degen score badge (right side)
              {
                type: "div",
                props: {
                  style: {
                    marginLeft: "auto",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    backgroundColor: "#1a1a1a",
                    borderRadius: "16px",
                    padding: "12px 24px",
                    border: `2px solid ${roast.bagTier.color}`,
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { fontSize: 28 },
                        children: roast.bagTier.emoji,
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: 14,
                          fontWeight: 700,
                          color: roast.bagTier.color,
                        },
                        children: roast.bagTier.label,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },

        // Verdict
        {
          type: "div",
          props: {
            style: {
              fontSize: 24,
              fontWeight: 700,
              color: roast.bagTier.color,
              marginBottom: "20px",
              textTransform: "uppercase",
            },
            children: roast.verdict,
          },
        },

        // Stats row
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              gap: "16px",
              marginBottom: "24px",
            },
            children: [
              statBox("PRICE", m ? formatNum(m.priceUsd) : "N/A"),
              statBox("MCAP", m ? formatNum(m.marketCap) : "N/A"),
              statBox("24H VOL", m ? formatNum(m.volume24h) : "N/A"),
              statBox(
                "24H",
                m ? `${m.priceChange24h > 0 ? "+" : ""}${m.priceChange24h.toFixed(1)}%` : "N/A",
                m ? (m.priceChange24h >= 0 ? "#22c55e" : "#ef4444") : "#888888",
              ),
              statBox(
                "RISK",
                r ? `${r.scoreNormalised}/10` : "N/A",
                r ? riskColor(r.scoreNormalised) : "#888888",
              ),
            ],
          },
        },

        // Roast text (truncated to fit)
        {
          type: "div",
          props: {
            style: {
              fontSize: 16,
              lineHeight: 1.5,
              color: "#cccccc",
              flex: 1,
              overflow: "hidden",
            },
            children: roast.roast.slice(0, 400) + (roast.roast.length > 400 ? "..." : ""),
          },
        },

        // Footer
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "20px",
              paddingTop: "16px",
              borderTop: "1px solid #222222",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { fontSize: 14, color: "#555555" },
                  children: roast.shareLine,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#f97316",
                  },
                  children: "BAGRADAR",
                },
              },
            ],
          },
        },
      ],
    },
  };

  // Render to SVG
  const svg = await satori(markup as any, {
    width: 800,
    height: 500,
    fonts: [
      { name: "Inter", data: font, weight: 400, style: "normal" },
      { name: "Inter", data: fontBold, weight: 700, style: "normal" },
    ],
  });

  // SVG → PNG
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 800 },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// Stat box helper
function statBox(label: string, value: string, valueColor = "#ffffff") {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#1a1a1a",
        borderRadius: "8px",
        padding: "10px 16px",
        flex: 1,
      },
      children: [
        {
          type: "div",
          props: {
            style: { fontSize: 11, color: "#666666", textTransform: "uppercase", marginBottom: "4px" },
            children: label,
          },
        },
        {
          type: "div",
          props: {
            style: { fontSize: 16, fontWeight: 700, color: valueColor },
            children: value,
          },
        },
      ],
    },
  };
}
