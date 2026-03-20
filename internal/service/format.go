package service

import (
	"fmt"
	"strings"

	"bagradar/internal/repository"
)

var verdictEmoji = map[string]string{
	"watch":     "🟢 Worth watching",
	"caution":   "🟡 Proceed with caution",
	"high_risk": "🔴 High risk",
}

func FormatScanReport(token *repository.Token, static *repository.StaticScores,
	dynamic *repository.DynamicScores, ai *repository.AIAnalysis) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "🪙 *%s* (%s)\n\n", Esc(token.Name), Esc(token.Symbol))
	if static != nil {
		fmt.Fprintf(&sb, "🔒 Safety          %d/10\n", static.SafetyScore)
		fmt.Fprintf(&sb, "👤 Creator         %d/10\n", static.CreatorScore)
		fmt.Fprintf(&sb, "🏗️ Quality        %d/10\n", static.QualityScore)
	}
	if dynamic != nil {
		fmt.Fprintf(&sb, "📈 Momentum        %d/10  vol $%.0f\n", dynamic.MomentumScore, dynamic.Volume24h)
		fmt.Fprintf(&sb, "📣 Buzz            %d/10\n\n", dynamic.BuzzScore)
		fmt.Fprintf(&sb, "Composite: *%.1f/10*\n", dynamic.CompositeScore)
	}
	if ai != nil {
		verdict := verdictEmoji[ai.Verdict]
		if verdict == "" {
			verdict = ai.Verdict
		}
		fmt.Fprintf(&sb, "\n💡 *AI Analysis:*\n%s\nVerdict: %s\n", Esc(ai.Summary), verdict)
	}
	if links := BuildLinks(token); links != "" {
		fmt.Fprintf(&sb, "\n🔗 %s", links)
	}
	return sb.String()
}

func FormatInfoReport(token *repository.Token, dynamic *repository.DynamicScores) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "🪙 *%s* (%s)\n\n", Esc(token.Name), Esc(token.Symbol))
	if dynamic != nil {
		fmt.Fprintf(&sb, "Market cap: $%.0f\n24h volume: $%.0f\n", dynamic.MarketCap, dynamic.Volume24h)
	}
	fmt.Fprintf(&sb, "\n🔗 %s", BuildLinks(token))
	return sb.String()
}

func BuildLinks(t *repository.Token) string {
	var parts []string
	if t.Mint != "" {
		parts = append(parts, fmt.Sprintf("[bags.fm](https://bags.fm/%s)", t.Mint))
		parts = append(parts, fmt.Sprintf("[DexScreener](https://dexscreener.com/solana/%s)", t.Mint))
	}
	if t.Twitter != "" {
		parts = append(parts, fmt.Sprintf("[Twitter](%s)", t.Twitter))
	}
	return strings.Join(parts, " | ")
}

func Esc(s string) string {
	r := strings.NewReplacer("_", "\\_", "*", "\\*", "[", "\\[", "`", "\\`")
	return r.Replace(s)
}
