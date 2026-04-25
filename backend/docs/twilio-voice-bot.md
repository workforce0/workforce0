# Twilio Dial-In Voice Bot

## Overview

The Twilio Dial-In Voice Bot enables AI voice participation in meetings where browser-based meeting bots cannot speak (e.g., Google Meet joins bots muted and prevents self-unmute).

**Solution:** Twilio dials into the meeting as a phone participant and speaks AI responses via bidirectional audio streaming.

## Architecture

```
Meeting (Google Meet / Zoom / Teams)
┌────────────────────────────────────────────────┐
│                                                │
│  Meeting bot ──────────  transcribes silently  │
│  (Vexa BYO, optional)                          │
│                                                │
│  Twilio Phone ────────── speaks AI responses   │
│  (+1-xxx-xxx-xxxx)       ↕ WebSocket          │
│                          ↕ Media Streams       │
│                                                │
│  Human participants hear AI speak              │
└──────────────────────────┼─────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────┐
│  Workforce0 Backend                              │
│                                                  │
│  ┌─────────────────┐    ┌────────────────────┐   │
│  │ Twilio Media    │◄──►│ Gemini Live        │   │
│  │ Stream Handler  │    │ Client             │   │
│  │ (WebSocket)     │    │ (audio I/O)        │   │
│  └─────────────────┘    └────────────────────┘   │
│           │                                      │
│           ▼                                      │
│  ┌─────────────────┐    ┌────────────────────┐   │
│  │ MeetingBot      │───►│ BA Agent           │   │
│  │ Provider        │    │ (PRD generation)   │   │
│  │ (transcript)    │    │                    │   │
│  └─────────────────┘    └────────────────────┘   │
└──────────────────────────────────────────────────┘
```

## How Twilio Media Streams Works

1. Twilio makes outbound call to meeting dial-in number
2. When connected, Twilio opens WebSocket to our server
3. **Inbound**: Twilio sends meeting audio (μ-law 8kHz encoded)
4. **Outbound**: We send AI audio to Twilio → plays in call
5. Everyone in meeting hears AI speak

**TwiML Response when call connects:**
```xml
<Response>
  <Connect>
    <Stream url="wss://your-server.com/media-stream/{meetingId}" />
  </Connect>
</Response>
```

## Audio Format Conversion

```
Meeting audio (μ-law 8kHz)
    ↓ decode μ-law table
PCM 8kHz (16-bit signed)
    ↓ resample (linear interpolation)
PCM 16kHz → Gemini Live
    ↓
Gemini response (PCM 24kHz)
    ↓ resample (decimation)
PCM 8kHz
    ↓ encode μ-law table
μ-law 8kHz → Twilio → Meeting
```

## Files Created

### 1. TwilioVoiceService
**File:** `src/services/voice/twilio-voice.service.ts`

Manages Twilio Voice API for dial-in functionality.

**Key Methods:**
- `dialIntoMeeting(meetingId, dialInNumber, pin?)` - Initiates call to meeting
- `generateConnectTwiML(meetingId)` - Returns TwiML for WebSocket stream
- `hangup(callSid)` - Ends a call by SID
- `hangupByMeeting(meetingId)` - Ends call by meeting ID
- `getActiveCalls()` - Lists all active calls
- `getCallByMeeting(meetingId)` - Gets call info for a meeting

### 2. TwilioMediaHandler
**File:** `src/services/voice/twilio-media-handler.ts`

Handles bidirectional audio streaming between Twilio and Gemini.

**Features:**
- μ-law encode/decode using lookup tables (ITU-T G.711)
- Audio resampling between 8kHz (Twilio) and 16/24kHz (Gemini)
- WebSocket message parsing for Twilio Media Streams protocol
- Event emitter for stream lifecycle events

**Events:**
- `streamStarted` - When Twilio stream begins
- `streamEnded` - When Twilio stream ends
- `audioReceived` - When audio received from meeting
- `audioSent` - When audio sent to meeting
- `aiResponse` - When Gemini generates response
- `error` - On any error

### 3. Twilio Routes
**File:** `src/routes/twilio.routes.ts`

**API Endpoints (authenticated):**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/dial-in` | POST | Initiate dial-in to meeting |
| `/api/voice/hangup` | POST | End a call |
| `/api/voice/calls` | GET | List active calls |

**Webhook Endpoints (no auth, signature verification):**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/twilio/voice` | POST | TwiML webhook |
| `/webhooks/twilio/status` | POST | Call status callback |

