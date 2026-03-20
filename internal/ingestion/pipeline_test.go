package ingestion_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"bagradar/internal/ingestion"
	"bagradar/internal/repository"
	"bagradar/internal/service"
)

// stubTokenRepo implements repository.TokenRepo with no-ops.
type stubTokenRepo struct {
	saved []*repository.Token
}

func (s *stubTokenRepo) Upsert(_ context.Context, t *repository.Token) error {
	s.saved = append(s.saved, t)
	return nil
}
func (s *stubTokenRepo) GetByMint(_ context.Context, _ string) (*repository.Token, error) {
	return nil, nil
}
func (s *stubTokenRepo) ListByStatus(_ context.Context, _ string) ([]*repository.Token, error) {
	return nil, nil
}
func (s *stubTokenRepo) UpdateStatus(_ context.Context, _, _ string) error { return nil }
func (s *stubTokenRepo) SetLastActive(_ context.Context, _ string, _ time.Time) error {
	return nil
}
func (s *stubTokenRepo) NeedsStaticRefresh(_ context.Context, _ string, _ time.Duration) (bool, error) {
	return true, nil
}
func (s *stubTokenRepo) SaveStaticScores(_ context.Context, _ string, _ *repository.StaticScores) error {
	return nil
}
func (s *stubTokenRepo) SaveDynamicScores(_ context.Context, _ string, _ *repository.DynamicScores) error {
	return nil
}
func (s *stubTokenRepo) GetStaticScores(_ context.Context, _ string) (*repository.StaticScores, error) {
	return nil, nil
}
func (s *stubTokenRepo) GetDynamicScores(_ context.Context, _ string) (*repository.DynamicScores, error) {
	return nil, nil
}
func (s *stubTokenRepo) SaveAIAnalysis(_ context.Context, _ string, _ *repository.AIAnalysis) error {
	return nil
}
func (s *stubTokenRepo) GetAIAnalysis(_ context.Context, _ string) (*repository.AIAnalysis, error) {
	return nil, nil
}
func (s *stubTokenRepo) TopByComposite(_ context.Context, _ int, _ time.Time) ([]*repository.Token, error) {
	return nil, nil
}

func TestPipeline_ProcessMint_Saves(t *testing.T) {
	repo := &stubTokenRepo{}
	scorer := service.NewScorer()
	p := ingestion.NewPipeline(repo, scorer, nil, nil, nil, nil, nil)

	err := p.ProcessMint(context.Background(), "MINT1", nil)
	require.NoError(t, err)
	assert.Len(t, repo.saved, 1)
	assert.Equal(t, "MINT1", repo.saved[0].Mint)
}
