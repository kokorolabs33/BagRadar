package bot

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/binary"
	"fmt"
	"log"
	"math"
	"math/big"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"bagradar/internal/api/dexscreener"
	"bagradar/internal/api/helius"
	"bagradar/internal/repository"
)

const premiumPriceUSD = 15.0
const b58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

type PaymentHandler struct {
	bot        *Bot
	users      repository.UserRepo
	payments   repository.PaymentRepo
	dex        *dexscreener.Client
	helius     *helius.Client
	masterSeed []byte
}

func NewPaymentHandler(bot *Bot, users repository.UserRepo, payments repository.PaymentRepo,
	dex *dexscreener.Client, h *helius.Client, masterSeed []byte) *PaymentHandler {
	return &PaymentHandler{bot: bot, users: users, payments: payments,
		dex: dex, helius: h, masterSeed: masterSeed}
}

func (p *PaymentHandler) Handle(ctx context.Context, msg *tgbotapi.Message) {
	paid, _ := p.users.IsPaid(ctx, msg.Chat.ID)
	if paid {
		u, _ := p.users.GetByTelegramID(ctx, msg.Chat.ID)
		if u != nil && u.PaidUntil != nil {
			p.bot.Send(msg.Chat.ID, fmt.Sprintf("✅ Already a Premium user, expires: %s", u.PaidUntil.Format("2006-01-02")))
		} else {
			p.bot.Send(msg.Chat.ID, "✅ Already a Premium user.")
		}
		return
	}
	existing, _ := p.payments.GetActiveSessionByTelegramID(ctx, msg.Chat.ID)
	if existing != nil {
		p.bot.Send(msg.Chat.ID, p.formatMsg(existing))
		return
	}

	solPrice, err := p.getSolPrice(ctx)
	if err != nil || solPrice <= 0 {
		p.bot.Send(msg.Chat.ID, "❌ Unable to fetch SOL price. Please try again later.")
		return
	}
	amountSOL := math.Round((premiumPriceUSD/solPrice)*100) / 100

	addr, err := p.deriveAddress(msg.Chat.ID)
	if err != nil {
		p.bot.Send(msg.Chat.ID, "❌ Failed to generate address. Please contact support.")
		return
	}

	session := &repository.PaymentSession{
		TelegramID: msg.Chat.ID,
		SolAddress: addr,
		AmountSOL:  amountSOL,
		ExpiresAt:  time.Now().Add(time.Hour),
	}
	if err := p.payments.CreateSession(ctx, session); err != nil {
		p.bot.Send(msg.Chat.ID, "❌ Failed to create session. Please try again later.")
		return
	}

	p.bot.Send(msg.Chat.ID, p.formatMsg(session))
	go p.poll(session)
}

func (p *PaymentHandler) formatMsg(s *repository.PaymentSession) string {
	url := fmt.Sprintf("solana:%s?amount=%.2f&label=BagRadar+Premium", s.SolAddress, s.AmountSOL)
	return fmt.Sprintf("*BagRadar Premium* — $%.0f/mo\n\nSend: *%.2f SOL*\nAddress: `%s`\n\n[👉 Solana Pay](%s)\n\n_Auto-upgrade on receipt, valid for 30 days_",
		premiumPriceUSD, s.AmountSOL, s.SolAddress, url)
}

func (p *PaymentHandler) poll(session *repository.PaymentSession) {
	ctx, cancel := context.WithDeadline(context.Background(), session.ExpiresAt)
	defer cancel()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			paid, amount, err := p.checkOnChain(ctx, session.SolAddress)
			if err != nil {
				log.Printf("payment poll error %s: %v", session.SolAddress, err)
				continue
			}
			if paid && amount >= session.AmountSOL {
				_ = p.payments.MarkPaid(ctx, session.ID)
				until := time.Now().Add(30 * 24 * time.Hour)
				_ = p.users.SetPaid(ctx, session.TelegramID, until)
				p.bot.Send(session.TelegramID,
					fmt.Sprintf("✅ Payment received! Upgraded to Premium until %s", until.Format("2006-01-02")))
				return
			}
		}
	}
}

func (p *PaymentHandler) checkOnChain(ctx context.Context, addr string) (bool, float64, error) {
	sigs, err := p.helius.GetSignaturesForAddress(ctx, addr, 1)
	if err != nil || len(sigs) == 0 {
		return false, 0, err
	}
	amount, err := p.helius.GetSOLReceivedByAddress(ctx, sigs[0], addr)
	return true, amount, err
}

func (p *PaymentHandler) deriveAddress(telegramID int64) (string, error) {
	mac := hmac.New(sha512.New, p.masterSeed)
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(telegramID))
	mac.Write(buf)
	derived := mac.Sum(nil)
	privKey := ed25519.NewKeyFromSeed(derived[:32])
	pubKey := privKey.Public().(ed25519.PublicKey)
	return base58Encode(pubKey), nil
}

// getSolPrice fetches current SOL/USD price from DexScreener
func (p *PaymentHandler) getSolPrice(ctx context.Context) (float64, error) {
	// SOL/USDC pair on Raydium: use a well-known SOL mint
	pair, err := p.dex.GetBestPair(ctx, "So11111111111111111111111111111111111111112")
	if err != nil || pair == nil {
		return 0, err
	}
	return pair.PriceUSD, nil
}

func base58Encode(b []byte) string {
	var leadingZeros int
	for _, v := range b {
		if v != 0 {
			break
		}
		leadingZeros++
	}
	num := new(big.Int).SetBytes(b)
	base := big.NewInt(58)
	mod := new(big.Int)
	var result []byte
	for num.Sign() > 0 {
		num.DivMod(num, base, mod)
		result = append(result, b58Alphabet[mod.Int64()])
	}
	for i := 0; i < leadingZeros; i++ {
		result = append(result, b58Alphabet[0])
	}
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return string(result)
}
