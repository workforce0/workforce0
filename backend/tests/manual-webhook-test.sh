#!/bin/bash
# Manual Webhook Testing Script
# ==============================
# Run this after starting the server with: npm run dev

BASE_URL="${BASE_URL:-http://localhost:3000}"
BOT_ID="manual-test-bot-$(date +%s)"

echo "🧪 Manual Webhook Test"
echo "======================"
echo "Base URL: $BASE_URL"
echo "Bot ID: $BOT_ID"
echo ""

# Step 1: Create a meeting in the database first
echo "📅 Step 1: Creating meeting record..."
MEETING_RESPONSE=$(curl -s -X POST "$BASE_URL/api/meetings" \
  -H "Content-Type: application/json" \
  -d "{
    \"tenantId\": \"test-tenant-manual\",
    \"title\": \"Manual Webhook Test Meeting\",
    \"meetingUrl\": \"https://meet.google.com/test-manual\",
    \"externalId\": \"$BOT_ID\"
  }")

echo "Response: $MEETING_RESPONSE"
echo ""

# Step 2: Send bot.status_change: joining
echo "🤖 Step 2: Sending bot.status_change (joining)..."
curl -s -X POST "$BASE_URL/webhooks/recall" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"bot.status_change\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"data\": {
      \"bot_id\": \"$BOT_ID\",
      \"status\": \"joining\"
    }
  }"
echo ""
sleep 1

# Step 3: Send bot.status_change: in_call
echo "🤖 Step 3: Sending bot.status_change (in_call)..."
curl -s -X POST "$BASE_URL/webhooks/recall" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"bot.status_change\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"data\": {
      \"bot_id\": \"$BOT_ID\",
      \"status\": \"in_call\"
    }
  }"
echo ""
sleep 1

# Step 4: Send transcription chunks
echo "📝 Step 4: Sending transcription chunks..."

CHUNKS=(
  "Sarah (PM)|Good morning everyone. Let's discuss the new feature.|0|5"
  "Mike (Tech Lead)|Sure. We need OAuth 2.0 integration.|5|12"
  "Sarah (PM)|What's the timeline?|12|15"
  "Mike (Tech Lead)|Two sprints for full implementation.|15|20"
  "Lisa (Designer)|I have mockups ready for review.|20|25"
)

for chunk in "${CHUNKS[@]}"; do
  IFS='|' read -r speaker text start end <<< "$chunk"
  curl -s -X POST "$BASE_URL/webhooks/recall" \
    -H "Content-Type: application/json" \
    -d "{
      \"event\": \"bot.transcription\",
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"data\": {
        \"bot_id\": \"$BOT_ID\",
        \"transcription\": {
          \"text\": \"$text\",
          \"speaker\": \"$speaker\",
          \"start_time\": $start,
          \"end_time\": $end,
          \"confidence\": 0.95
        }
      }
    }"
  echo "  Sent: $speaker - $text"
  sleep 0.2
done
echo ""

# Step 5: Send bot.status_change: done
echo "✅ Step 5: Sending bot.status_change (done)..."
curl -s -X POST "$BASE_URL/webhooks/recall" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"bot.status_change\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"data\": {
      \"bot_id\": \"$BOT_ID\",
      \"status\": \"done\"
    }
  }"
echo ""

# Step 6: Wait and check results
echo ""
echo "⏳ Waiting 3 seconds for processing..."
sleep 3

echo ""
echo "📊 Step 6: Check results in Prisma Studio:"
echo "   npm run db:studio"
echo ""
echo "Or check the server logs for:"
echo "   - Meeting status updates"
echo "   - Transcription chunks stored"
echo "   - BA Agent task queued (if Recall.ai API configured)"
echo ""
echo "🎉 Manual webhook test complete!"
