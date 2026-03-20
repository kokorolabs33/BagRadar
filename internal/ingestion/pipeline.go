package ingestion

import (
	"context"
	"log"
	"strings"
	"time"

	"bagradar/internal/api/dexscreener"
	"bagradar/internal/api/helius"
	"bagradar/internal/api/twitter"
	"bagradar/internal/repository"
	"bagradar/internal/service"
)

// Pipeline is the unified data processing layer.
// It accepts a mint address and handles ALL data enrichment:
//   - On-chain metadata (Helius)
//   - Market data (DexScreener)
//   - Social data (Twitter)
//   - Creator analysis (GitHub)
//   - Scoring (5-dimension)
//   - Alerting
//
// Discovery layers (Bags.fm, Pump.fun, Webhook, /scan) only feed mint addresses in.
type Pipeline struct {
	tokens  repository.TokenRepo
	scorer  *service.Scorer
	alerter *service.Alerter
	ai      *service.AIService
	helius  *helius.Client
	dex     *dexscreener.Client
	twitter *twitter.Client
}

// NewPipeline creates a Pipeline. Any client may be nil (calls are skipped gracefully).
func NewPipeline(
	tokens repository.TokenRepo,
	scorer *service.Scorer,
	alerter *service.Alerter,
	ai *service.AIService,
	h *helius.Client,
	dex *dexscreener.Client,
	tw *twitter.Client,
) *Pipeline {
	return &Pipeline{
		tokens:  tokens,
		scorer:  scorer,
		alerter: alerter,
		ai:      ai,
		helius:  h,
		dex:     dex,
		twitter: tw,
	}
}

// ProcessMint is the single entry point. Accepts a mint address and optional hints.
// hints can be *TokenHints or nil.
func (p *Pipeline) ProcessMint(ctx context.Context, mint string, hints any) error {
	// 1. Build token from chain metadata + hints
	var th *TokenHints
	if h, ok := hints.(*TokenHints); ok {
		th = h
	}
	token := p.buildToken(mint, th)
	log.Printf("pipeline: processing %s (%s)", token.Mint, token.Name)

	if err := p.tokens.Upsert(ctx, token); err != nil {
		return err
	}

	// 2. Static scores (safety, creator, quality)
	static, err := p.fetchStatic(ctx, token)
	if err != nil {
		log.Printf("pipeline: fetchStatic %s: %v", mint, err)
	}
	if static != nil {
		_ = p.tokens.SaveStaticScores(ctx, mint, static)
	}

	// 3. Dynamic scores (market, social)
	dynamic, err := p.fetchDynamic(ctx, token)
	if err != nil {
		log.Printf("pipeline: fetchDynamic %s: %v", mint, err)
	}
	if dynamic != nil {
		if static != nil {
			dynamic.CompositeScore = p.scorer.Composite(*static, *dynamic)
		}
		_ = p.tokens.SaveDynamicScores(ctx, mint, dynamic)

		// 4. Alert subscribers if score is high enough
		if p.alerter != nil && static != nil && p.alerter.ClaimAlert(ctx, mint, dynamic.CompositeScore, token.Status) {
			msg := p.buildAlertMessage(ctx, token, static, dynamic)
			p.alerter.SendAlert(ctx, msg)
		}
	}

	return nil
}

// TokenHints carries optional metadata from the discovery layer.
// All fields are optional — pipeline fills anything missing from chain.
type TokenHints struct {
	Name            string
	Symbol          string
	Description     string
	Twitter         string
	Website         string
	CreatorUsername  string
	Provider        string // "github", "twitter", ""
	Launchpad       string // "bags", "pumpfun", ""
}

// buildToken constructs a Token by merging hints with on-chain metadata.
// Chain data fills any gaps the discovery layer didn't provide.
func (p *Pipeline) buildToken(mint string, hints *TokenHints) *repository.Token {
	token := &repository.Token{
		Mint:   mint,
		Status: "active",
	}

	// Apply hints if provided
	if hints != nil {
		token.Name = hints.Name
		token.Symbol = hints.Symbol
		token.Description = hints.Description
		token.Twitter = hints.Twitter
		token.Website = hints.Website
		token.CreatorUsername = hints.CreatorUsername
		token.Provider = hints.Provider
		token.Launchpad = hints.Launchpad
	}

	// Fill gaps from metadata:
	// - Bags tokens: already handled via hints from ws_monitor (Bags feed)
	// - Non-Bags tokens (PumpFun etc.): use Helius DAS which covers all platforms
	isBagsToken := strings.HasSuffix(mint, "BAGS")
	if (token.Name == "" || token.Symbol == "") && !isBagsToken && p.helius != nil {
		if meta, err := p.helius.GetTokenMetadata(mint); err == nil && meta != nil {
			if token.Name == "" {
				token.Name = meta.Name
			}
			if token.Symbol == "" {
				token.Symbol = meta.Symbol
			}
			if token.Description == "" && meta.Description != "" {
				token.Description = meta.Description
			}
			if token.CreatorUsername == "" {
				token.CreatorUsername = meta.UpdateAuthority
			}
		}
	}

	now := time.Now()
	token.FirstSeenAt = now
	token.LastActiveAt = &now
	return token
}

