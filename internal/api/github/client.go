// Package github provides a GitHub API client with optional auth and in-memory caching.
package github

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ErrRateLimited is returned when the GitHub API returns a 429 or 403.
var ErrRateLimited = errors.New("github: rate limited")

// User represents a GitHub user profile.
type User struct {
	Login       string    `json:"login"`
	CreatedAt   time.Time `json:"created_at"`
	PublicRepos int       `json:"public_repos"`
	Followers   int       `json:"followers"`
}

// Repo represents a GitHub repository.
type Repo struct {
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Topics          []string  `json:"topics"`
	Language        string    `json:"language"`
	StargazersCount int       `json:"stargazers_count"`
	ForksCount      int       `json:"forks_count"`
	Fork            bool      `json:"fork"`
	OpenIssuesCount int       `json:"open_issues_count"`
	PushedAt        time.Time `json:"pushed_at"`
}

// RepoContent represents a file or directory entry in a GitHub repo.
type RepoContent struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Event represents a GitHub user event.
type Event struct {
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"created_at"`
}

// Web3Expertise describes a GitHub user's Web3/Solana development background.
type Web3Expertise struct {
	HasSolanaRepos bool
	HasWeb3Repos   bool
	HasRustRepos   bool
	Web3RepoCount  int    // total web3-related repos (Solana + general web3)
	TopWeb3Repo    string // name of most starred web3 repo
	ExpertiseLevel string // "solana-native", "web3-experienced", "web3-beginner", "no-web3"
}

// ProjectRepo holds details about a GitHub repo that matches a token project.
type ProjectRepo struct {
	Found      bool
	RepoName   string
	Stars      int
	Forks      int
	IsFork     bool
	HasCode    bool
	LastCommit time.Time
	HasTests   bool
	HasCI      bool
	Language   string
	OpenIssues int
}

// Client is a GitHub API client with optional token auth and result caching.
type Client struct {
	token string
	http  *http.Client

	mu        sync.RWMutex
	userCache map[string]*User
	repoCache map[string][]Repo
}

// New creates a GitHub client. token may be empty for unauthenticated access.
func New(token string) *Client {
	return &Client{
		token:     token,
		http:      &http.Client{Timeout: 10 * time.Second},
		userCache: make(map[string]*User),
		repoCache: make(map[string][]Repo),
	}
}

func (c *Client) do(url string, target any) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// 403 is returned for rate limits when unauthenticated
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusForbidden {
		return ErrRateLimited
	}
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("github: not found: %s", url)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("github API error %s: %s", url, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

// GetUser returns public profile data for username, using cache when available.
func (c *Client) GetUser(username string) (*User, error) {
	c.mu.RLock()
	if u, ok := c.userCache[username]; ok {
		c.mu.RUnlock()
		return u, nil
	}
	c.mu.RUnlock()

	var user User
	if err := c.do(fmt.Sprintf("https://api.github.com/users/%s", username), &user); err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.userCache[username] = &user
	c.mu.Unlock()
	return &user, nil
}

// GetUserRepos returns public repos for username, using cache when available.
func (c *Client) GetUserRepos(username string) ([]Repo, error) {
	c.mu.RLock()
	if repos, ok := c.repoCache[username]; ok {
		c.mu.RUnlock()
		return repos, nil
	}
	c.mu.RUnlock()

	var repos []Repo
	if err := c.do(
		fmt.Sprintf("https://api.github.com/users/%s/repos?per_page=100&sort=updated", username),
		&repos,
	); err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.repoCache[username] = repos
	c.mu.Unlock()
	return repos, nil
}

// HasRecentActivity returns true if the user has PushEvents in the last 30 days.
func (c *Client) HasRecentActivity(username string) (bool, error) {
	var events []Event
	if err := c.do(
		fmt.Sprintf("https://api.github.com/users/%s/events?per_page=100", username),
		&events,
	); err != nil {
		return false, err
	}
	cutoff := time.Now().Add(-30 * 24 * time.Hour)
	for _, e := range events {
		if e.Type == "PushEvent" && e.CreatedAt.After(cutoff) {
			return true, nil
		}
	}
	return false, nil
}

// GetWeb3Expertise analyses a user's repos to determine their Web3/Solana expertise.
// It reuses the cached repo list from GetUserRepos when available.
func (c *Client) GetWeb3Expertise(username string) (Web3Expertise, error) {
	repos, err := c.GetUserRepos(username)
	if err != nil {
		return Web3Expertise{}, err
	}

	solanaKw := []string{"solana", "anchor", "spl-token", "spl"}
	web3Kw := []string{"web3", "blockchain", "defi", "nft", "smart-contract", "ethereum"}

	var result Web3Expertise
	topWeb3Stars := -1

	for _, repo := range repos {
		// Build a single string from searchable fields
		fields := strings.ToLower(repo.Name + " " + repo.Description + " " + repo.Language)
		for _, t := range repo.Topics {
			fields += " " + strings.ToLower(t)
		}

		isSolana := containsAny(fields, solanaKw)
		isWeb3 := containsAny(fields, web3Kw)
		isRust := repo.Language == "Rust" || strings.Contains(strings.ToLower(repo.Name), "rust")

		if isSolana {
			result.HasSolanaRepos = true
		}
		if isWeb3 {
			result.HasWeb3Repos = true
		}
		if isRust {
			result.HasRustRepos = true
		}
		if isSolana || isWeb3 {
			result.Web3RepoCount++
			if repo.StargazersCount > topWeb3Stars {
				topWeb3Stars = repo.StargazersCount
				result.TopWeb3Repo = repo.Name
			}
		}
	}

	switch {
	case result.HasSolanaRepos:
		result.ExpertiseLevel = "solana-native"
	case result.HasWeb3Repos && result.Web3RepoCount >= 3:
		result.ExpertiseLevel = "web3-experienced"
	case result.HasWeb3Repos:
		result.ExpertiseLevel = "web3-beginner"
	default:
		result.ExpertiseLevel = "no-web3"
	}

	return result, nil
}

// FindProjectRepo looks for a repo matching the token name or symbol in the user's repos.
// It makes additional API calls to inspect the repo's file structure.
func (c *Client) FindProjectRepo(username, tokenName, tokenSymbol string) (*ProjectRepo, error) {
	if tokenName == "" && tokenSymbol == "" {
		return &ProjectRepo{Found: false}, nil
	}

	repos, err := c.GetUserRepos(username)
	if err != nil {
		return nil, err
	}

	nameLow := strings.ToLower(tokenName)
	symLow := strings.ToLower(tokenSymbol)

	var match *Repo
	for i := range repos {
		rn := strings.ToLower(repos[i].Name)
		rd := strings.ToLower(repos[i].Description)
		if (nameLow != "" && (strings.Contains(rn, nameLow) || strings.Contains(rd, nameLow))) ||
			(symLow != "" && (strings.Contains(rn, symLow) || strings.Contains(rd, symLow))) {
			match = &repos[i]
			break
		}
	}

	if match == nil {
		return &ProjectRepo{Found: false}, nil
	}

	pr := &ProjectRepo{
		Found:      true,
		RepoName:   match.Name,
		Stars:      match.StargazersCount,
		Forks:      match.ForksCount,
		IsFork:     match.Fork,
		LastCommit: match.PushedAt,
		Language:   match.Language,
		OpenIssues: match.OpenIssuesCount,
	}

	// Inspect root contents for code and test indicators
	var contents []RepoContent
	contentsURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents", username, match.Name)
	if err := c.do(contentsURL, &contents); err == nil {
		for _, item := range contents {
			low := strings.ToLower(item.Name)
			switch low {
			case "test", "tests", "spec", "__tests__":
				pr.HasTests = true
			}
		}
		pr.HasCode = len(contents) > 2
	}

	// Check for CI workflows
	var workflows []RepoContent
	workflowsURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/.github/workflows", username, match.Name)
	if err := c.do(workflowsURL, &workflows); err == nil && len(workflows) > 0 {
		pr.HasCI = true
	}

	return pr, nil
}

// containsAny returns true if s contains any of the given keywords.
func containsAny(s string, keywords []string) bool {
	for _, kw := range keywords {
		if strings.Contains(s, kw) {
			return true
		}
	}
	return false
}