**WebSocket:**
| Endpoint | Description |
|----------|-------------|
| `/media-stream/:meetingId` | Twilio Media Streams |

### 4. Test Script
**File:** `tests/test-twilio-voice.ts`

Verification script that tests:
1. TwilioVoiceService initialization
2. TwiML generation
3. μ-law codec availability
4. Active call tracking

## Files Modified

### 1. Configuration
**File:** `src/config/index.ts`

Added environment variables:
```typescript
TWILIO_ACCOUNT_SID: optionalString,
TWILIO_AUTH_TOKEN: optionalString,
TWILIO_PHONE_NUMBER: optionalString,
```

### 2. Dependency Injection
**File:** `src/lib/di-container.ts`

- Added `TwilioVoiceService` import
- Added `twilioVoiceService: TwilioVoiceService | null` to Services interface
- Creates service when Twilio credentials are configured
- Cleans up calls on shutdown

### 3. Routes Registration
**File:** `src/routes/index.ts`

- Imported Twilio routes
- Registers `/api/voice` routes (authenticated)
- Registers `/webhooks/twilio` routes (webhook verification)

## Environment Variables

Add to `mvp/.env`:
```bash
# Twilio Voice (for dial-in voice bot)
TWILIO_ACCOUNT_SID=ACxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx

# Required for Twilio webhooks (ngrok URL or production domain)
WEBHOOK_BASE_URL=https://your-ngrok-or-domain.com
```

## Setup Instructions

### 1. Twilio Account Setup
1. Create account at https://www.twilio.com/try-twilio
2. Buy a phone number (~$1/month)
3. Note your Account SID and Auth Token

### 2. Local Development
```bash
# Start ngrok for public webhook URL
ngrok http 3000

# Update WEBHOOK_BASE_URL in .env with ngrok URL
# Example: https://abc123.ngrok.io
```

### 3. Run Tests
```bash
cd mvp
npx tsx tests/test-twilio-voice.ts
```

### 4. API Usage

**Dial into a meeting:**
```bash
curl -X POST http://localhost:3000/api/voice/dial-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -H "X-Tenant-ID: default" \
  -d '{
    "meetingId": "meeting-123",
    "dialInNumber": "+1234567890",
    "pin": "123456"
  }'
```

**End a call:**
```bash
curl -X POST http://localhost:3000/api/voice/hangup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -H "X-Tenant-ID: default" \
  -d '{"meetingId": "meeting-123"}'
```

**List active calls:**
```bash
curl http://localhost:3000/api/voice/calls \
  -H "Authorization: Bearer your-api-key" \
  -H "X-Tenant-ID: default"
```

## Meeting Dial-In Numbers

Each platform has different dial-in formats:

| Platform | Format | Example |
|----------|--------|---------|
| Google Meet | +1-xxx-xxx-xxxx + PIN | +1-234-567-8901, PIN: 123 456 789# |
| Zoom | +1-xxx-xxx-xxxx + Meeting ID + # | +1-301-715-8592, 123456789# |
| Teams | +1-xxx-xxx-xxxx + Conference ID + # | +1-xxx-xxx-xxxx, 12345# |

## Cost Estimate

| Item | Cost |
|------|------|
| Outbound calls (US) | ~$0.014/min |
| 30-minute meeting | ~$0.42 |
| 10 meetings/day | ~$4.20/day |

## Integration Flow

1. **Meeting Created** → Store dial-in number with meeting record
2. **Meeting Starts** → Call `TwilioVoiceService.dialIntoMeeting()`
3. **Twilio Connects** → WebSocket to `TwilioMediaHandler`
4. **Audio Flow** → Meeting audio → Gemini → Response audio → Meeting
5. **Transcript** → Configured `MeetingBotProvider` (e.g. Vexa BYO) sends transcript text to Gemini context
6. **Meeting Ends** → Call `TwilioVoiceService.hangup()` or auto-cleanup

## Error Handling

- **Call Failed**: Status callback updates call state, logs error
- **WebSocket Disconnected**: Handler cleanup, call remains (Twilio handles reconnect)
- **Gemini Error**: Logged via event emitter, audio stops but call continues
- **Missing Credentials**: Service returns null, routes return 503

## Future Enhancements

- [ ] Twilio signature verification on webhooks
- [ ] Call recording for audit trail
- [ ] DTMF support for meeting PIN entry automation
- [ ] Multiple concurrent calls per meeting (failover)
- [ ] Analytics and usage tracking
