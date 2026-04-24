# Remove Recall.ai — Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Motivation:** Reduce cost ($0.65/hr/meeting) and complexity for MVP launch.

## Overview

Hard-delete all Recall.ai code from Workforce0. Meetings continue to work via three existing alternative paths: Google Meet native (Drive webhooks), Twilio voice dial-in, and manual upload.

## What Gets Deleted

| Component | File | Lines | Reason |
|-----------|------|-------|--------|
| Recall API client | `services/meeting/recall.service.ts` | ~568 | Core Recall integration |
| Recall webhook handler | Section in `routes/webhooks.routes.ts` | ~200 | Dead without Recall |
| Recall audio bridge | `voice/audio-bridge.ts` | ~100 | Recall-specific audio format conversion |
| Recall config vars | `config/index.ts` | ~5 | `RECALL_API_KEY`, `RECALL_WEBHOOK_SECRET`, `RECALL_REGION` |
| Recall DI registration | `lib/di-container.ts` | ~15 | RecallService instantiation |
| Recall webhook verify | `lib/webhook-verify.ts` | ~20 | Recall-specific signature check |
| Recall settings UI | Frontend integration card | ~50 | Settings page Recall.ai section |
| Recall test endpoint | `routes/settings.routes.ts` | ~20 | API key validation endpoint |
| Doc references | CLAUDE.md, AGENTS.md, docs/ | various | Recall.ai mentions |

## What Gets Adjusted (Not Deleted)

| Component | File | Change |
|-----------|------|--------|
| MeetingService | `services/meeting/meeting.service.ts` | Remove Recall bot deployment path from `scheduleMeeting()`. Keep Google Meet + upload + Twilio paths. |
| VoiceSessionManager | `voice/session-manager.ts` | Remove Recall audio bridge dependency. Voice AI continues via Twilio Media Stream. |
| Meeting routes | `routes/meetings.routes.ts` | Remove Recall-specific scheduling logic. Keep general meeting CRUD. |
| Settings routes | `routes/settings.routes.ts` | Remove Recall integration test/config endpoints. |
| Frontend meetings page | `frontend/src/app/(dashboard)/meetings/page.tsx` | Remove "Bot Recording" recall source label. |
| Prisma schema | `prisma/schema.prisma` | Keep Meeting model as-is (source field stays generic). No migration needed. |

## What Stays Untouched

- Google Meet native integration (`google-oauth.service.ts`, Drive webhooks)
- Twilio voice dial-in (`twilio-voice.service.ts`)
- Manual upload path
- Meeting/Transcript Prisma models
- BA Agent pipeline (transcript → PRD)
- AI Council
- All other services

## Risk Assessment

- **Low risk:** Recall.ai already gracefully disables when env vars are missing. Removing the code just makes the disabled state permanent.
- **No data loss:** Existing meetings with `source: 'recall'` stay in DB. They just can't have new bots deployed.
- **No migration needed:** Prisma schema unchanged.

## Success Criteria

1. `npx tsc --noEmit` — zero errors
2. `npx vitest run` — no new test failures (remove Recall-specific tests)
3. `recall.service.ts` file deleted
4. No import references to Recall remain in codebase
5. Google Meet native + upload + Twilio still work