// RefreshDynamic re-fetches market and social data without touching static scores.
func (p *Pipeline) RefreshDynamic(ctx context.Context, token *repository.Token) error {
	dynamic, err := p.fetchDynamic(ctx, token)
	if err != nil {
		return err
	}
	if dynamic == nil {
		return nil
	}

	static, _ := p.tokens.GetStaticScores(ctx, token.Mint)
	if static != nil {
		dynamic.CompositeScore = p.scorer.Composite(*static, *dynamic)
	}

	if err := p.tokens.SaveDynamicScores(ctx, token.Mint, dynamic); err != nil {
		return err
	}
	if dynamic.Volume24h > 0 {
		if err := p.tokens.SetLastActive(ctx, token.Mint, *dynamic.LastRefreshed); err != nil {
			log.Printf("pipeline: SetLastActive %s: %v", token.Mint, err)
		}
	}
	if p.alerter != nil && p.alerter.ClaimAlert(ctx, token.Mint, dynamic.CompositeScore, token.Status) {
		msg := p.buildAlertMessage(ctx, token, static, dynamic)
		p.alerter.SendAlert(ctx, msg)
	}
	return nil
}

// RefreshStatic re-fetches on-chain safety/creator/quality scores.
func (p *Pipeline) RefreshStatic(ctx context.Context, token *repository.Token) error {
	static, err := p.fetchStatic(ctx, token)
	if err != nil {
		return err
	}
	if static == nil {
		return nil
	}

	now := time.Now()
	static.LastRefreshed = &now

	if err := p.tokens.SaveStaticScores(ctx, token.Mint, static); err != nil {
		return err
	}

	// Update composite with existing dynamic data.
	dynamic, _ := p.tokens.GetDynamicScores(ctx, token.Mint)
	if dynamic != nil {
		dynamic.CompositeScore = p.scorer.Composite(*static, *dynamic)
		_ = p.tokens.SaveDynamicScores(ctx, token.Mint, dynamic)
	}
	return nil
}

// fetchStatic calls helius + github and computes safety/creator/quality scores.
func (p *Pipeline) fetchStatic(ctx context.Context, token *repository.Token) (*repository.StaticScores, error) {
	scores := &repository.StaticScores{
		SafetyDetail:  map[string]any{},
		CreatorDetail: map[string]any{},
		QualityDetail: map[string]any{},
	}

	safetyIn := service.SafetyInput{}
	creatorIn := service.CreatorInput{}
	qualityIn := service.QualityInput{
		DescriptionLen: len(token.Description),
		HasWebsite:     token.Website != "",
		HasTwitter:     token.Twitter != "",
	}

	if p.helius != nil {
		if holders, err := p.helius.GetTokenHolders(token.Mint); err == nil && holders != nil {
			safetyIn.Top10HolderPct = holders.Top10Pct
			scores.SafetyDetail["top10_pct"] = holders.Top10Pct
		}

		if lpResult, err := p.helius.CheckLPLocked(token.Mint); err == nil && lpResult != nil {
			safetyIn.LPLocked = lpResult.IsLocked
			scores.SafetyDetail["lp_locked"] = lpResult.IsLocked
			scores.SafetyDetail["lp_locked_by"] = lpResult.LockedBy
		}

		if token.CreatorUsername != "" {
			if devPct, err := p.helius.GetDevWalletBalance(token.CreatorUsername, token.Mint); err == nil {
				safetyIn.DevWalletPct = devPct
				scores.SafetyDetail["dev_wallet_pct"] = devPct
			}

			if pastTokens, err := p.helius.GetDevTokenHistory(token.CreatorUsername); err == nil && len(pastTokens) > 0 {
				abandoned := p.checkAbandoned(ctx, pastTokens, token.Mint)
				qualityIn.AbandonedTokens = abandoned
				qualityIn.CleanHistory = abandoned == 0
				scores.QualityDetail["past_tokens"] = len(pastTokens)
				scores.QualityDetail["abandoned_tokens"] = abandoned
			}
		}
	}

	// Twitter profile enrichment
	if p.twitter != nil && token.Twitter != "" {
		username := twitter.UsernameFromURL(token.Twitter)
		if username != "" {
			if profile, err := p.twitter.GetProfile(username); err == nil {
				creatorIn.TwitterFollowers = profile.FollowersCount
				creatorIn.TwitterAccountAgeDays = profile.AccountAgeDays
				creatorIn.TwitterVerified = profile.IsVerified
				creatorIn.HasWebsite = profile.WebsiteURL != ""
				scores.CreatorDetail["twitter_followers"] = profile.FollowersCount
				scores.CreatorDetail["twitter_account_age_days"] = profile.AccountAgeDays
				scores.CreatorDetail["twitter_verified"] = profile.IsVerified
				scores.CreatorDetail["twitter_website"] = profile.WebsiteURL
			} else {
				log.Printf("pipeline: twitter %s: %v", username, err)
			}
		}
	}

	scores.SafetyScore = p.scorer.ScoreSafety(safetyIn)
	scores.CreatorScore = p.scorer.ScoreCreator(creatorIn)
	scores.QualityScore = p.scorer.ScoreQuality(qualityIn)

	return scores, nil
}

