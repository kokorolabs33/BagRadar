package ingestion

import (
	"context"
	"log/slog"
	"time"

	"bagradar/internal/api/bags"
	"bagradar/internal/api/helius"
	"bagradar/internal/repository"
)

// WSMonitor listens for new Bags token creations via Helius WebSocket
// and feeds them into the ingestion pipeline.
type WSMonitor struct {
	ws       *helius.WSClient
	bags     *bags.Client
	tokens   repository.TokenRepo
	pipeline *Pipeline
}

// NewWSMonitor creates a WSMonitor.
func NewWSMonitor(ws *helius.WSClient, bagsClient *bags.Client, tokens repository.TokenRepo, pipeline *Pipeline) *WSMonitor {
	return &WSMonitor{ws: ws, bags: bagsClient, tokens: tokens, pipeline: pipeline}
}

// Run starts the WebSocket monitor. It blocks until ctx is cancelled.
func (m *WSMonitor) Run(ctx context.Context) {
	slog.Info("websocket monitor started")
	m.ws.StreamNewTokens(ctx, func(event helius.NewTokenEvent) {
		// Skip if already in the database
		if existing, _ := m.tokens.GetByMint(ctx, event.TokenMint); existing != nil {
			return
		}

		hints := &TokenHints{Launchpad: event.Platform}
		if hints.Launchpad == "" {
			hints.Launchpad = "bags"
		}

		// Try to enrich from Bags feed — retry up to 3 times with delay
		// because the WebSocket fires before the feed API is updated
		enriched := false
		for attempt := 0; attempt < 3 && !enriched; attempt++ {
			if attempt > 0 {
				time.Sleep(time.Duration(attempt*3) * time.Second) // 3s, 6s
			}
			if feed, err := m.bags.GetFeed(); err == nil {
				for _, t := range feed {
					if t.TokenMint == event.TokenMint {
						creator := ""
						if len(t.AccountKeys) > 2 {
							creator = t.AccountKeys[2]
						}
						hints = &TokenHints{
							Name:            t.Name,
							Symbol:          t.Symbol,
							Description:     t.Description,
							Twitter:         t.Twitter,
							Website:         t.Website,
							CreatorUsername: creator,
							Launchpad:       "bags",
						}
						enriched = true
						break
					}
				}
			}
		}
		if !enriched {
			slog.Debug("websocket: metadata not in feed yet, proceeding without", "mint", event.TokenMint)
		}

		if err := m.pipeline.ProcessMint(ctx, event.TokenMint, hints); err != nil {
			slog.Warn("websocket: pipeline error", "mint", event.TokenMint, "err", err)
		}
	})
}
