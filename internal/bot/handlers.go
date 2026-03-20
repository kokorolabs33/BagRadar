package bot

import (
	"context"
	"fmt"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"bagradar/internal/repository"
	"bagradar/internal/service"
)

type pipelineRunner interface {
	ProcessMint(ctx context.Context, mint string, hints any) error
}

type Handlers struct {
	bot       *Bot
	tokens    repository.TokenRepo
	users     repository.UserRepo
	pipeline  pipelineRunner
	ai        *service.AIService
	payment   *PaymentHandler
	whitelist map[int64]bool
}

func NewHandlers(bot *Bot, tokens repository.TokenRepo, users repository.UserRepo,
	pipeline pipelineRunner, ai *service.AIService, whitelist []int64) *Handlers {
	wl := make(map[int64]bool, len(whitelist))
	for _, id := range whitelist {
		wl[id] = true
	}
	return &Handlers{bot: bot, tokens: tokens, users: users, pipeline: pipeline, ai: ai, whitelist: wl}
}

func (h *Handlers) isPaidOrWhitelisted(ctx context.Context, id int64) bool {
	if h.whitelist[id] {
		return true
	}
	paid, _ := h.users.IsPaid(ctx, id)
	return paid
}

func (h *Handlers) SetPaymentHandler(p *PaymentHandler) { h.payment = p }

func (h *Handlers) HandleStart(_ context.Context, msg *tgbotapi.Message) {
	h.bot.Send(msg.Chat.ID, `*BagRadar* 🎯

/info <mint> — Basic info (free)
/scan <mint> — Full analysis + AI verdict (paid)
/top — Top tokens in 24h (paid)
/subscribe — Enable auto alerts (paid)
/premium — Upgrade to premium`)
}

func (h *Handlers) HandleInfo(ctx context.Context, msg *tgbotapi.Message) {
	mint := msg.CommandArguments()
	if mint == "" {
		h.bot.Send(msg.Chat.ID, "Usage: /info <mint>")
		return
	}
	token, _ := h.tokens.GetByMint(ctx, mint)
	if token == nil {
		h.bot.Send(msg.Chat.ID, "Token not found.")
		return
	}
	dynamic, _ := h.tokens.GetDynamicScores(ctx, mint)
	h.bot.Send(msg.Chat.ID, FormatInfoReport(token, dynamic))
}

func (h *Handlers) HandleScan(ctx context.Context, msg *tgbotapi.Message) {
	if !h.isPaidOrWhitelisted(ctx, msg.Chat.ID) {
		h.bot.Send(msg.Chat.ID, "❌ /scan is a paid feature. Use /premium to upgrade.")
		return
	}
	mint := msg.CommandArguments()
	if mint == "" {
		h.bot.Send(msg.Chat.ID, "Usage: /scan <mint>")
		return
	}
	h.bot.Send(msg.Chat.ID, "🔍 Analyzing...")

	token, _ := h.tokens.GetByMint(ctx, mint)
	if token == nil {
		_ = h.pipeline.ProcessMint(ctx, mint, nil)
		token, _ = h.tokens.GetByMint(ctx, mint)
	}
	if token == nil {
		h.bot.Send(msg.Chat.ID, "Unable to fetch token data.")
		return
	}

	static, _ := h.tokens.GetStaticScores(ctx, mint)
	dynamic, _ := h.tokens.GetDynamicScores(ctx, mint)
	var ai *repository.AIAnalysis
	if static != nil && dynamic != nil && h.ai != nil {
		ai, _ = h.ai.Analyze(ctx, mint, service.AIInput{Token: *token, Static: *static, Dynamic: *dynamic})
	}
	h.bot.Send(msg.Chat.ID, FormatScanReport(token, static, dynamic, ai))
}

func (h *Handlers) HandleTop(ctx context.Context, msg *tgbotapi.Message) {
	if !h.isPaidOrWhitelisted(ctx, msg.Chat.ID) {
		h.bot.Send(msg.Chat.ID, "❌ /top is a paid feature. Use /premium to upgrade.")
		return
	}
	tokens, err := h.tokens.TopByComposite(ctx, 5, time.Now().Add(-24*time.Hour))
	if err != nil || len(tokens) == 0 {
		h.bot.Send(msg.Chat.ID, "No data available.")
		return
	}
	text := "*Top Tokens (24h)*\n\n"
	for i, t := range tokens {
		d, _ := h.tokens.GetDynamicScores(ctx, t.Mint)
		score := 0.0
		if d != nil {
			score = d.CompositeScore
		}
		text += fmt.Sprintf("%d. *%s* — %.1f/10\n/scan %s\n\n", i+1, esc(t.Name), score, t.Mint)
	}
	h.bot.Send(msg.Chat.ID, text)
}

func (h *Handlers) HandleSubscribe(ctx context.Context, msg *tgbotapi.Message) {
	if !h.isPaidOrWhitelisted(ctx, msg.Chat.ID) {
		h.bot.Send(msg.Chat.ID, "❌ Auto alerts is a paid feature. Use /premium to upgrade.")
		return
	}
	_ = h.users.SetSubscribed(ctx, msg.Chat.ID, true)
	h.bot.Send(msg.Chat.ID, "✅ Auto alerts enabled. You'll be notified when a token scores ≥ 7.0.")
}

func (h *Handlers) HandleUnsubscribe(ctx context.Context, msg *tgbotapi.Message) {
	_ = h.users.SetSubscribed(ctx, msg.Chat.ID, false)
	h.bot.Send(msg.Chat.ID, "✅ Auto alerts disabled.")
}

func (h *Handlers) HandlePremium(ctx context.Context, msg *tgbotapi.Message) {
	if h.payment == nil {
		h.bot.Send(msg.Chat.ID, "Payments not available yet.")
		return
	}
	h.payment.Handle(ctx, msg)
}
