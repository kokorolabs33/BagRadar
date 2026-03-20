// internal/service/alerter.go
package service

import (
	"context"
)

type SendFunc func(chatID int64, message string)

type subscriberGetter interface {
	GetSubscribers(context.Context) ([]int64, error)
}

type alertMarker interface {
	HasAlerted(context.Context, string) (bool, error)
	MarkAlerted(context.Context, string) error
}

type Alerter struct {
	alerts    alertMarker
	users     subscriberGetter
	send      SendFunc
	threshold float64
}

func NewAlerter(alerts alertMarker, users subscriberGetter, send SendFunc) *Alerter {
	return &Alerter{alerts: alerts, users: users, send: send, threshold: 7.0}
}

// ClaimAlert checks threshold, prior alert, and subscriber existence.
// If eligible, immediately marks the token as alerted to prevent duplicates.
// Returns true if the caller should proceed with building and sending the alert.
func (a *Alerter) ClaimAlert(ctx context.Context, mint string, composite float64, status string) bool {
	if status != "active" || composite < a.threshold {
		return false
	}
	alerted, err := a.alerts.HasAlerted(ctx, mint)
	if err != nil || alerted {
		return false
	}
	subs, err := a.users.GetSubscribers(ctx)
	if err != nil || len(subs) == 0 {
		return false
	}
	// Mark immediately to prevent concurrent duplicates
	if err := a.alerts.MarkAlerted(ctx, mint); err != nil {
		return false
	}
	return true
}

// SendAlert sends a pre-built message to all subscribers.
// Call ClaimAlert first — it handles dedup and threshold checks.
func (a *Alerter) SendAlert(ctx context.Context, msg string) {
	subs, err := a.users.GetSubscribers(ctx)
	if err != nil {
		return
	}
	for _, id := range subs {
		a.send(id, msg)
	}
}
