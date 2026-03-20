package repository

import (
	"context"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PgPaymentRepo struct{ pool *pgxpool.Pool }

func NewPgPaymentRepo(pool *pgxpool.Pool) *PgPaymentRepo { return &PgPaymentRepo{pool: pool} }

func (r *PgPaymentRepo) CreateSession(ctx context.Context, s *PaymentSession) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO payment_sessions (telegram_id, sol_address, amount_sol, expires_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (sol_address) DO UPDATE SET amount_sol=$3, expires_at=$4, paid=false`,
		s.TelegramID, s.SolAddress, s.AmountSOL, s.ExpiresAt)
	return err
}

func (r *PgPaymentRepo) GetSessionByAddress(ctx context.Context, addr string) (*PaymentSession, error) {
	var s PaymentSession
	err := r.pool.QueryRow(ctx,
		`SELECT id, telegram_id, sol_address, amount_sol, expires_at, paid
         FROM payment_sessions WHERE sol_address=$1`, addr).
		Scan(&s.ID, &s.TelegramID, &s.SolAddress, &s.AmountSOL, &s.ExpiresAt, &s.Paid)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

func (r *PgPaymentRepo) MarkPaid(ctx context.Context, sessionID string) error {
	_, err := r.pool.Exec(ctx, `UPDATE payment_sessions SET paid=true WHERE id=$1`, sessionID)
	return err
}

func (r *PgPaymentRepo) GetActiveSessionByTelegramID(ctx context.Context, id int64) (*PaymentSession, error) {
	var s PaymentSession
	err := r.pool.QueryRow(ctx,
		`SELECT id, telegram_id, sol_address, amount_sol, expires_at, paid
         FROM payment_sessions
         WHERE telegram_id=$1 AND paid=false AND expires_at > NOW()
         ORDER BY expires_at DESC LIMIT 1`, id).
		Scan(&s.ID, &s.TelegramID, &s.SolAddress, &s.AmountSOL, &s.ExpiresAt, &s.Paid)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &s, err
}
