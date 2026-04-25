---
title: WhatsApp
description: Two-way approvals over WhatsApp Business via Twilio. The exec replies "approve", "redirect", or "pause" — and that lands as the decision on the underlying brief.
---

## What it does

The chief-of-staff agent sends approval requests, status digests, and
clarifying questions to a WhatsApp thread. The exec replies with one
of the three keywords and the decision is recorded on the approval —
no app, no web UI, no link to click.

See [Approvals](/usage/approvals/) for the full reply-to-approve
contract that's shared across Slack / WhatsApp / Email / Google Chat.

## How it works

WhatsApp Business is delivered over [Twilio's Programmable Messaging
API](https://www.twilio.com/docs/whatsapp). Workforce0 reuses the
same Twilio account you already configured for [voice dial-in](/integrations/twilio/) —
just on the messaging product instead of voice.

- Outbound messages: `messaging.send()` against a Twilio WhatsApp
  sender.
- Inbound replies: Twilio posts to
  `https://your-workforce0/api/comms/whatsapp/inbound`. The same
  approval-resolution code path Slack uses then matches the reply
  against the open approval.

## Setup

1. **Twilio side**
   - If you've already done [Twilio (voice)](/integrations/twilio/),
     you have an Account SID + Auth Token. Reuse those.
   - In the Twilio Console: **Messaging → Try it out → Send a
     WhatsApp message** to enable the WhatsApp sandbox, OR get a
     production [WhatsApp sender approved through Meta](https://www.twilio.com/docs/whatsapp/self-sign-up).
   - Under the WhatsApp sender's **Inbound** settings:
     - **When a message comes in** → Webhook →
       `https://your-workforce0/api/comms/whatsapp/inbound`.
     - Method: `POST`.

2. **Workforce0 side**
   - **Integrations → WhatsApp → Connect** in the web UI.
   - Paste the Twilio **Account SID** and **Auth Token**.
   - Set the **WhatsApp From** number (the sandbox number or your
     approved sender, in `whatsapp:+14155551234` format).
   - **Test connection** sends a "hello from Workforce0" message to
     a number you specify; once that lands, you're done.

3. **Per-exec opt-in**
   - In **Settings → Comms**, the exec adds the WhatsApp number they
     want briefs delivered to. That number must be opted-in to the
     Twilio sandbox (or to your approved sender) before WhatsApp will
     deliver messages.

## What gets sent

| Trigger                       | WhatsApp message                                                            |
| ----------------------------- | --------------------------------------------------------------------------- |
| New brief ready for approval  | One-line summary + "Reply *approve* / *redirect* / *pause*."                 |
| Clarifying question           | Free-text question. The exec's plain-text reply lands on the brief.         |
| Daily digest                  | Bulleted summary of the day's activity (only if digest mode is on).         |
| Failure / escalation          | "[!] Couldn't proceed on X — needs your call."                              |

Long content links to the web UI rather than dumping into WhatsApp;
WhatsApp messages are limited and the audit trail lives in the app.

## What's optional

- WhatsApp itself is optional. If `TWILIO_ACCOUNT_SID` and
  `TWILIO_AUTH_TOKEN` are unset, the WhatsApp channel disables
  cleanly — outbound stays silent and the inbound webhook returns
  204 without doing anything.
- Per-exec: an exec who hasn't added a WhatsApp number simply
  receives Slack / Email / Google Chat instead, depending on what
  they did opt in to.

## Troubleshooting

- **Messages aren't arriving.** First check that the recipient is
  opted-in to the Twilio sandbox (or to your approved sender). The
  Twilio dashboard's **Monitor → Logs → Messaging** shows whether
  the outbound attempt was rejected.
- **Replies aren't being recognized.** The matcher is
  case-insensitive and trims whitespace, but expects one of
  `approve` / `redirect` / `pause` as a standalone reply. Free-text
  replies on a brief that's awaiting a clarifying question are
  fine; free-text replies on a brief that's awaiting an
  approval/redirect/pause decision are ignored.
- **The webhook 401s.** Twilio signs inbound webhooks; verify the
  Auth Token in **Integrations → WhatsApp** matches the Twilio
  console.
