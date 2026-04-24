# Schedule a Real Recall.ai Bot
# ==============================
# Run this after starting ngrok and the server

param(
    [Parameter(Mandatory=$true)]
    [string]$MeetingUrl,

    [string]$BaseUrl = "http://localhost:3000",
    [string]$TenantId = "test-tenant-real"
)

Write-Host "Scheduling Recall.ai Bot" -ForegroundColor Cyan
Write-Host "========================="
Write-Host "Meeting URL: $MeetingUrl"
Write-Host "Base URL: $BaseUrl"
Write-Host ""

# Schedule the bot via API
$body = @{
    title = "Real Meeting Test - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    meetingUrl = $MeetingUrl
} | ConvertTo-Json

# API requires Authorization header and X-Tenant-ID header
$headers = @{
    "Authorization" = "Bearer dev-api-key"
    "X-Tenant-ID" = $TenantId
}

Write-Host "Scheduling bot..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/api/meetings" -Method Post -Body $body -Headers $headers -ContentType "application/json"

    Write-Host ""
    Write-Host "Bot scheduled successfully!" -ForegroundColor Green
    Write-Host "Meeting ID: $($response.data.meetingId)" -ForegroundColor White
    Write-Host "Bot ID: $($response.data.botId)" -ForegroundColor White
    Write-Host "Status: $($response.data.status)" -ForegroundColor White
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "   1. The bot will join your meeting automatically"
    Write-Host "   2. Speak during the meeting - it will transcribe"
    Write-Host "   3. When you end the meeting, watch the server logs"
    Write-Host "   4. Check Prisma Studio for the transcript"
    Write-Host ""
    Write-Host "Monitor with:" -ForegroundColor Yellow
    Write-Host "   npm run db:studio"

} catch {
    Write-Host "Failed to schedule bot" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure:" -ForegroundColor Yellow
    Write-Host "   1. Server is running (npm run dev)"
    Write-Host "   2. RECALL_API_KEY is set in .env"
    Write-Host "   3. Meeting URL is valid Google Meet/Zoom/Teams link"
}
