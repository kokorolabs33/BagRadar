package helius

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const (
	// BagsProgramID is the Bags.fm on-chain program address.
	BagsProgramID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
	// NewTokenInstruction is the log instruction name emitted when a new Bags token is created.
	NewTokenInstruction = "InitializeVirtualPoolWithSplToken"

	// PumpFunProgramID is the PumpFun bonding curve program address.
	PumpFunProgramID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
	// PumpFunNewTokenInstruction is emitted on the first buy (token creation) on PumpFun.
	PumpFunNewTokenInstruction = "Instruction: PfBuy"
)

// NewTokenEvent is emitted when the WebSocket detects a new token creation.
type NewTokenEvent struct {
	Signature string
	TokenMint string
	Platform  string // "bags" or "pumpfun"
}

// WSClient connects to the Helius WebSocket and streams new Bags token events.
type WSClient struct {
	apiKey string
	rpc    *Client
}

// NewWSClient creates a new WebSocket client. rpc is used for getTransaction lookups.
func NewWSClient(apiKey string, rpc *Client) *WSClient {
	return &WSClient{apiKey: apiKey, rpc: rpc}
}

// StreamNewTokens connects to Helius WebSocket and calls onNew for each new token created.
// Reconnects automatically on disconnect. Blocks until ctx is cancelled.
func (c *WSClient) StreamNewTokens(ctx context.Context, onNew func(NewTokenEvent)) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			if err := c.connect(ctx, onNew); err != nil {
				slog.Warn("websocket disconnected, reconnecting in 5s", "err", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
	}
}

func (c *WSClient) connect(ctx context.Context, onNew func(NewTokenEvent)) error {
	url := "wss://mainnet.helius-rpc.com/?api-key=" + c.apiKey
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return err
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	conn.SetReadLimit(1 << 20) // 1 MB — log messages can be large

	// Subscribe to both Bags DBC and PumpFun program logs
	sub := map[string]any{
		"jsonrpc": "2.0", "id": 1,
		"method": "logsSubscribe",
		"params": []any{
			map[string]any{"mentions": []string{BagsProgramID, PumpFunProgramID}},
			map[string]any{"commitment": "confirmed"},
		},
	}
	if err := wsjson.Write(ctx, conn, sub); err != nil {
		return err
	}
	slog.Info("helius websocket: subscribed to Bags + PumpFun programs")

	for {
		var msg map[string]any
		if err := wsjson.Read(ctx, conn, &msg); err != nil {
			return err
		}

		params, ok := msg["params"].(map[string]any)
		if !ok {
			continue
		}
		result, ok := params["result"].(map[string]any)
		if !ok {
			continue
		}
		value, ok := result["value"].(map[string]any)
		if !ok {
			continue
		}

		sig, _ := value["signature"].(string)
		logsRaw, _ := value["logs"].([]any)

		// Determine platform and whether this is a new token creation
		platform := ""
		for _, l := range logsRaw {
			logStr, ok := l.(string)
			if !ok {
				continue
			}
			if strings.Contains(logStr, NewTokenInstruction) {
				platform = "bags"
				break
			}
			if strings.Contains(logStr, PumpFunNewTokenInstruction) {
				platform = "pumpfun"
				break
			}
		}
		if platform == "" {
			continue
		}

		// Fetch the transaction to extract the token mint address.
		mint, err := c.rpc.GetMintFromSignature(sig)
		if err != nil {
			slog.Warn("websocket: failed to get mint from tx", "sig", sig[:min(20, len(sig))], "err", err)
			continue
		}
		slog.Info("new token detected", "platform", platform, "sig", sig[:min(20, len(sig))], "mint", mint)

		onNew(NewTokenEvent{Signature: sig, TokenMint: mint, Platform: platform})
	}
}
