// Package helius provides a client for the Helius Solana API.
package helius

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

const (
	rpcURL  = "https://mainnet.helius-rpc.com/?api-key=%s"
	restURL = "https://api.helius.xyz/v0"
)


// Client is a Helius API client.
type Client struct {
	apiKey string
	http   *http.Client
}

// New creates a new Helius client.
func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

// TokenHolder represents a single token account and its share of supply.
type TokenHolder struct {
	Address    string
	UIAmount   float64
	Percentage float64 // percentage of total supply
}

// HoldersResult contains token holder distribution data.
type HoldersResult struct {
	Holders     []TokenHolder
	TotalSupply float64
	Top10Pct    float64 // combined percentage of top 10 holders
}

// TokenMetadata contains on-chain and off-chain metadata for a token.
type TokenMetadata struct {
	Name            string
	Symbol          string
	Description     string
	Image           string
	UpdateAuthority string // usually the token creator's wallet
}

// LPLockResult indicates whether LP tokens appear locked.
type LPLockResult struct {
	IsLocked bool
	LockedBy string // name of the lock program, if identified
}

// PastToken represents a token previously launched by the same dev wallet via Bags.fm.
type PastToken struct {
	Mint         string
	WasAbandoned bool   // true if DexScreener signals suggest the token was abandoned
	StatusNote   string // e.g. "⚠️ Likely abandoned/rugged"
}

var (
	devHistoryCache   = map[string][]string{} // walletAddress → token mints
	devHistoryCacheMu sync.RWMutex
)

// DevWalletHistory contains sell activity data for a creator wallet and specific token.
type DevWalletHistory struct {
	InitialBalance float64    // estimated from first observed tx (0 if unavailable)
	CurrentBalance float64    // current token balance (0 if unavailable)
	SoldPct        float64    // percentage of initial balance sold (0 if unavailable)
	LastSellTime   *time.Time // time of most recent sell tx (nil if none found)
	SellCount      int        // number of outbound token transfers observed
}

// rpcCall is the JSON-RPC 2.0 request envelope.
type rpcCall struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}

// rpcEnvelope wraps the JSON-RPC response.
type rpcEnvelope struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// doRPC sends a JSON-RPC POST to the Helius RPC endpoint and decodes result into target.
func (c *Client) doRPC(method string, params []any, target any) error {
	body, err := json.Marshal(rpcCall{
		JSONRPC: "2.0",
		ID:      1,
		Method:  method,
		Params:  params,
	})
	if err != nil {
		return err
	}

	url := fmt.Sprintf(rpcURL, c.apiKey)
	resp, err := c.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("helius RPC %s: %s", method, resp.Status)
	}

	var envelope rpcEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return err
	}
	if envelope.Error != nil {
		return fmt.Errorf("helius RPC %s: %s", method, envelope.Error.Message)
	}
	return json.Unmarshal(envelope.Result, target)
}

