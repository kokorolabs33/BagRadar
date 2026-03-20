package repository

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PgAlertRepo struct{ pool *pgxpool.Pool }

func NewPgAlertRepo(pool *pgxpool.Pool) *PgAlertRepo { return &PgAlertRepo{pool: pool} }

func (r *PgAlertRepo) HasAlerted(ctx context.Context, mint string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM alert_history WHERE mint=$1)`, mint).Scan(&exists)
	return exists, err
}

func (r *PgAlertRepo) MarkAlerted(ctx context.Context, mint string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO alert_history (mint) VALUES ($1) ON CONFLICT DO NOTHING`, mint)
	return err
}

func (r *PgAlertRepo) DeleteAlert(ctx context.Context, mint string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM alert_history WHERE mint=$1`, mint)
	return err
}