// fetchDynamic calls dexscreener + twitter and computes momentum/buzz scores.
func (p *Pipeline) fetchDynamic(ctx context.Context, token *repository.Token) (*repository.DynamicScores, error) {
	scores := &repository.DynamicScores{}

	momentumIn := service.MomentumInput{}

	if p.dex != nil {
		if pair, err := p.dex.GetBestPair(ctx, token.Mint); err == nil && pair != nil {
			scores.Volume24h = pair.Volume24h
			scores.MarketCap = pair.MarketCap
			scores.PriceUSD = pair.PriceUSD
			scores.PriceChange24h = pair.Change24h
			scores.BuySellRatio = pair.BuySellRatio()
			scores.UniqueBuyers = pair.Makers24h

			momentumIn.Volume24h = pair.Volume24h
			momentumIn.BuySellRatio = pair.BuySellRatio()
			momentumIn.UniqueBuyers = pair.Makers24h
			momentumIn.PriceChange24h = pair.Change24h
			momentumIn.MarketCap = pair.MarketCap

			if pair.PairAddress != "" && token.PairAddress == "" {
				token.PairAddress = pair.PairAddress
				_ = p.tokens.Upsert(ctx, token)
			}
		}
	}

	scores.MomentumScore = p.scorer.ScoreMomentum(momentumIn)
	scores.BuzzScore = 0 // disabled: no Twitter data source

	now := time.Now()
	scores.LastRefreshed = &now

	return scores, nil
}

// buildAlertMessage generates a full scan report (with AI analysis) for alerting.
func (p *Pipeline) buildAlertMessage(ctx context.Context, token *repository.Token, static *repository.StaticScores, dynamic *repository.DynamicScores) string {
	var ai *repository.AIAnalysis
	if p.ai != nil && static != nil && dynamic != nil {
		var err error
		ai, err = p.ai.Analyze(ctx, token.Mint, service.AIInput{Token: *token, Static: *static, Dynamic: *dynamic})
		if err != nil {
			log.Printf("pipeline: AI analysis for %s failed: %v", token.Mint, err)
		}
	}
	return "🚨 *New Alert*\n\n" + service.FormatScanReport(token, static, dynamic, ai)
}

// checkAbandoned uses DexScreener to count how many past tokens have 24h volume < $100.
// Excludes the current token (currentMint) from the check.
func (p *Pipeline) checkAbandoned(ctx context.Context, pastTokens []helius.PastToken, currentMint string) int {
	if p.dex == nil {
		return 0
	}

	// Collect mints, exclude current token
	var mints []string
	for _, pt := range pastTokens {
		if pt.Mint != currentMint {
			mints = append(mints, pt.Mint)
		}
	}
	if len(mints) == 0 {
		return 0
	}

	abandoned := 0
	// Batch query DexScreener (max 30 per call)
	for i := 0; i < len(mints); i += 30 {
		end := i + 30
		if end > len(mints) {
			end = len(mints)
		}
		pairs, err := p.dex.GetBestPairs(ctx, mints[i:end])
		if err != nil {
			log.Printf("pipeline: checkAbandoned dex error: %v", err)
			continue
		}
		for _, mint := range mints[i:end] {
			pair := pairs[mint]
			if pair == nil || pair.Volume24h < 100 {
				abandoned++
			}
		}
	}
	return abandoned
}
