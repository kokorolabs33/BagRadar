package bot

import (
	"context"
	"log"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"bagradar/internal/repository"
)

type Bot struct {
	api      *tgbotapi.BotAPI
	users    repository.UserRepo
	handlers *Handlers
}

func New(token string, users repository.UserRepo) (*Bot, error) {
	api, err := tgbotapi.NewBotAPI(token)
	if err != nil {
		return nil, err
	}
	return &Bot{api: api, users: users}, nil
}

func (b *Bot) SetHandlers(h *Handlers) { b.handlers = h }

func (b *Bot) Send(chatID int64, text string) {
	msg := tgbotapi.NewMessage(chatID, text)
	msg.ParseMode = "Markdown"
	msg.DisableWebPagePreview = true
	if _, err := b.api.Send(msg); err != nil {
		log.Printf("send error to %d: %v", chatID, err)
	}
}

func (b *Bot) Run(ctx context.Context) {
	cfg := tgbotapi.NewUpdate(0)
	cfg.Timeout = 60
	updates := b.api.GetUpdatesChan(cfg)

	for {
		select {
		case <-ctx.Done():
			b.api.StopReceivingUpdates()
			return
		case update := <-updates:
			if update.Message == nil || !update.Message.IsCommand() {
				continue
			}
			go b.route(update)
		}
	}
}

func (b *Bot) route(update tgbotapi.Update) {
	msg := update.Message
	ctx := context.Background()
	_ = b.users.Upsert(ctx, &repository.User{TelegramID: msg.Chat.ID})
	switch msg.Command() {
	case "start":
		b.handlers.HandleStart(ctx, msg)
	case "info":
		b.handlers.HandleInfo(ctx, msg)
	case "scan":
		b.handlers.HandleScan(ctx, msg)
	case "top":
		b.handlers.HandleTop(ctx, msg)
	case "subscribe":
		b.handlers.HandleSubscribe(ctx, msg)
	case "unsubscribe":
		b.handlers.HandleUnsubscribe(ctx, msg)
	case "premium":
		b.handlers.HandlePremium(ctx, msg)
	}
}
