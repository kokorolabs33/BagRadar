// internal/repository/token_repo.go
package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PgTokenRepo struct{ pool *pgxpool.Pool }

func NewPgTokenRepo(pool *pgxpool.Pool) *PgTokenRepo { return &PgTokenRepo{pool: pool} }

func (r *PgTokenRepo) Upsert(ctx context.Context, t *Token) error {
	_, err := r.pool.Exec(ctx, `
        INSERT INTO tokens (mint, name, symbol, description, twitter, website,
            creator_username, provider, launchpad, pair_address, status, last_active_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (mint) DO UPDATE SET
            name=EXCLUDED.name, symbol=EXCLUDED.symbol, description=EXCLUDED.description,
            twitter=EXCLUDED.twitter, website=EXCLUDED.website,
            creator_username=EXCLUDED.creator_username, provider=EXCLUDED.provider,
            pair_address=EXCLUDED.pair_address, last_active_at=EXCLUDED.last_active_at`,
		t.Mint, t.Name, t.Symbol, t.Description, t.Twitter, t.Website,
		t.CreatorUsername, t.Provider, t.Launchpad, t.PairAddress, t.Status, t.LastActiveAt)
	return err
}

func (r *PgTokenRepo) GetByMint(ctx context.Context, mint string) (*Token, error) {
	var t Token
	err := r.pool.QueryRow(ctx,
		`SELECT mint, name, symbol, description, twitter, website,
                creator_username, provider, launchpad, pair_address, status, first_seen_at, last_active_at
         FROM tokens WHERE mint=$1`, mint).
		Scan(&t.Mint, &t.Name, &t.Symbol, &t.Description, &t.Twitter, &t.Website,
			&t.CreatorUsername, &t.Provider, &t.Launchpad, &t.PairAddress,
			&t.Status, &t.FirstSeenAt, &t.LastActiveAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &t, err
}

func (r *PgTokenRepo) ListByStatus(ctx context.Context, status string) ([]*Token, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT mint, name, symbol, description, twitter, website,
                creator_username, provider, launchpad, pair_address, status, first_seen_at, last_active_at
         FROM tokens WHERE status=$1`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tokens []*Token
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.Mint, &t.Name, &t.Symbol, &t.Description, &t.Twitter, &t.Website,
			&t.CreatorUsername, &t.Provider, &t.Launchpad, &t.PairAddress,
			&t.Status, &t.FirstSeenAt, &t.LastActiveAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, &t)
	}
	return tokens, rows.Err()
}

func (r *PgTokenRepo) UpdateStatus(ctx context.Context, mint, status string) error {
	_, err := r.pool.Exec(ctx, `UPDATE tokens SET status=$1 WHERE mint=$2`, status, mint)
	return err
}

// SetLastActive updates last_active_at and recovers status to 'active' if cooling/archived.
// Also deletes alert_history so the token can be re-alerted after recovery.
func (r *PgTokenRepo) SetLastActive(ctx context.Context, mint string, t time.Time) error {
	_, err := r.pool.Exec(ctx, `
        UPDATE tokens SET last_active_at=$1, status='active' WHERE mint=$2`, t, mint)
	if err != nil {
		return err
	}
	// Delete alert history so a recovered token can trigger a new alert
	_, err = r.pool.Exec(ctx, `DELETE FROM alert_history WHERE mint=$1`, mint)
	return err
}

func (r *PgTokenRepo) NeedsStaticRefresh(ctx context.Context, mint string, maxAge time.Duration) (bool, error) {
	var lastRefreshed *time.Time
	err := r.pool.QueryRow(ctx,
		`SELECT last_refreshed_at FROM token_scores_static WHERE mint=$1`, mint).
		Scan(&lastRefreshed)
	if err == pgx.ErrNoRows || lastRefreshed == nil {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return time.Since(*lastRefreshed) > maxAge, nil
}

func (r *PgTokenRepo) SaveStaticScores(ctx context.Context, mint string, s *StaticScores) error {
	safetyJSON, _ := json.Marshal(s.SafetyDetail)
	creatorJSON, _ := json.Marshal(s.CreatorDetail)
	qualityJSON, _ := json.Marshal(s.QualityDetail)
	_, err := r.pool.Exec(ctx, `
        INSERT INTO token_scores_static
            (mint, safety_score, creator_score, quality_score, safety_detail, creator_detail, quality_detail, last_refreshed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (mint) DO UPDATE SET
            safety_score=EXCLUDED.safety_score, creator_score=EXCLUDED.creator_score,
            quality_score=EXCLUDED.quality_score, safety_detail=EXCLUDED.safety_detail,
            creator_detail=EXCLUDED.creator_detail, quality_detail=EXCLUDED.quality_detail,
            last_refreshed_at=NOW()`,
		mint, s.SafetyScore, s.CreatorScore, s.QualityScore,
		safetyJSON, creatorJSON, qualityJSON)
	return err
}

func (r *PgTokenRepo) SaveDynamicScores(ctx context.Context, mint string, s *DynamicScores) error {
	_, err := r.pool.Exec(ctx, `
        INSERT INTO token_scores_dynamic
            (mint, momentum_score, buzz_score, volume_24h, market_cap, price_usd,
             price_change_24h, buy_sell_ratio, unique_buyers, twitter_mentions,
             composite_score, last_refreshed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (mint) DO UPDATE SET
            momentum_score=EXCLUDED.momentum_score, buzz_score=EXCLUDED.buzz_score,
            volume_24h=EXCLUDED.volume_24h, market_cap=EXCLUDED.market_cap,
            price_usd=EXCLUDED.price_usd, price_change_24h=EXCLUDED.price_change_24h,
            buy_sell_ratio=EXCLUDED.buy_sell_ratio, unique_buyers=EXCLUDED.unique_buyers,
            twitter_mentions=EXCLUDED.twitter_mentions, composite_score=EXCLUDED.composite_score,
            last_refreshed_at=NOW()`,
		mint, s.MomentumScore, s.BuzzScore, s.Volume24h, s.MarketCap, s.PriceUSD,
		s.PriceChange24h, s.BuySellRatio, s.UniqueBuyers, s.TwitterMentions, s.CompositeScore)
	return err
}

func (r *PgTokenRepo) GetStaticScores(ctx context.Context, mint string) (*StaticScores, error) {
	var s StaticScores
	var safetyJSON, creatorJSON, qualityJSON []byte
	err := r.pool.QueryRow(ctx,
		`SELECT safety_score, creator_score, quality_score,
                safety_detail, creator_detail, quality_detail, last_refreshed_at
         FROM token_scores_static WHERE mint=$1`, mint).
		Scan(&s.SafetyScore, &s.CreatorScore, &s.QualityScore,
			&safetyJSON, &creatorJSON, &qualityJSON, &s.LastRefreshed)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal(safetyJSON, &s.SafetyDetail)
	json.Unmarshal(creatorJSON, &s.CreatorDetail)
	json.Unmarshal(qualityJSON, &s.QualityDetail)
	return &s, nil
}

func (r *PgTokenRepo) GetDynamicScores(ctx context.Context, mint string) (*DynamicScores, error) {
	var s DynamicScores
	err := r.pool.QueryRow(ctx,
		`SELECT momentum_score, buzz_score, volume_24h, market_cap, price_usd,
                price_change_24h, buy_sell_ratio, unique_buyers, twitter_mentions,
                composite_score, last_refreshed_at
         FROM token_scores_dynamic WHERE mint=$1`, mint).
		Scan(&s.MomentumScore, &s.BuzzScore, &s.Volume24h, &s.MarketCap, &s.PriceUSD,
			&s.PriceChange24h, &s.BuySellRatio, &s.UniqueBuyers, &s.TwitterMentions,
			&s.CompositeScore, &s.LastRefreshed)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

func (r *PgTokenRepo) SaveAIAnalysis(ctx context.Context, mint string, a *AIAnalysis) error {
	_, err := r.pool.Exec(ctx, `
        INSERT INTO token_ai_analysis (mint, summary, strengths, red_flags, verdict, generated_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (mint) DO UPDATE SET
            summary=EXCLUDED.summary, strengths=EXCLUDED.strengths,
            red_flags=EXCLUDED.red_flags, verdict=EXCLUDED.verdict,
            generated_at=EXCLUDED.generated_at`,
		mint, a.Summary, a.Strengths, a.RedFlags, a.Verdict, a.GeneratedAt)
	return err
}

func (r *PgTokenRepo) GetAIAnalysis(ctx context.Context, mint string) (*AIAnalysis, error) {
	var a AIAnalysis
	err := r.pool.QueryRow(ctx,
		`SELECT summary, strengths, red_flags, verdict, generated_at
         FROM token_ai_analysis WHERE mint=$1`, mint).
		Scan(&a.Summary, &a.Strengths, &a.RedFlags, &a.Verdict, &a.GeneratedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &a, err
}

// TopByComposite returns top N tokens with volume in the last `since` period, ordered by composite score.
func (r *PgTokenRepo) TopByComposite(ctx context.Context, limit int, since time.Time) ([]*Token, error) {
	rows, err := r.pool.Query(ctx, `
        SELECT t.mint, t.name, t.symbol, t.description, t.twitter, t.website,
               t.creator_username, t.provider, t.launchpad, t.pair_address,
               t.status, t.first_seen_at, t.last_active_at
        FROM tokens t
        JOIN token_scores_dynamic d ON d.mint = t.mint
        WHERE d.volume_24h > 0 AND d.last_refreshed_at >= $1
        ORDER BY d.composite_score DESC
        LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tokens []*Token
	for rows.Next() {
		var t Token
		if err := rows.Scan(&t.Mint, &t.Name, &t.Symbol, &t.Description, &t.Twitter, &t.Website,
			&t.CreatorUsername, &t.Provider, &t.Launchpad, &t.PairAddress,
			&t.Status, &t.FirstSeenAt, &t.LastActiveAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, &t)
	}
	return tokens, rows.Err()
}
