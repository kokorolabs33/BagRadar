package repository

import (
	"context"
	"time"
)

type TokenRepo interface {
	Upsert(ctx context.Context, t *Token) error
	GetByMint(ctx context.Context, mint string) (*Token, error)
	ListByStatus(ctx context.Context, status string) ([]*Token, error)
	UpdateStatus(ctx context.Context, mint, status string) error
	SetLastActive(ctx context.Context, mint string, t time.Time) error
	NeedsStaticRefresh(ctx context.Context, mint string, maxAge time.Duration) (bool, error)
	SaveStaticScores(ctx context.Context, mint string, s *StaticScores) error
	SaveDynamicScores(ctx context.Context, mint string, s *DynamicScores) error
	GetStaticScores(ctx context.Context, mint string) (*StaticScores, error)
	GetDynamicScores(ctx context.Context, mint string) (*DynamicScores, error)
	SaveAIAnalysis(ctx context.Context, mint string, a *AIAnalysis) error
	GetAIAnalysis(ctx context.Context, mint string) (*AIAnalysis, error)
	TopByComposite(ctx context.Context, limit int, since time.Time) ([]*Token, error)
}

type UserRepo interface {
	Upsert(ctx context.Context, u *User) error
	GetByTelegramID(ctx context.Context, id int64) (*User, error)
	IsPaid(ctx context.Context, id int64) (bool, error)
	SetPaid(ctx context.Context, id int64, until time.Time) error
	SetSubscribed(ctx context.Context, id int64, subscribed bool) error
	GetSubscribers(ctx context.Context) ([]int64, error)
}

type AlertRepo interface {
	HasAlerted(ctx context.Context, mint string) (bool, error)
	MarkAlerted(ctx context.Context, mint string) error
	DeleteAlert(ctx context.Context, mint string) error
}

type PaymentRepo interface {
	CreateSession(ctx context.Context, s *PaymentSession) error
	GetSessionByAddress(ctx context.Context, solAddress string) (*PaymentSession, error)
	MarkPaid(ctx context.Context, sessionID string) error
	GetActiveSessionByTelegramID(ctx context.Context, telegramID int64) (*PaymentSession, error)
}
