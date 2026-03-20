package ingestion

import (
	"context"
	"log"

	"bagradar/internal/api/bags"
	"bagradar/internal/repository"
)

// Initializer seeds the DB from Bags.fm feed + Pump.fun when empty.
// Ongoing token discovery is handled by Helius webhooks.
type Initializer struct {
	tokens   repository.TokenRepo
	bags     *bags.Client
	pipeline *Pipeline
}

func NewInitializer(tokens repository.TokenRepo, bagsClient *bags.Client, pipeline *Pipeline) *Initializer {
	return &Initializer{tokens: tokens, bags: bagsClient, pipeline: pipeline}
}

// Run seeds the DB from Bags.fm feed + Pump.fun if empty.
func (i *Initializer) Run(ctx context.Context) error {
	active, _ := i.tokens.ListByStatus(ctx, "active")
	if len(active) > 0 {
		log.Printf("initializer: DB has %d active tokens, skipping seed", len(active))
		return nil
	}

	log.Println("initializer: DB empty, seeding from Bags.fm + Pump.fun...")
	var total int

	// Bags.fm feed — discovery only, pipeline handles all enrichment
	feed, err := i.bags.GetFeed()
	if err != nil {
		log.Printf("initializer: bags feed error: %v", err)
	} else {
		log.Printf("initializer: got %d tokens from Bags.fm feed", len(feed))
		for idx, ft := range feed {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// accountKeys[2] is typically the creator wallet on Bags.fm
			creator := ""
			if len(ft.AccountKeys) > 2 {
				creator = ft.AccountKeys[2]
			}
			hints := &TokenHints{
				Name:           ft.Name,
				Symbol:         ft.Symbol,
				Description:    ft.Description,
				Twitter:        ft.Twitter,
				Website:        ft.Website,
				CreatorUsername: creator,
				Launchpad:      "bags",
			}
			if err := i.pipeline.ProcessMint(ctx, ft.TokenMint, hints); err != nil {
				log.Printf("initializer: bags pipeline error %s: %v", ft.TokenMint, err)
				continue
			}
			total++
			if (idx+1)%10 == 0 {
				log.Printf("initializer: bags %d/%d processed", idx+1, len(feed))
			}
		}
	}

	log.Printf("initializer: seed complete, %d tokens processed", total)
	return nil
}

