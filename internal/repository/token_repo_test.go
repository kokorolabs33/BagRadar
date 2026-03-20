// internal/repository/token_repo_test.go
package repository_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"bagradar/internal/repository"
)

func setupTestDB(t *testing.T) (*repository.PgTokenRepo, func()) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	db, err := repository.NewPostgres(context.Background(), url)
	require.NoError(t, err)
	db.RunMigrations(context.Background(), "../../migrations")
	cleanup := func() {
		db.Pool.Exec(context.Background(), "DELETE FROM tokens CASCADE")
	}
	cleanup()
	return repository.NewPgTokenRepo(db.Pool), cleanup
}

func TestTokenRepo_UpsertAndGet(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	token := &repository.Token{Mint: "MINT1", Name: "TestToken", Launchpad: "bags", Status: "active"}
	require.NoError(t, repo.Upsert(context.Background(), token))

	got, err := repo.GetByMint(context.Background(), "MINT1")
	require.NoError(t, err)
	assert.Equal(t, "TestToken", got.Name)
}

func TestTokenRepo_UpdateStatus(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	_ = repo.Upsert(context.Background(), &repository.Token{Mint: "M2", Name: "T2", Launchpad: "bags", Status: "active"})
	require.NoError(t, repo.UpdateStatus(context.Background(), "M2", "cooling"))

	got, _ := repo.GetByMint(context.Background(), "M2")
	assert.Equal(t, "cooling", got.Status)
}

func TestTokenRepo_NeedsStaticRefresh_WhenNoScores(t *testing.T) {
	repo, cleanup := setupTestDB(t)
	defer cleanup()

	_ = repo.Upsert(context.Background(), &repository.Token{Mint: "M3", Name: "T3", Launchpad: "bags", Status: "active"})
	needs, err := repo.NeedsStaticRefresh(context.Background(), "M3", 12*time.Hour)
	require.NoError(t, err)
	assert.True(t, needs)
}