// doREST sends a POST request to the Helius REST API and decodes the response into target.
func (c *Client) doREST(path string, reqBody any, target any) error {
	body, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s%s?api-key=%s", restURL, path, c.apiKey)
	resp, err := c.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("helius REST %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

// GetTokenHolders returns the top token holders with percentage of total supply.
func (c *Client) GetTokenHolders(tokenMint string) (*HoldersResult, error) {
	// Fetch total supply
	var supplyResp struct {
		Value struct {
			UIAmount float64 `json:"uiAmount"`
		} `json:"value"`
	}
	if err := c.doRPC("getTokenSupply", []any{tokenMint}, &supplyResp); err != nil {
		return nil, fmt.Errorf("getTokenSupply: %w", err)
	}
	totalSupply := supplyResp.Value.UIAmount
	if totalSupply == 0 {
		return nil, fmt.Errorf("token supply is zero")
	}

	// Fetch up to 20 largest token accounts
	var holdersResp struct {
		Value []struct {
			Address  string  `json:"address"`
			UIAmount float64 `json:"uiAmount"`
		} `json:"value"`
	}
	if err := c.doRPC("getTokenLargestAccounts", []any{tokenMint}, &holdersResp); err != nil {
		return nil, fmt.Errorf("getTokenLargestAccounts: %w", err)
	}

	holders := make([]TokenHolder, 0, len(holdersResp.Value))
	var top10Pct float64
	for i, v := range holdersResp.Value {
		pct := (v.UIAmount / totalSupply) * 100
		holders = append(holders, TokenHolder{
			Address:    v.Address,
			UIAmount:   v.UIAmount,
			Percentage: pct,
		})
		if i < 10 {
			top10Pct += pct
		}
	}

	return &HoldersResult{
		Holders:     holders,
		TotalSupply: totalSupply,
		Top10Pct:    top10Pct,
	}, nil
}

// GetTokenMetadata returns on-chain and off-chain metadata for a token mint.
func (c *Client) GetTokenMetadata(tokenMint string) (*TokenMetadata, error) {
	reqBody := map[string]any{
		"mintAccounts":    []string{tokenMint},
		"includeOffChain": true,
		"disableCache":    false,
	}

	var results []struct {
		OnChainData *struct {
			UpdateAuthority string `json:"updateAuthority"`
			Data            struct {
				Name   string `json:"name"`
				Symbol string `json:"symbol"`
			} `json:"data"`
		} `json:"onChainData"`
		OffChainData *struct {
			Name        string `json:"name"`
			Symbol      string `json:"symbol"`
			Image       string `json:"image"`
			Description string `json:"description"`
		} `json:"offChainData"`
	}
	if err := c.doREST("/token-metadata", reqBody, &results); err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("no metadata for %s", tokenMint)
	}

	r := results[0]
	meta := &TokenMetadata{}
	if r.OnChainData != nil {
		meta.UpdateAuthority = r.OnChainData.UpdateAuthority
		meta.Name = r.OnChainData.Data.Name
		meta.Symbol = r.OnChainData.Data.Symbol
	}
	if r.OffChainData != nil {
		meta.Image = r.OffChainData.Image
		if meta.Name == "" {
			meta.Name = r.OffChainData.Name
		}
		if meta.Symbol == "" {
			meta.Symbol = r.OffChainData.Symbol
		}
		if r.OffChainData.Description != "" {
			meta.Description = r.OffChainData.Description
		}
	}
	return meta, nil
}

// CheckLPLocked checks whether any significant token holder address matches a known lock program.
// This is a heuristic: it checks the top holders returned by getTokenLargestAccounts.
// CheckLPLocked checks whether any of the top holders' token accounts are owned
// by an executable program (lock/escrow/burn), indicating LP is locked.
// Purely dynamic — no hardcoded program list.
func (c *Client) CheckLPLocked(tokenMint string) (*LPLockResult, error) {
	var holdersResp struct {
		Value []struct {
			Address string `json:"address"`
		} `json:"value"`
	}
	if err := c.doRPC("getTokenLargestAccounts", []any{tokenMint}, &holdersResp); err != nil {
		return nil, err
	}

	limit := min(3, len(holdersResp.Value))
	for _, v := range holdersResp.Value[:limit] {
		// Get token account info to find its owner
		var acctResp struct {
			Value *struct {
				Data struct {
					Parsed struct {
						Info struct {
							Owner string `json:"owner"`
						} `json:"info"`
					} `json:"parsed"`
				} `json:"data"`
			} `json:"value"`
		}
		if err := c.doRPC("getAccountInfo", []any{v.Address, map[string]any{"encoding": "jsonParsed"}}, &acctResp); err != nil || acctResp.Value == nil {
			continue
		}

		owner := acctResp.Value.Data.Parsed.Info.Owner
		if owner == "" {
			continue
		}

		// Standard token programs = normal wallet holder, skip
		if owner == "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
			owner == "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" {
			continue
		}

		// Check if the owner is an executable program
		var ownerResp struct {
			Value *struct {
				Executable bool `json:"executable"`
			} `json:"value"`
		}
		if err := c.doRPC("getAccountInfo", []any{owner, map[string]any{"encoding": "base64"}}, &ownerResp); err != nil || ownerResp.Value == nil {
			continue
		}
		if ownerResp.Value.Executable {
			label := fmt.Sprintf("%s...%s", owner[:4], owner[len(owner)-4:])
			return &LPLockResult{IsLocked: true, LockedBy: label}, nil
		}
	}
	return &LPLockResult{IsLocked: false}, nil
}

// GetDevWalletHistory fetches recent transaction history for a creator wallet and counts
// how many times they transferred out (sold) a specific token mint.
// Uses getSignaturesForAddress (RPC) + /v0/transactions (Helius enhanced REST) for batch parsing.
func (c *Client) GetDevWalletHistory(creatorWallet, tokenMint string) (*DevWalletHistory, error) {
	if creatorWallet == "" {
		return &DevWalletHistory{}, nil
	}

	// Step 1: Get last 50 transaction signatures for the creator wallet.
	var sigsResp []struct {
		Signature string `json:"signature"`
	}
	params := []any{
		creatorWallet,
		map[string]any{"limit": 50},
	}
	if err := c.doRPC("getSignaturesForAddress", params, &sigsResp); err != nil {
		return nil, fmt.Errorf("getSignaturesForAddress: %w", err)
	}
	if len(sigsResp) == 0 {
		return &DevWalletHistory{}, nil
	}

	sigs := make([]string, len(sigsResp))
	for i, s := range sigsResp {
		sigs[i] = s.Signature
	}

	// Step 2: Batch-parse transactions via Helius enhanced API to get token transfers.
	type tokenTransfer struct {
		FromUserAccount string  `json:"fromUserAccount"`
		Mint            string  `json:"mint"`
		TokenAmount     float64 `json:"tokenAmount"`
	}
	type parsedTx struct {
		Timestamp      int64           `json:"timestamp"`
		TokenTransfers []tokenTransfer `json:"tokenTransfers"`
	}

	var txs []parsedTx
	reqBody := map[string]any{"transactions": sigs}
	if err := c.doREST("/transactions", reqBody, &txs); err != nil {
		return nil, fmt.Errorf("batch transactions: %w", err)
	}

	// Step 3: Count outbound token transfers for the given mint from the creator wallet.
	hist := &DevWalletHistory{}
	var lastSellTS int64
	for _, tx := range txs {
		for _, tt := range tx.TokenTransfers {
			if tt.Mint == tokenMint && tt.FromUserAccount == creatorWallet {
				hist.SellCount++
				if tx.Timestamp > lastSellTS {
					lastSellTS = tx.Timestamp
				}
			}
		}
	}
	if lastSellTS > 0 {
		t := time.Unix(lastSellTS, 0)
		hist.LastSellTime = &t
	}
	return hist, nil
}

// GetHolderCount returns the total number of token accounts (holders) for a mint
// using the Helius DAS getTokenAccounts method.
func (c *Client) GetHolderCount(tokenMint string) (int, error) {
	type holderParams struct {
		Mint  string `json:"mint"`
		Limit int    `json:"limit"`
	}
	type holderCall struct {
		JSONRPC string       `json:"jsonrpc"`
		ID      string       `json:"id"`
		Method  string       `json:"method"`
		Params  holderParams `json:"params"`
	}

	reqBody := holderCall{
		JSONRPC: "2.0",
		ID:      "1",
		Method:  "getTokenAccounts",
		Params:  holderParams{Mint: tokenMint, Limit: 1000},
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return 0, err
	}

	url := fmt.Sprintf(rpcURL, c.apiKey)
	resp, err := c.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("helius getTokenAccounts: %s", resp.Status)
	}

	var result struct {
		Result *struct {
			Total int `json:"total"`
		} `json:"result"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, err
	}
	if result.Error != nil {
		return 0, fmt.Errorf("helius getTokenAccounts: %s", result.Error.Message)
	}
	if result.Result == nil {
		return 0, fmt.Errorf("helius getTokenAccounts: nil result")
	}
	return result.Result.Total, nil
}

// GetDevWalletBalance returns the percentage of token supply held by the creator wallet.
// Returns 0 if creatorWallet is empty or if no token accounts are found.
func (c *Client) GetDevWalletBalance(creatorWallet, tokenMint string) (float64, error) {
	if creatorWallet == "" {
		return 0, nil
	}

	// Fetch total supply
	var supplyResp struct {
		Value struct {
			UIAmount float64 `json:"uiAmount"`
		} `json:"value"`
	}
	if err := c.doRPC("getTokenSupply", []any{tokenMint}, &supplyResp); err != nil {
		return 0, fmt.Errorf("getTokenSupply: %w", err)
	}
	totalSupply := supplyResp.Value.UIAmount
	if totalSupply == 0 {
		return 0, nil
	}

	// Fetch all token accounts owned by the creator wallet for this mint
	params := []any{
		creatorWallet,
		map[string]string{"mint": tokenMint},
		map[string]string{"encoding": "jsonParsed"},
	}
	var accountsResp struct {
		Value []struct {
			Account struct {
				Data struct {
					Parsed struct {
						Info struct {
							TokenAmount struct {
								UIAmount float64 `json:"uiAmount"`
							} `json:"tokenAmount"`
						} `json:"info"`
					} `json:"parsed"`
				} `json:"data"`
			} `json:"account"`
		} `json:"value"`
	}
	if err := c.doRPC("getTokenAccountsByOwner", params, &accountsResp); err != nil {
		return 0, fmt.Errorf("getTokenAccountsByOwner: %w", err)
	}

	var totalHeld float64
	for _, v := range accountsResp.Value {
		totalHeld += v.Account.Data.Parsed.Info.TokenAmount.UIAmount
	}
	return (totalHeld / totalSupply) * 100, nil
}

// GetDevTokenHistory returns tokens launched by walletAddress via the Bags.fm program.
// Results are cached in memory. Fails gracefully on timeout or API errors.
func (c *Client) GetDevTokenHistory(walletAddress string) ([]PastToken, error) {
	if walletAddress == "" {
		return nil, nil
	}

	devHistoryCacheMu.RLock()
	if cached, ok := devHistoryCache[walletAddress]; ok {
		devHistoryCacheMu.RUnlock()
		tokens := make([]PastToken, len(cached))
		for i, m := range cached {
			tokens[i] = PastToken{Mint: m}
		}
		return tokens, nil
	}
	devHistoryCacheMu.RUnlock()

	const bagsProgram = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"

	var sigsResp []struct {
		Signature string `json:"signature"`
	}
	params := []any{
		walletAddress,
		map[string]any{"limit": 100},
	}
	if err := c.doRPC("getSignaturesForAddress", params, &sigsResp); err != nil {
		return nil, fmt.Errorf("getSignaturesForAddress: %w", err)
	}
	if len(sigsResp) == 0 {
		devHistoryCacheMu.Lock()
		devHistoryCache[walletAddress] = []string{}
		devHistoryCacheMu.Unlock()
		return nil, nil
	}

	sigs := make([]string, len(sigsResp))
	for i, s := range sigsResp {
		sigs[i] = s.Signature
	}

	type innerInstruction struct {
		ProgramId string `json:"programId"`
	}
	type instruction struct {
		ProgramId         string             `json:"programId"`
		InnerInstructions []innerInstruction `json:"innerInstructions"`
	}
	type tokenTransfer struct {
		Mint string `json:"mint"`
	}
	type historyTx struct {
		Instructions   []instruction   `json:"instructions"`
		TokenTransfers []tokenTransfer `json:"tokenTransfers"`
	}

	var txs []historyTx
	reqBody := map[string]any{"transactions": sigs}
	if err := c.doREST("/transactions", reqBody, &txs); err != nil {
		return nil, fmt.Errorf("batch transactions: %w", err)
	}

	seen := map[string]bool{}
	var mints []string
	for _, tx := range txs {
		hasBags := false
		for _, instr := range tx.Instructions {
			if instr.ProgramId == bagsProgram {
				hasBags = true
				break
			}
			for _, inner := range instr.InnerInstructions {
				if inner.ProgramId == bagsProgram {
					hasBags = true
					break
				}
			}
			if hasBags {
				break
			}
		}
		if !hasBags {
			continue
		}
		for _, tt := range tx.TokenTransfers {
			if tt.Mint != "" && !seen[tt.Mint] {
				seen[tt.Mint] = true
				mints = append(mints, tt.Mint)
			}
		}
	}

	devHistoryCacheMu.Lock()
	devHistoryCache[walletAddress] = mints
	devHistoryCacheMu.Unlock()

	tokens := make([]PastToken, len(mints))
	for i, m := range mints {
		tokens[i] = PastToken{Mint: m}
	}
	return tokens, nil
}

// GetSignaturesForAddress fetches up to limit transaction signatures for address.
func (c *Client) GetSignaturesForAddress(ctx context.Context, address string, limit int) ([]string, error) {
	var sigsResp []struct {
		Signature string `json:"signature"`
	}
	params := []any{
		address,
		map[string]any{"limit": limit},
	}
	if err := c.doRPC("getSignaturesForAddress", params, &sigsResp); err != nil {
		return nil, fmt.Errorf("getSignaturesForAddress: %w", err)
	}
	sigs := make([]string, len(sigsResp))
	for i, s := range sigsResp {
		sigs[i] = s.Signature
	}
	return sigs, nil
}

// GetMintsFromProgram paginates getSignaturesForAddress for a program address,
// then uses Helius enhanced transactions API to extract token mint addresses.
// Respects rate limits with delays between requests.
func (c *Client) GetMintsFromProgram(ctx context.Context, programID string, since time.Time) ([]string, error) {
	// Step 1: collect signatures (capped at maxSigs to avoid endless pagination)
	const maxSigs = 1000
	var allSigs []string
	var before string

	for page := 0; ; page++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		if page > 0 {
			time.Sleep(500 * time.Millisecond) // rate limit
		}

		params := map[string]any{"limit": 100} // smaller batches to avoid 429
		if before != "" {
			params["before"] = before
		}

		var sigsResp []struct {
			Signature string `json:"signature"`
			BlockTime int64  `json:"blockTime"`
		}
		if err := c.doRPC("getSignaturesForAddress", []any{programID, params}, &sigsResp); err != nil {
			if page == 0 {
				return nil, fmt.Errorf("getSignaturesForAddress: %w", err)
			}
			log.Printf("helius: page %d error (continuing with %d sigs): %v", page, len(allSigs), err)
			break
		}
		if len(sigsResp) == 0 {
			break
		}

		reachedEnd := false
		for _, s := range sigsResp {
			if s.BlockTime > 0 && s.BlockTime < since.Unix() {
				reachedEnd = true
				break
			}
			allSigs = append(allSigs, s.Signature)
		}

		log.Printf("helius: page %d — %d sigs this page, %d total", page, len(sigsResp), len(allSigs))

		if reachedEnd || len(sigsResp) < 100 {
			break
		}
		before = sigsResp[len(sigsResp)-1].Signature
	}

	if len(allSigs) == 0 {
		return nil, nil
	}

	// Step 2: resolve signatures → token mints
	return c.ParseTransactionsForMints(ctx, allSigs)
}

// DebugTransactionTypes prints type/source for a batch of signatures (for debugging).
func (c *Client) DebugTransactionTypes(ctx context.Context, sigs []string) {
	var parsed []struct {
		Type           string `json:"type"`
		Source         string `json:"source"`
		Description    string `json:"description"`
		TokenTransfers []struct {
			Mint string `json:"mint"`
		} `json:"tokenTransfers"`
	}
	if err := c.doREST("/transactions", map[string]any{"transactions": sigs}, &parsed); err != nil {
		log.Printf("debug error: %v", err)
		return
	}
	for i, tx := range parsed {
		mintList := ""
		for _, tt := range tx.TokenTransfers {
			mintList += tt.Mint + " "
		}
		log.Printf("  [%d] type=%-20s source=%-15s mints=[%s]", i, tx.Type, tx.Source, mintList)
	}
}

// Well-known infrastructure tokens to ignore when extracting mints.
var ignoreMints = map[string]bool{
	"So11111111111111111111111111111111111111112":  true, // Wrapped SOL
	"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": true, // USDC
	"Es9vMFrzaCERmKfrE1SBVdVJn1FUiJCs7rhWP2x4VPkx":  true, // USDT
	"mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So":   true, // mSOL
	"7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj":  true, // stSOL
	"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263":  true, // BONK
	"JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN":   true, // JUP
}

// ParseTransactionsForMints takes a list of tx signatures and uses the Helius
// enhanced transactions API to extract unique token mint addresses.
// Filters by transaction type and ignores well-known infrastructure tokens.
func (c *Client) ParseTransactionsForMints(ctx context.Context, sigs []string) ([]string, error) {
	seen := map[string]bool{}
	var mints []string

	for i := 0; i < len(sigs); i += 50 {
		select {
		case <-ctx.Done():
			return mints, ctx.Err()
		default:
		}

		end := i + 50
		if end > len(sigs) {
			end = len(sigs)
		}
		batch := sigs[i:end]

		if i > 0 {
			time.Sleep(300 * time.Millisecond) // rate limit
		}

		var parsed []struct {
			TokenTransfers []struct {
				Mint string `json:"mint"`
			} `json:"tokenTransfers"`
		}
		if err := c.doREST("/transactions", map[string]any{"transactions": batch}, &parsed); err != nil {
			log.Printf("helius: parse batch %d-%d error: %v", i, end, err)
			continue
		}

		for _, tx := range parsed {
			for _, tt := range tx.TokenTransfers {
				if tt.Mint != "" && !seen[tt.Mint] && !ignoreMints[tt.Mint] {
					seen[tt.Mint] = true
					mints = append(mints, tt.Mint)
				}
			}
		}
		log.Printf("helius: resolved batch %d-%d → %d unique mints so far", i, end, len(mints))
	}

	return mints, nil
}

// GetMintFromSignature fetches a transaction via the Helius enhanced API and
// returns the first non-infrastructure token mint found in its token transfers.
func (c *Client) GetMintFromSignature(sig string) (string, error) {
	var parsed []struct {
		TokenTransfers []struct {
			Mint string `json:"mint"`
		} `json:"tokenTransfers"`
	}
	if err := c.doREST("/transactions", map[string]any{"transactions": []string{sig}}, &parsed); err != nil {
		return "", err
	}
	for _, tx := range parsed {
		for _, tt := range tx.TokenTransfers {
			if tt.Mint != "" && !ignoreMints[tt.Mint] {
				return tt.Mint, nil
			}
		}
	}
	return "", fmt.Errorf("no token mint found in tx %s", sig)
}

// GetSOLReceivedByAddress returns the net SOL received by addr in a transaction.
// It calls getTransaction RPC and computes postBalance - preBalance for addr's account index.
func (c *Client) GetSOLReceivedByAddress(ctx context.Context, sig, addr string) (float64, error) {
	var txResp struct {
		Transaction struct {
			Message struct {
				AccountKeys []string `json:"accountKeys"`
			} `json:"message"`
		} `json:"transaction"`
		Meta struct {
			PreBalances  []int64 `json:"preBalances"`
			PostBalances []int64 `json:"postBalances"`
		} `json:"meta"`
	}

	params := []any{sig, map[string]any{"encoding": "json", "commitment": "finalized"}}
	if err := c.doRPC("getTransaction", params, &txResp); err != nil {
		return 0, fmt.Errorf("getTransaction: %w", err)
	}

	keys := txResp.Transaction.Message.AccountKeys
	for i, key := range keys {
		if key == addr {
			if i < len(txResp.Meta.PreBalances) && i < len(txResp.Meta.PostBalances) {
				delta := txResp.Meta.PostBalances[i] - txResp.Meta.PreBalances[i]
				return float64(delta) / 1e9, nil
			}
			return 0, fmt.Errorf("balance arrays too short for index %d", i)
		}
	}
	return 0, fmt.Errorf("address %s not found in transaction %s", addr, sig)
}
