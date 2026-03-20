// Package twitter provides a client for Twitter/X profile lookups via the internal GraphQL API.
package twitter

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const bearerToken = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"

// Client is a Twitter/X GraphQL API client authenticated via cookies.
type Client struct {
	authToken string
	csrfToken string
	http      *http.Client
}

// New creates a new Twitter client. authToken and csrfToken come from browser cookies.
func New(authToken, csrfToken string) *Client {
	return &Client{
		authToken: authToken,
		csrfToken: csrfToken,
		http:      &http.Client{Timeout: 10 * time.Second},
	}
}

// Profile holds parsed Twitter user data.
type Profile struct {
	Username       string
	Name           string
	Bio            string
	FollowersCount int
	CreatedAt      time.Time
	WebsiteURL     string // expanded URL from entities
	IsVerified     bool
	AccountAgeDays int
}

// GetProfile fetches a Twitter user profile by username.
func (c *Client) GetProfile(username string) (*Profile, error) {
	variables, _ := json.Marshal(map[string]any{
		"screen_name":              username,
		"withSafetyModeUserFields": true,
	})
	features, _ := json.Marshal(map[string]any{
		"hidden_profile_subscriptions_enabled": true,
	})

	params := url.Values{}
	params.Set("variables", string(variables))
	params.Set("features", string(features))

	reqURL := "https://x.com/i/api/graphql/k5XapwcSikNsEsILW5FvgA/UserByScreenName?" + params.Encode()

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("twitter: build request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("x-csrf-token", c.csrfToken)
	req.Header.Set("x-twitter-active-user", "yes")
	req.Header.Set("x-twitter-client-language", "en")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Cookie", fmt.Sprintf("auth_token=%s; ct0=%s", c.authToken, c.csrfToken))

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("twitter: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("twitter: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("twitter: read body: %w", err)
	}

	return parseProfile(body)
}

// parseProfile extracts a Profile from the GraphQL JSON response.
func parseProfile(body []byte) (*Profile, error) {
	var raw struct {
		Data struct {
			User struct {
				Result struct {
					Legacy struct {
						Name           string `json:"name"`
						ScreenName     string `json:"screen_name"`
						Description    string `json:"description"`
						FollowersCount int    `json:"followers_count"`
						CreatedAt      string `json:"created_at"`
						URL            string `json:"url"`
						Entities       struct {
							URL struct {
								URLs []struct {
									ExpandedURL string `json:"expanded_url"`
								} `json:"urls"`
							} `json:"url"`
						} `json:"entities"`
					} `json:"legacy"`
					IsBlueVerified bool `json:"is_blue_verified"`
				} `json:"result"`
			} `json:"user"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("twitter: parse json: %w", err)
	}

	legacy := raw.Data.User.Result.Legacy
	if legacy.ScreenName == "" {
		return nil, fmt.Errorf("twitter: user not found")
	}

	createdAt, err := time.Parse(time.RubyDate, legacy.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("twitter: parse created_at %q: %w", legacy.CreatedAt, err)
	}

	var websiteURL string
	if urls := legacy.Entities.URL.URLs; len(urls) > 0 {
		websiteURL = urls[0].ExpandedURL
	}

	ageDays := int(time.Since(createdAt).Hours() / 24)

	return &Profile{
		Username:       legacy.ScreenName,
		Name:           legacy.Name,
		Bio:            legacy.Description,
		FollowersCount: legacy.FollowersCount,
		CreatedAt:      createdAt,
		WebsiteURL:     websiteURL,
		IsVerified:     raw.Data.User.Result.IsBlueVerified,
		AccountAgeDays: ageDays,
	}, nil
}

// UsernameFromURL extracts the Twitter username from a URL like
// "https://x.com/user" or "https://twitter.com/user". Returns the input
// unchanged if it doesn't look like a URL.
func UsernameFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	for _, prefix := range []string{"https://x.com/", "https://twitter.com/", "http://x.com/", "http://twitter.com/"} {
		if strings.HasPrefix(raw, prefix) {
			name := strings.TrimPrefix(raw, prefix)
			// Take only the first path segment (the username)
			if i := strings.Index(name, "/"); i >= 0 {
				name = name[:i]
			}
			if i := strings.Index(name, "?"); i >= 0 {
				name = name[:i]
			}
			// Skip non-profile URLs (e.g. /i/status/..., /i/communities/...)
			if name == "" || name == "i" {
				return ""
			}
			return name
		}
	}
	return raw
}
