// Package dexscreener provides a client for the DexScreener public API.
package dexscreener

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const baseURL = "https://api.dexscreener.com/latest/dex"

// Client is a DexScreener API client (no auth required).
type Client struct {
	http *http.Client
}

// New creates a new DexScreener client.
func New() *Client {
	return &Client{
		http: &http.Client{Timeout: 10 * time.Second},
	}
}

// PairData holds the relevant trading signals for a token pair.
type PairData struct {
	ChainID      string
	DexID        string
	PairAddress  string
	PriceUSD     float64
	MarketCap    float64
	Volume24h    float64
	Change24h    float64 // price change percentage over 24h
	Buys24h      int
	Sells24h     int
	Makers24h    int     // approximated by buys count (DexScreener has no makers field)
	LiquidityUSD float64
	BaseToken    struct {
		Address string
	}
}

// BuySellRatio returns buys/sells ratio, or 0 if sells is zero.
func (p PairData) BuySellRatio() float64 {
	if p.Sells24h == 0 {
		return 0
	}
	return float64(p.Buys24h) / float64(p.Sells24h)
}

// rawPair matches the DexScreener API JSON shape for a pair.
type rawPair struct {
	ChainID     string  `json:"chainId"`
	DexID       string  `json:"dexId"`
	PairAddress string  `json:"pairAddress"`
	PriceUsd    string  `json:"priceUsd"`  // string in API response
	MarketCap   float64 `json:"marketCap"` // float in API response
	Makers      int     `json:"makers"`    // unique traders (if present)
	BaseToken   struct {
		Address string `json:"address"`
		Name    string `json:"name"`
		Symbol  string `json:"symbol"`
	} `json:"baseToken"`
	Txns struct {
		H24 struct {
			Buys  int `json:"buys"`
			Sells int `json:"sells"`
		} `json:"h24"`
	} `json:"txns"`
	Volume struct {
		H24 float64 `json:"h24"`
	} `json:"volume"`
	PriceChange struct {
		H24 float64 `json:"h24"`
	} `json:"priceChange"`
	Liquidity struct {
		USD float64 `json:"usd"`
	} `json:"liquidity"`
}

func (c *Client) get(url string, target any) error {
	resp, err := c.http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("dexscreener API: %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

func rawToPairData(rp rawPair) PairData {
	priceUSD, _ := strconv.ParseFloat(rp.PriceUsd, 64)
	pd := PairData{
		ChainID:      rp.ChainID,
		DexID:        rp.DexID,
		PairAddress:  rp.PairAddress,
		PriceUSD:     priceUSD,
		MarketCap:    rp.MarketCap,
		Volume24h:    rp.Volume.H24,
		Change24h:    rp.PriceChange.H24,
		Buys24h:      rp.Txns.H24.Buys,
		Sells24h:     rp.Txns.H24.Sells,
		Makers24h:    rp.Txns.H24.Buys, // approximate unique buyers with buy count
		LiquidityUSD: rp.Liquidity.USD,
	}
	pd.BaseToken.Address = rp.BaseToken.Address
	return pd
}

// GetTokenPairs returns all trading pairs for a token mint address.
// Pairs are returned in the order DexScreener provides (typically highest liquidity first).
func (c *Client) GetTokenPairs(tokenMint string) ([]PairData, error) {
	url := fmt.Sprintf("%s/tokens/%s", baseURL, tokenMint)

	var result struct {
		Pairs []rawPair `json:"pairs"`
	}
	if err := c.get(url, &result); err != nil {
		return nil, err
	}

	pairs := make([]PairData, 0, len(result.Pairs))
	for _, rp := range result.Pairs {
		pairs = append(pairs, rawToPairData(rp))
	}
	return pairs, nil
}

// BestPair returns the most relevant pair for a token.
// Priority: highest 24h volume (most active / most accurate price discovery).
// Rationale: a token may have multiple pools (old bonding curve + new Meteora DAMM v2);
// the one with highest volume reflects the true current market.
func BestPair(pairs []PairData) (PairData, bool) {
	if len(pairs) == 0 {
		return PairData{}, false
	}
	best := pairs[0]
	for _, p := range pairs[1:] {
		if p.Volume24h > best.Volume24h {
			best = p
		}
	}
	return best, true
}

// GetTopTraders is a placeholder — the DexScreener public API does not expose
// per-token top trader wallets, so this always returns nil.
func (c *Client) GetTopTraders(_ string) ([]string, error) {
	return nil, nil
}

// SearchBagsPairs returns token mint addresses of Bags.fm tokens with recent activity.
// It searches DexScreener for Solana pairs on the "bags" DEX.
func (c *Client) SearchBagsPairs() ([]string, error) {
	url := baseURL + "/search?q=BAGS"
	var result struct {
		Pairs []rawPair `json:"pairs"`
	}
	if err := c.get(url, &result); err != nil {
		return nil, err
	}

	var mints []string
	seen := map[string]bool{}
	for _, p := range result.Pairs {
		if p.ChainID != "solana" {
			continue
		}
		if p.Volume.H24 <= 500 {
			continue
		}
		addr := p.BaseToken.Address
		if !strings.HasSuffix(addr, "BAGS") {
			continue
		}
		if seen[addr] {
			continue
		}
		seen[addr] = true
		mints = append(mints, addr)
	}
	slog.Info("dexscreener deep scan found bags tokens", "count", len(mints))
	return mints, nil
}

// GetBestPair returns the pair with highest 24h volume for a single mint.
// Wraps the existing GetTokenPairs method.
func (c *Client) GetBestPair(ctx context.Context, mint string) (*PairData, error) {
	pairs, err := c.GetTokenPairs(mint)
	if err != nil || len(pairs) == 0 {
		return nil, err
	}
	best := pairs[0]
	for _, p := range pairs[1:] {
		if p.Volume24h > best.Volume24h {
			best = p
		}
	}
	return &best, nil
}

// GetBestPairs returns the best pair for each mint in the batch.
// DexScreener supports comma-separated mints (max 30).
func (c *Client) GetBestPairs(ctx context.Context, mints []string) (map[string]*PairData, error) {
	if len(mints) == 0 {
		return map[string]*PairData{}, nil
	}

	url := fmt.Sprintf("%s/tokens/%s", baseURL, strings.Join(mints, ","))
	var result struct {
		Pairs []rawPair `json:"pairs"`
	}
	if err := c.get(url, &result); err != nil {
		return nil, err
	}

	// Group by BaseToken.Address, keep highest Volume.H24 per mint.
	out := map[string]*PairData{}
	for _, rp := range result.Pairs {
		addr := rp.BaseToken.Address
		pd := rawToPairData(rp)
		if existing, ok := out[addr]; !ok || pd.Volume24h > existing.Volume24h {
			copy := pd
			out[addr] = &copy
		}
	}
	return out, nil
}
