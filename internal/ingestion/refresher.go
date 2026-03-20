package ingestion

import (
	"context"
	"log"
	"time"

	"bagradar/internal/repository"
)

// Refresher periodically re-fetches dynamic and static scores for tracked tokens.
type Refresher struct {
	tokens   repository.TokenRepo
	pipeline *Pipeline
}

// NewRefresher creates a Refresher.
func NewRefresher(tokens repository.TokenRepo, pipeline *Pipeline) *Refresher {
	return &Refresher{tokens: tokens, pipeline: pipeline}
}

// Run starts the refresh loop. It blocks until ctx is cancelled.
// Runs an immediate dynamic refresh on startup, then on schedule.
func (r *Refresher) Run(ctx context.Context) {
	log.Println("refresher: started, running initial dynamic refresh...")
	r.refreshDynamic(ctx, "active")

	dynamic5m := time.NewTicker(5 * time.Minute)
	dynamic6h := time.NewTicker(6 * time.Hour)
	static12h := time.NewTicker(12 * time.Hour)
	statusTick := time.NewTicker(1 * time.Hour)
	defer dynamic5m.Stop()
	defer dynamic6h.Stop()
	defer static12h.Stop()
	defer statusTick.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("refresher: stopped")
			return
		case <-dynamic5m.C:
			r.refreshDynamic(ctx, "active")
		case <-dynamic6h.C:
			r.refreshDynamic(ctx, "cooling")
		case <-static12h.C:
			r.refreshStatic(ctx)
		case <-statusTick.C:
			r.updateStatuses(ctx)
		}
	}
}

func (r *Refresher) refreshDynamic(ctx context.Context, status string) {
	tokens, err := r.tokens.ListByStatus(ctx, status)
	if err != nil {
		log.Printf("refresher: list %s error: %v", status, err)
		return
	}
	if len(tokens) == 0 {
		return
	}
	log.Printf("refresher: dynamic refresh %d %s tokens...", len(tokens), status)
	for _, t := range tokens {
		if err := r.pipeline.RefreshDynamic(ctx, t); err != nil {
			log.Printf("refresher: dynamic %s error: %v", t.Mint, err)
		}
	}
	log.Printf("refresher: dynamic refresh %s done", status)
}

func (r *Refresher) refreshStatic(ctx context.Context) {
	tokens, err := r.tokens.ListByStatus(ctx, "active")
	if err != nil {
		return
	}
	refreshed := 0
	for _, t := range tokens {
		needs, _ := r.tokens.NeedsStaticRefresh(ctx, t.Mint, 12*time.Hour)
		if needs {
			if err := r.pipeline.RefreshStatic(ctx, t); err != nil {
				log.Printf("refresher: static %s error: %v", t.Mint, err)
			}
			refreshed++
		}
	}
	if refreshed > 0 {
		log.Printf("refresher: static refresh done, %d/%d tokens updated", refreshed, len(tokens))
	}
}

func (r *Refresher) updateStatuses(ctx context.Context) {
	active, _ := r.tokens.ListByStatus(ctx, "active")
	for _, t := range active {
		if t.LastActiveAt != nil && time.Since(*t.LastActiveAt) > 24*time.Hour {
			_ = r.tokens.UpdateStatus(ctx, t.Mint, "cooling")
		}
	}
	cooling, _ := r.tokens.ListByStatus(ctx, "cooling")
	for _, t := range cooling {
		if t.LastActiveAt != nil && time.Since(*t.LastActiveAt) > 7*24*time.Hour {
			_ = r.tokens.UpdateStatus(ctx, t.Mint, "archived")
		}
	}
}
