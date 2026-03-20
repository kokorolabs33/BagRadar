package service_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"bagradar/internal/repository"
	"bagradar/internal/service"
)

func TestScoreSafety_Max(t *testing.T) {
	s := service.NewScorer()
	score := s.ScoreSafety(service.SafetyInput{DevWalletPct: 2.0, LPLocked: true, Top10HolderPct: 25.0})
	assert.Equal(t, 10, score) // 4+3+3
}

func TestScoreSafety_MinClamp(t *testing.T) {
	s := service.NewScorer()
	score := s.ScoreSafety(service.SafetyInput{DevWalletPct: 25.0, LPLocked: false, Top10HolderPct: 80.0})
	assert.Equal(t, 1, score) // 0+0+0 → clamped to 1
}

func TestScoreCreator_Full(t *testing.T) {
	s := service.NewScorer()
	score := s.ScoreCreator(service.CreatorInput{
		TwitterAccountAgeDays: 365 * 4, TwitterFollowers: 50000,
		TwitterVerified: true, HasWebsite: true,
	})
	assert.Equal(t, 10, score) // 4+3+2+1
}

func TestScoreCreator_NoTwitter(t *testing.T) {
	s := service.NewScorer()
	score := s.ScoreCreator(service.CreatorInput{})
	assert.Equal(t, 1, score) // 0 → clamped to 1
}

func TestScoreQuality_Full(t *testing.T) {
	s := service.NewScorer()
	score := s.ScoreQuality(service.QualityInput{
		DescriptionLen: 200, HasWebsite: true, HasTwitter: true, CleanHistory: true,
	})
	assert.Equal(t, 10, score) // 2+3+3+2
}

func TestScoreQuality_Abandoned(t *testing.T) {
	s := service.NewScorer()
	score := s.ScoreQuality(service.QualityInput{
		DescriptionLen: 10, HasWebsite: false, HasTwitter: false, AbandonedTokens: 2,
	})
	assert.Equal(t, 1, score) // 0+0+0-3 → clamped to 1
}

func TestScoreMomentum_VolumeTiers(t *testing.T) {
	s := service.NewScorer()
	high := s.ScoreMomentum(service.MomentumInput{Volume24h: 60000})
	mid := s.ScoreMomentum(service.MomentumInput{Volume24h: 5000})
	low := s.ScoreMomentum(service.MomentumInput{Volume24h: 50})
	assert.Equal(t, 3, high) // only volume pts: 3
	assert.Equal(t, 1, mid)  // 1000 < 5000 < 10000 → 1
	assert.Equal(t, 1, low)  // < 1000 → clamped to 1
	assert.GreaterOrEqual(t, high, mid)
}

func TestComposite(t *testing.T) {
	s := service.NewScorer()
	comp := s.Composite(
		repository.StaticScores{SafetyScore: 8, CreatorScore: 5, QualityScore: 7},
		repository.DynamicScores{MomentumScore: 6},
	)
	// 8*0.25 + 5*0.20 + 7*0.25 + 6*0.30 = 2.0+1.0+1.75+1.8 = 6.55
	assert.InDelta(t, 6.55, comp, 0.01)
}
