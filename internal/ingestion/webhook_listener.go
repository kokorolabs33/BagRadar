package ingestion

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"

)

const bagsProgramID    = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
const pumpFunProgramID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"

// WebhookListener handles incoming Helius webhook events and dispatches token processing.
type WebhookListener struct {
	pipeline *Pipeline
	secret   string
	workerCh chan func()
}

// NewWebhookListener creates a WebhookListener with a 5-goroutine worker pool.
func NewWebhookListener(p *Pipeline, secret string) *WebhookListener {
	w := &WebhookListener{
		pipeline: p,
		secret:   secret,
		workerCh: make(chan func(), 100),
	}
	for range 5 {
		go func() {
			for fn := range w.workerCh {
				fn()
			}
		}()
	}
	return w
}

// HeliusEvent is the shape of a single event from a Helius webhook payload.
type HeliusEvent struct {
	Source         string `json:"source"`
	TokenTransfers []struct {
		Mint string `json:"mint"`
	} `json:"tokenTransfers"`
}

// Handler returns an http.HandlerFunc that receives Helius webhook POSTs.
func (w *WebhookListener) Handler() http.HandlerFunc {
	return func(rw http.ResponseWriter, r *http.Request) {
		log.Printf("webhook: incoming %s from %s", r.Method, r.RemoteAddr)
		if w.secret != "" && r.Header.Get("Authorization") != "Bearer "+w.secret {
			log.Println("webhook: unauthorized request")
			http.Error(rw, "unauthorized", http.StatusUnauthorized)
			return
		}
		body, _ := io.ReadAll(r.Body)
		var events []HeliusEvent
		if err := json.Unmarshal(body, &events); err != nil {
			log.Printf("webhook: bad request: %v", err)
			http.Error(rw, "bad request", http.StatusBadRequest)
			return
		}
		log.Printf("webhook: received %d events", len(events))
		for _, e := range events {
			event := e
			select {
			case w.workerCh <- func() { w.handleEvent(context.Background(), event) }:
			default:
				log.Println("webhook: worker pool full, dropping event")
			}
		}
		rw.WriteHeader(http.StatusOK)
	}
}

func (w *WebhookListener) handleEvent(ctx context.Context, e HeliusEvent) {
	var mint string
	for _, t := range e.TokenTransfers {
		if t.Mint != "" {
			mint = t.Mint
			break
		}
	}
	if mint == "" {
		log.Printf("webhook: event has no mint, skipping (source=%s)", e.Source)
		return
	}
	log.Printf("webhook: processing mint %s (source=%s)", mint, e.Source)
	hints := &TokenHints{}
	if e.Source == "PUMP_FUN" {
		hints.Launchpad = "pumpfun"
	} else {
		hints.Launchpad = "bags"
	}
	if err := w.pipeline.ProcessMint(ctx, mint, hints); err != nil {
		log.Printf("webhook pipeline error %s: %v", mint, err)
	}
}
