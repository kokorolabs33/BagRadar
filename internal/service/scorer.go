package service

import "bagradar/internal/repository"

type Scorer struct{}

func NewScorer() *Scorer { return &Scorer{} }

// SafetyInput: on-chain security signals.
type SafetyInput struct {
	DevWalletPct   float64 // creator's % of supply
	LPLocked       bool
	Top10HolderPct float64 // top 10 holders' combined %
}

// CreatorInput: creator credibility signals from Twitter profile.
type CreatorInput struct {
	TwitterFollowers      int
	TwitterAccountAgeDays int
	TwitterVerified       bool
	HasWebsite            bool // website URL from Twitter profile
}

// QualityInput: project presentation + creator history.
type QualityInput struct {
	DescriptionLen  int
	HasWebsite      bool
	HasTwitter      bool
	AbandonedTokens int  // creator's past abandoned tokens
	CleanHistory    bool // creator has tokens AND none abandoned
}

// MomentumInput: market activity signals.
type MomentumInput struct {
	Volume24h      float64
	BuySellRatio   float64
	UniqueBuyers   int
	PriceChange24h float64
	MarketCap      float64
}

// ScoreSafety: LP lock, dev wallet concentration, holder distribution.
// Max raw = 10.
func (s *Scorer) ScoreSafety(in SafetyInput) int {
	pts := 0
	// Dev wallet %
	switch {
	case in.DevWalletPct <= 5:
		pts += 4
	case in.DevWalletPct <= 15:
		pts += 2
	}
	// LP locked
	if in.LPLocked {
		pts += 3
	}
	// Top 10 holder concentration
	switch {
	case in.Top10HolderPct < 30:
		pts += 3
	case in.Top10HolderPct < 50:
		pts += 2
	case in.Top10HolderPct < 70:
		pts += 1
	}
	return clamp(pts, 1, 10)
}

// ScoreCreator: creator credibility based on Twitter profile.
// Max raw = 10.
func (s *Scorer) ScoreCreator(in CreatorInput) int {
	pts := 0
	// Twitter account age
	switch {
	case in.TwitterAccountAgeDays > 365*3:
		pts += 4
	case in.TwitterAccountAgeDays > 365:
		pts += 2
	}
	// Twitter followers
	switch {
	case in.TwitterFollowers > 10000:
		pts += 3
	case in.TwitterFollowers > 1000:
		pts += 2
	}
	// Verified badge
	if in.TwitterVerified {
		pts += 2
	}
	// Website on Twitter profile
	if in.HasWebsite {
		pts += 1
	}
	return clamp(pts, 1, 10)
}

// ScoreQuality: project info completeness + creator track record.
// Max raw = 10.
func (s *Scorer) ScoreQuality(in QualityInput) int {
	pts := 0
	// Description
	switch {
	case in.DescriptionLen > 100:
		pts += 2
	case in.DescriptionLen > 30:
		pts += 1
	}
	// Website
	if in.HasWebsite {
		pts += 3
	}
	// Twitter
	if in.HasTwitter {
		pts += 3
	}
	// Creator history
	if in.AbandonedTokens > 0 {
		pts -= 3
	} else if in.CleanHistory {
		pts += 2
	}
	return clamp(pts, 1, 10)
}

// ScoreMomentum: market traction and trading activity.
// Max raw = 10.
func (s *Scorer) ScoreMomentum(in MomentumInput) int {
	pts := 0
	// Volume
	switch {
	case in.Volume24h > 50000:
		pts += 3
	case in.Volume24h > 10000:
		pts += 2
	case in.Volume24h > 1000:
		pts += 1
	}
	// Buy pressure
	if in.BuySellRatio > 1.5 {
		pts += 2
	} else if in.BuySellRatio > 1.0 {
		pts += 1
	}
	// Unique buyers
	switch {
	case in.UniqueBuyers > 100:
		pts += 2
	case in.UniqueBuyers > 30:
		pts += 1
	}
	// Price momentum
	if in.PriceChange24h > 20 {
		pts += 1
	}
	// Market cap
	switch {
	case in.MarketCap > 1_000_000:
		pts += 2
	case in.MarketCap > 100_000:
		pts += 1
	}
	return clamp(pts, 1, 10)
}

// Composite: weighted average of 4 active dimensions.
// Safety 25% + Creator 20% + Quality 25% + Momentum 30% = 100%
func (s *Scorer) Composite(static repository.StaticScores, dynamic repository.DynamicScores) float64 {
	return float64(static.SafetyScore)*0.25 +
		float64(static.CreatorScore)*0.20 +
		float64(static.QualityScore)*0.25 +
		float64(dynamic.MomentumScore)*0.30
}

func clamp(v, mn, mx int) int {
	if v < mn {
		return mn
	}
	if v > mx {
		return mx
	}
	return v
}
