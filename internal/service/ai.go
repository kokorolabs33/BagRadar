// internal/service/ai.go
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	"bagradar/internal/repository"
)

const aiCacheTTL = 12 * time.Hour

const systemPrompt = `You are a Solana meme coin analyst. Provide concise, data-driven assessments based on the quantitative data provided.
Requirements: only state key findings, no filler; base assessments on data, not speculation; clearly flag high-risk signals; output strictly in JSON format with no extra text.
Output format: {"summary":"2-3 sentence assessment","strengths":["strength1"],"red_flags":["risk1"],"verdict":"watch"}`

type AIInput struct {
	Token   repository.Token
	Static  repository.StaticScores
	Dynamic repository.DynamicScores
}

type AIService struct {
	tokenRepo repository.TokenRepo
}

func NewAIService(tokenRepo repository.TokenRepo) *AIService {
	return &AIService{tokenRepo: tokenRepo}
}

func (s *AIService) Analyze(ctx context.Context, mint string, input AIInput) (*repository.AIAnalysis, error) {
	cached, err := s.tokenRepo.GetAIAnalysis(ctx, mint)
	if err != nil {
		return nil, err
	}
	if cached != nil && time.Since(cached.GeneratedAt) < aiCacheTTL {
		return cached, nil
	}

	payload, _ := json.Marshal(map[string]any{
		"token": map[string]any{
			"mint": input.Token.Mint, "name": input.Token.Name, "symbol": input.Token.Symbol,
			"description": input.Token.Description, "launchpad": input.Token.Launchpad,
			"twitter": input.Token.Twitter, "website": input.Token.Website,
			"creator": input.Token.CreatorUsername, "status": input.Token.Status,
			"first_seen": input.Token.FirstSeenAt,
		},
		"scores": map[string]any{
			"safety": input.Static.SafetyScore, "creator": input.Static.CreatorScore,
			"quality": input.Static.QualityScore, "momentum": input.Dynamic.MomentumScore,
			"buzz": input.Dynamic.BuzzScore, "composite": input.Dynamic.CompositeScore,
		},
		"safety_detail":  input.Static.SafetyDetail,
		"creator_detail": input.Static.CreatorDetail,
		"quality_detail": input.Static.QualityDetail,
		"market": map[string]any{
			"market_cap": input.Dynamic.MarketCap, "volume_24h": input.Dynamic.Volume24h,
			"price_usd": input.Dynamic.PriceUSD, "price_change_24h": input.Dynamic.PriceChange24h,
			"buy_sell_ratio": input.Dynamic.BuySellRatio, "unique_buyers": input.Dynamic.UniqueBuyers,
		},
	})

	prompt := systemPrompt + "\n\n" + string(payload)
	cmd := exec.CommandContext(ctx, "claude", "-p", prompt, "--output-format", "text")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("claude CLI: %w", err)
	}

	// Claude may wrap JSON in markdown code fences
	text := stripCodeFences(string(out))

	var result struct {
		Summary   string   `json:"summary"`
		Strengths []string `json:"strengths"`
		RedFlags  []string `json:"red_flags"`
		Verdict   string   `json:"verdict"`
	}
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		return nil, fmt.Errorf("parse AI response: %w (%s)", err, text)
	}

	analysis := &repository.AIAnalysis{Summary: result.Summary, Strengths: result.Strengths, RedFlags: result.RedFlags, Verdict: result.Verdict, GeneratedAt: time.Now()}
	_ = s.tokenRepo.SaveAIAnalysis(ctx, mint, analysis)
	return analysis, nil
}

func stripCodeFences(s string) string {
	// Remove ```json ... ``` wrapping
	if idx := indexOf(s, "{"); idx >= 0 {
		s = s[idx:]
	}
	if idx := lastIndexOf(s, "}"); idx >= 0 {
		s = s[:idx+1]
	}
	return s
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func lastIndexOf(s, substr string) int {
	for i := len(s) - len(substr); i >= 0; i-- {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
