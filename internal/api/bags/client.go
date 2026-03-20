// Package bags provides a client for the Bags.fm public API.
package bags

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const baseURL = "https://public-api-v2.bags.fm/api/v1"

// Client is an authenticated Bags.fm API client.
type Client struct {
	apiKey string
	http   *http.Client
}

// New creates a new Bags API client.
func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 10 * time.Second},
	}
}

// FeedToken represents a token from the launch feed.
type FeedToken struct {
	TokenMint   string   `json:"tokenMint"`
	Name        string   `json:"name"`
	Symbol      string   `json:"symbol"`
	Twitter     string   `json:"twitter"`
	Website     string   `json:"website"`
	Description string   `json:"description"`
	Status      string   `json:"status"`      // "PRE_GRAD", "MIGRATED", etc.
	AccountKeys []string `json:"accountKeys"` // [0]=program, [1]=tokenMint, [2]=creator wallet, ...
	URI         string   `json:"uri"`         // IPFS metadata URI
}

// PoolData contains on-chain market data for a token.
type PoolData struct {
	MarketCap float64 `json:"marketCap"`
	Volume24h float64 `json:"volume24h"`
	Price     float64 `json:"price"`
}

// FeesData contains lifetime fee data for a token.
type FeesData struct {
	LifetimeFees float64 `json:"lifetimeFees"`
}

func (c *Client) do(url string, target any) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-api-key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bags API %s: %s", url, resp.Status)
	}
	// All Bags API responses are wrapped: {"success": bool, "response": T}
	var wrapper struct {
		Success  bool            `json:"success"`
		Response json.RawMessage `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrapper); err != nil {
		return err
	}
	if !wrapper.Success {
		return fmt.Errorf("bags API %s: success=false", url)
	}
	return json.Unmarshal(wrapper.Response, target)
}

// GetFeed returns the latest token launches.
func (c *Client) GetFeed() ([]FeedToken, error) {
	var result []FeedToken
	if err := c.do(baseURL+"/token-launch/feed", &result); err != nil {
		return nil, err
	}
	return result, nil
}

// GetPool returns on-chain pool data for the given token mint.
func (c *Client) GetPool(tokenMint string) (*PoolData, error) {
	url := fmt.Sprintf("%s/solana/bags/pools/token-mint?tokenMint=%s", baseURL, tokenMint)
	var result PoolData
	if err := c.do(url, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetLifetimeFees returns lifetime fee data for the given token mint.
// The API returns a lamports string like "158400"; we convert to SOL float.
func (c *Client) GetLifetimeFees(tokenMint string) (*FeesData, error) {
	url := fmt.Sprintf("%s/token-launch/lifetime-fees?tokenMint=%s", baseURL, tokenMint)
	// Response is a raw string (lamports), not an object
	var lamportsStr string
	if err := c.do(url, &lamportsStr); err != nil {
		return nil, err
	}
	var lamports float64
	fmt.Sscanf(lamportsStr, "%f", &lamports)
	return &FeesData{LifetimeFees: lamports / 1e9}, nil // convert lamports → SOL
}

// GetAllPools returns all Bags pool entries (token mints + pool keys).
// Warning: this returns ~169k entries and may be slow.
func (c *Client) GetAllPools() ([]PoolEntry, error) {
	var result []PoolEntry
	if err := c.do(baseURL+"/solana/bags/pools", &result); err != nil {
		return nil, err
	}
	return result, nil
}

// PoolEntry is a lightweight entry from the all-pools endpoint.
type PoolEntry struct {
	TokenMint     string `json:"tokenMint"`
	DBCConfigKey  string `json:"dbcConfigKey"`
	DBCPoolKey    string `json:"dbcPoolKey"`
	DAMMv2PoolKey string `json:"dammV2PoolKey"`
}

// GetTokenByMint fetches token metadata for a specific mint from Bags.fm.
// If Bags.fm doesn't support single-mint lookup, fetches feed and filters.
func (c *Client) GetTokenByMint(ctx context.Context, mint string) (*FeedToken, error) {
	feed, err := c.GetFeed()
	if err != nil {
		return nil, err
	}
	for _, t := range feed {
		if t.TokenMint == mint {
			return &t, nil
		}
	}
	return nil, nil // not found in recent feed
}
