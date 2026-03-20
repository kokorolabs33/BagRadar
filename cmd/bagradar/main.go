package main

import (
	"context"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/joho/godotenv"

	"bagradar/internal/api/bags"
	"bagradar/internal/api/dexscreener"
	// "bagradar/internal/api/github" // disabled
	"bagradar/internal/api/helius"
	"bagradar/internal/api/twitter"
	"bagradar/internal/bot"
	"bagradar/internal/ingestion"
	"bagradar/internal/repository"
	"bagradar/internal/service"
)

func main() {
	_ = godotenv.Load() // .env is optional; env vars take precedence

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	db, err := repository.NewPostgres(ctx, mustEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	if err := db.RunMigrations(ctx, "migrations"); err != nil {
		log.Fatalf("migrations: %v", err)
	}

	tokenRepo   := repository.NewPgTokenRepo(db.Pool)
	userRepo    := repository.NewPgUserRepo(db.Pool)
	alertRepo   := repository.NewPgAlertRepo(db.Pool)
	paymentRepo := repository.NewPgPaymentRepo(db.Pool)

	heliusClient := helius.New(mustEnv("HELIUS_API_KEY"))
	dexClient    := dexscreener.New()
	// ghClient := github.New(os.Getenv("GITHUB_TOKEN")) // disabled: no creator GitHub data available

	bagsClient   := bags.New(mustEnv("BAGS_API_KEY"))

	var twitterClient *twitter.Client
	if authToken, ct0 := os.Getenv("TWITTER_AUTH_TOKEN"), os.Getenv("TWITTER_CT0"); authToken != "" && ct0 != "" {
		twitterClient = twitter.New(authToken, ct0)
		log.Println("twitter: enrichment enabled")
	} else {
		log.Println("twitter: TWITTER_AUTH_TOKEN or TWITTER_CT0 not set, skipping enrichment")
	}

	scorer  := service.NewScorer()
	aiSvc   := service.NewAIService(tokenRepo)

	tgBot, err := bot.New(mustEnv("TELEGRAM_BOT_TOKEN"), userRepo)
	if err != nil {
		log.Fatalf("telegram: %v", err)
	}
	alerter := service.NewAlerter(alertRepo, userRepo, tgBot.Send)

	pipeline     := ingestion.NewPipeline(tokenRepo, scorer, alerter, aiSvc,
		heliusClient, dexClient, twitterClient)
	refresher    := ingestion.NewRefresher(tokenRepo, pipeline)
	initializer  := ingestion.NewInitializer(tokenRepo, bagsClient, pipeline)

	wsClient     := helius.NewWSClient(mustEnv("HELIUS_API_KEY"), heliusClient)
	wsMonitor    := ingestion.NewWSMonitor(wsClient, bagsClient, tokenRepo, pipeline)

	webhookListener := ingestion.NewWebhookListener(pipeline, os.Getenv("WEBHOOK_SECRET"))

	// Parse whitelist
	whitelist := parseAllowedUsers(os.Getenv("ALLOWED_USERS"))

	handlers := bot.NewHandlers(tgBot, tokenRepo, userRepo, pipeline, aiSvc, whitelist)

	// Solana Pay (optional)
	if seedHex := os.Getenv("MASTER_WALLET_SEED"); seedHex != "" {
		seed, err := hex.DecodeString(seedHex)
		if err != nil || len(seed) != 32 {
			log.Fatalf("MASTER_WALLET_SEED must be 64 hex chars")
		}
		paymentHandler := bot.NewPaymentHandler(tgBot, userRepo, paymentRepo, dexClient, heliusClient, seed)
		handlers.SetPaymentHandler(paymentHandler)
	}

	tgBot.SetHandlers(handlers)

	if err := initializer.Run(ctx); err != nil {
		log.Printf("initializer: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/webhook/tokens", webhookListener.Handler())
	server := &http.Server{Addr: ":" + envOr("WEBHOOK_PORT", "8080"), Handler: mux}
	go func() {
		log.Printf("webhook on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("server error: %v", err)
		}
	}()

	go refresher.Run(ctx)
	go wsMonitor.Run(ctx)
	go tgBot.Run(ctx)

	<-ctx.Done()
	log.Println("shutting down...")
	_ = server.Shutdown(context.Background())
}

func mustEnv(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	log.Fatalf("required env %s not set", key)
	return ""
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseAllowedUsers(s string) []int64 {
	if s == "" {
		return nil
	}
	var ids []int64
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if id, err := strconv.ParseInt(part, 10, 64); err == nil {
			ids = append(ids, id)
		}
	}
	return ids
}
