// internal/service/alerter_test.go
package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"bagradar/internal/service"
)

type mockAlertRepo struct{ alerted map[string]bool }

func (m *mockAlertRepo) HasAlerted(_ context.Context, mint string) (bool, error) {
	return m.alerted[mint], nil
}
func (m *mockAlertRepo) MarkAlerted(_ context.Context, mint string) error {
	m.alerted[mint] = true; return nil
}

type mockSubRepo struct{ subs []int64 }

func (m *mockSubRepo) GetSubscribers(_ context.Context) ([]int64, error) {
	return m.subs, nil
}

func TestClaimAlert_SkipsIfAlreadyAlerted(t *testing.T) {
	alertRepo := &mockAlertRepo{alerted: map[string]bool{"M1": true}}
	a := service.NewAlerter(alertRepo, &mockSubRepo{subs: []int64{1}}, func(_ int64, _ string) {})
	assert.False(t, a.ClaimAlert(context.Background(), "M1", 8.0, "active"))
}

func TestClaimAlert_SkipsIfScoreTooLow(t *testing.T) {
	alertRepo := &mockAlertRepo{alerted: map[string]bool{}}
	a := service.NewAlerter(alertRepo, &mockSubRepo{subs: []int64{1}}, func(_ int64, _ string) {})
	assert.False(t, a.ClaimAlert(context.Background(), "M2", 6.5, "active"))
}

func TestClaimAlert_SkipsWhenNoSubscribers(t *testing.T) {
	alertRepo := &mockAlertRepo{alerted: map[string]bool{}}
	a := service.NewAlerter(alertRepo, &mockSubRepo{subs: nil}, func(_ int64, _ string) {})
	assert.False(t, a.ClaimAlert(context.Background(), "M3", 8.0, "active"))
	assert.False(t, alertRepo.alerted["M3"], "should not mark alerted when no subscribers")
}

func TestClaimAlert_MarksImmediately(t *testing.T) {
	alertRepo := &mockAlertRepo{alerted: map[string]bool{}}
	a := service.NewAlerter(alertRepo, &mockSubRepo{subs: []int64{1}}, func(_ int64, _ string) {})
	assert.True(t, a.ClaimAlert(context.Background(), "M4", 8.0, "active"))
	assert.True(t, alertRepo.alerted["M4"], "should mark alerted immediately on claim")
	// Second claim should fail
	assert.False(t, a.ClaimAlert(context.Background(), "M4", 8.0, "active"))
}

func TestSendAlert_SendsToAllSubscribers(t *testing.T) {
	alertRepo := &mockAlertRepo{alerted: map[string]bool{}}
	var sentTo []int64
	a := service.NewAlerter(alertRepo, &mockSubRepo{subs: []int64{111, 222}},
		func(id int64, _ string) { sentTo = append(sentTo, id) })
	a.SendAlert(context.Background(), "full report")
	assert.ElementsMatch(t, []int64{111, 222}, sentTo)
}
