package repository

import "time"

type Token struct {
	Mint            string
	Name            string
	Symbol          string
	Description     string
	Twitter         string
	Website         string
	CreatorUsername string // Bags: platform username; Pump.fun: updateAuthority wallet address
	Provider        string // "github", "twitter", or "" for Pump.fun
	Launchpad       string // "bags" | "pumpfun"
	PairAddress     string
	Status          string // "active" | "cooling" | "archived"
	FirstSeenAt     time.Time
	LastActiveAt    *time.Time
}

type StaticScores struct {
	SafetyScore   int
	CreatorScore  int
	QualityScore  int
	SafetyDetail  map[string]any
	CreatorDetail map[string]any
	QualityDetail map[string]any
	LastRefreshed *time.Time
}

type DynamicScores struct {
	MomentumScore   int
	BuzzScore       int
	Volume24h       float64
	MarketCap       float64
	PriceUSD        float64
	PriceChange24h  float64
	BuySellRatio    float64
	UniqueBuyers    int
	TwitterMentions int
	CompositeScore  float64
	LastRefreshed   *time.Time
}

type AIAnalysis struct {
	Summary     string
	Strengths   []string
	RedFlags    []string
	Verdict     string // "watch" | "caution" | "high_risk"
	GeneratedAt time.Time
}

type User struct {
	TelegramID int64
	Tier       string
	PaidUntil  *time.Time
	Subscribed bool
	CreatedAt  time.Time
}

type PaymentSession struct {
	ID         string
	TelegramID int64
	SolAddress string
	AmountSOL  float64
	ExpiresAt  time.Time
	Paid       bool
}
