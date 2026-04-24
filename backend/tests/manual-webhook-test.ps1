# Manual Webhook Testing Script (PowerShell)
# ==========================================
# Run this after starting the server with: npm run dev

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$BotId = "manual-test-bot-$(Get-Date -Format 'yyyyMMddHHmmss')"

Write-Host "🧪 Manual Webhook Test" -ForegroundColor Cyan
Write-Host "======================"
Write-Host "Base URL: $BaseUrl"
Write-Host "Bot ID: $BotId"
Write-Host ""

# Step 1: Create a meeting in the database first
Write-Host "📅 Step 1: Creating meeting record..." -ForegroundColor Yellow

$meetingBody = @{
    tenantId = "test-tenant-manual"
    title = "Manual Webhook Test Meeting"
    meetingUrl = "https://meet.google.com/test-manual"
    externalId = $BotId
} | ConvertTo-Json

try {
    $meetingResponse = Invoke-RestMethod -Uri "$BaseUrl/api/meetings" -Method Post -Body $meetingBody -ContentType "application/json"
    Write-Host "Meeting created: $($meetingResponse.id)" -ForegroundColor Green
} catch {
    Write-Host "Note: Meeting creation may have failed (endpoint might not exist). Continuing..." -ForegroundColor Yellow
    Write-Host "Error: $_" -ForegroundColor Gray
}
Write-Host ""

# Step 2: Send bot.status_change: joining
Write-Host "🤖 Step 2: Sending bot.status_change (joining)..." -ForegroundColor Yellow

$joiningBody = @{
    event = "bot.status_change"
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    data = @{
        bot_id = $BotId
        status = "joining"
    }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "$BaseUrl/webhooks/recall" -Method Post -Body $joiningBody -ContentType "application/json"
Write-Host "  ✓ Sent joining status" -ForegroundColor Green
Start-Sleep -Seconds 1

# Step 3: Send bot.status_change: in_call
Write-Host "🤖 Step 3: Sending bot.status_change (in_call)..." -ForegroundColor Yellow

$inCallBody = @{
    event = "bot.status_change"
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    data = @{
        bot_id = $BotId
        status = "in_call"
    }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "$BaseUrl/webhooks/recall" -Method Post -Body $inCallBody -ContentType "application/json"
Write-Host "  ✓ Sent in_call status" -ForegroundColor Green
Start-Sleep -Seconds 1

# Step 4: Send transcription chunks
Write-Host "📝 Step 4: Sending transcription chunks..." -ForegroundColor Yellow

$chunks = @(
    @{ speaker = "Sarah (PM)"; text = "Good morning everyone. Let's discuss the new feature."; start = 0; end = 5 },
    @{ speaker = "Mike (Tech Lead)"; text = "Sure. We need OAuth 2.0 integration."; start = 5; end = 12 },
    @{ speaker = "Sarah (PM)"; text = "What's the timeline?"; start = 12; end = 15 },
    @{ speaker = "Mike (Tech Lead)"; text = "Two sprints for full implementation."; start = 15; end = 20 },
    @{ speaker = "Lisa (Designer)"; text = "I have mockups ready for review."; start = 20; end = 25 }
)

foreach ($chunk in $chunks) {
    $transcriptBody = @{
        event = "bot.transcription"
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        data = @{
            bot_id = $BotId
            transcription = @{
                text = $chunk.text
                speaker = $chunk.speaker
                start_time = $chunk.start
                end_time = $chunk.end
                confidence = 0.95
            }
        }
    } | ConvertTo-Json -Depth 4

    Invoke-RestMethod -Uri "$BaseUrl/webhooks/recall" -Method Post -Body $transcriptBody -ContentType "application/json"
    Write-Host "  ✓ $($chunk.speaker): $($chunk.text)" -ForegroundColor Gray
    Start-Sleep -Milliseconds 200
}
Write-Host ""

# Step 5: Send bot.status_change: done
Write-Host "✅ Step 5: Sending bot.status_change (done)..." -ForegroundColor Yellow

$doneBody = @{
    event = "bot.status_change"
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    data = @{
        bot_id = $BotId
        status = "done"
    }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "$BaseUrl/webhooks/recall" -Method Post -Body $doneBody -ContentType "application/json"
Write-Host "  ✓ Sent done status" -ForegroundColor Green

# Step 6: Wait and check results
Write-Host ""
Write-Host "⏳ Waiting 3 seconds for processing..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "📊 Step 6: Check results:" -ForegroundColor Cyan
Write-Host "   1. Open Prisma Studio: npm run db:studio" -ForegroundColor White
Write-Host "   2. Check Meeting table for status = 'completed'" -ForegroundColor White
Write-Host "   3. Check meeting metadata for transcriptChunks array" -ForegroundColor White
Write-Host ""
Write-Host "🔍 Or query the API:" -ForegroundColor Cyan
Write-Host "   curl $BaseUrl/api/meetings" -ForegroundColor White
Write-Host ""
Write-Host "🎉 Manual webhook test complete!" -ForegroundColor Green
