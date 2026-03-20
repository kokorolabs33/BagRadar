package bot

import (
	"bagradar/internal/repository"
	"bagradar/internal/service"
)

func FormatScanReport(token *repository.Token, static *repository.StaticScores,
	dynamic *repository.DynamicScores, ai *repository.AIAnalysis) string {
	return service.FormatScanReport(token, static, dynamic, ai)
}

func FormatInfoReport(token *repository.Token, dynamic *repository.DynamicScores) string {
	return service.FormatInfoReport(token, dynamic)
}

func esc(s string) string {
	return service.Esc(s)
}
