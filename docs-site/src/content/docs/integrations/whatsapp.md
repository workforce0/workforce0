---
title: WhatsApp
description: Two-way approvals over WhatsApp Business via Twilio. The exec replies APPROVE <token> or REJECT <token> from the same WhatsApp thread the brief arrived in.
---

## What it does

The chief-of-staff agent sends approval requests, status digests, and
clarifying questions to a WhatsApp thread. Each approval message
includes a short, single-use **token**; the exec replies
`APPROVE <token>` (or `REJECT <token> [optional reason]`) and the
decision is recorded on the underlying brief — no app, no web UI, no
link to click.

See [Approvals](/usage/approvals/) for the same reply contract shared
across the other two-way channels.

## How it works

WhatsApp Business is delivered over [Twilio's Programmable Messaging
API](https://www.twilio.com/docs/whatsapp). Workforce0 reuses the
same Twilio account you configured for
[voice dial-in](/integrations/twilio/) — just on the messaging
product instead of voice.

- Outbound messages: the chief-of-staff agent sends through Twilio's
  WhatsApp sender.
- Inbound replies: Twilio posts to
  `https://your-workforce0/webhooks/twilio/whatsapp`. The handler
  parses an `APPROVE <token>` / `REJECT <token>` intent and applies
  the action to the matching open approval. Replies that don't match
  that pattern get a polite "Workforce0 didn't recognise that. Reply
  APPROVE &lt;token&gt; / REJECT &lt;token&gt;…" response.

## Setup

1. **Twilio side**
   - If you've already done [Twilio (voice)](/integrations/twilio/),
     you have an Account SID + Auth Token. Reuse those.
   - In the Twilio Console: **Messaging → Try it out → Send a
     WhatsApp message** to enable the WhatsApp sandbox, OR get a
     production [WhatsApp sender approved through Meta](https://www.twilio.com/docs/whatsapp/self-sign-up).
   - Under the WhatsApp sender's **Inbound** settings:
     - **When a message comes in** → Webhook →
       `https://your-workforce0/webhooks/twilio/whatsapp`.
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

| Trigger                       | WhatsApp message                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| New brief ready for approval  | Title + summary + an action token. *Reply: `APPROVE <token>` / `REJECT <token> [reason]`.*                       |
| Clarifying question           | Free-text question. The exec's plain-text reply lands on the brief via the conversation orchestrator.            |
| Daily digest                  | Bulleted summary of the day's activity (only if digest mode is on).                                              |
| Failure / escalation          | "[!] Couldn't proceed on X — needs your call." Includes the same token so the exec can `APPROVE` the retry.      |

Long content links to the web UI rather than dumping into WhatsApp;
WhatsApp messages are limited and the audit trail lives in the app.

## What's optional

- The **outbound** WhatsApp adapter is optional. If
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER`
  aren't all set, the channel adapter doesn't register at boot and
  the chief-of-staff agent simply skips WhatsApp delivery for any
  recipient that has it as a preferred channel.
- The **inbound** webhook (`POST /webhooks/twilio/whatsapp`) is
  registered unconditionally. Behaviour when Twilio hits it depends
  on signature + env:
  - In `production` with `TWILIO_AUTH_TOKEN` unset, the handler
    rejects with `500 signature_verification_not_configured` (the
    only sensible response — we cannot validate the request).
  - In `production` with the token set, requests must carry a valid
    `X-Twilio-Signature` (`401 missing_signature` /
    `401 invalid_signature` otherwise).
  - In non-production with the token unset, signature verification
    is skipped with a warning so local development against
    `localhost` works without a public URL.
  - In non-production with the token set, signature is still
    validated — same as production.
- Per-exec: an exec who hasn't added a WhatsApp number simply
  receives Slack / Email / Google Chat instead, depending on what
  they opted into.

## Troubleshooting

- **Messages aren't arriving.** First check that the recipient is
  opted-in to the Twilio sandbox (or to your approved sender). The
  Twilio dashboard's **Monitor → Logs → Messaging** shows whether
  the outbound attempt was rejected.
- **Replies aren't being recognised.** The parser expects either:
  - `APPROVE <12-hex-token>` (or `A <token>`), or
  - `REJECT <12-hex-token> [reason]` (or `R <token> [reason]`).
  Plain `approve` without a token, or any other free-text reply
  while the brief is awaiting a decision, gets a help message back.
  Free-text *is* accepted when the brief is awaiting a clarifying
  question — that path goes through the conversation orchestrator.
- **The webhook 401s with "missing_signature" or "invalid_signature".**
  Twilio signs inbound webhooks; in `production` the handler
  rejects anything without a valid `X-Twilio-Signature`. Verify the
  Auth Token configured in **Integrations → WhatsApp** matches the
  Twilio console exactly.
