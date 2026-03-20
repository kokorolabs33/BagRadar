package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PgUserRepo struct{ pool *pgxpool.Pool }

func NewPgUserRepo(pool *pgxpool.Pool) *PgUserRepo { return &PgUserRepo{pool: pool} }

func (r *PgUserRepo) Upsert(ctx context.Context, u *User) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING`, u.TelegramID)
	return err
}

func (r *PgUserRepo) GetByTelegramID(ctx context.Context, id int64) (*User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT telegram_id, tier, paid_until, subscribed, created_at FROM users WHERE telegram_id=$1`, id).
		Scan(&u.TelegramID, &u.Tier, &u.PaidUntil, &u.Subscribed, &u.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

// IsPaid checks paid_until > NOW() — does not rely on the tier field.
func (r *PgUserRepo) IsPaid(ctx context.Context, id int64) (bool, error) {
	var paidUntil *time.Time
	err := r.pool.QueryRow(ctx, `SELECT paid_until FROM users WHERE telegram_id=$1`, id).Scan(&paidUntil)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return paidUntil != nil && paidUntil.After(time.Now()), nil
}

func (r *PgUserRepo) SetPaid(ctx context.Context, id int64, until time.Time) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users (telegram_id, tier, paid_until) VALUES ($1,'paid',$2)
         ON CONFLICT (telegram_id) DO UPDATE SET tier='paid', paid_until=$2`, id, until)
	return err
}

func (r *PgUserRepo) SetSubscribed(ctx context.Context, id int64, subscribed bool) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users (telegram_id, subscribed) VALUES ($1,$2)
         ON CONFLICT (telegram_id) DO UPDATE SET subscribed=$2`, id, subscribed)
	return err
}

// GetSubscribers returns telegram IDs of paid, subscribed users.
func (r *PgUserRepo) GetSubscribers(ctx context.Context) ([]int64, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT telegram_id FROM users WHERE subscribed=true AND paid_until > NOW()`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
