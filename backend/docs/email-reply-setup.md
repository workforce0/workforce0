# Setting up email-reply approvals

Lets an approver hit **reply** on the email Workforce0 sent them and say `APPROVE abcdef012345` — the PRD flips to approved without anyone opening the web UI.

This guide covers three paths from easiest to most technical.

---

## Before you start

- You have Workforce0 running and the email channel working outbound (your approvers are already receiving emails when a brief needs review)
- You have admin access to your email provider or can set up a small routing service

---

## How it works

1. Workforce0 sends the approver an email like:
   ```
   Open to review: https://workforce0.yourcompany.com/approvals?prd=abc123
   Or reply:
     APPROVE f1a2b3c4d5e6
     REJECT f1a2b3c4d5e6 [optional reason]
   ```
2. The approver replies (from their phone, on a train, wherever).
3. Their reply lands at an inbound address you control.
4. Your email provider forwards the reply as **JSON** to Workforce0's `/webhooks/email/reply` endpoint.
5. Workforce0 parses the reply, matches the token, and updates the PRD.

The trick is step 4 — getting your email provider to POST a clean JSON payload. Here's how for each.

---

## Path A — Mailgun routes (recommended for OSS self-host)

**Cost:** Free for 1,000 inbound messages / day.

1. Sign up at [mailgun.com](https://www.mailgun.com), verify your domain.
2. In Mailgun dashboard → **Receiving** → **Create Route**.
3. Expression type: **Match Recipient**. Expression: `approvals@yourcompany.com` (or whatever address you want to use).
4. Actions — add both:
   - **Forward** → `https://workforce0.yourcompany.com/webhooks/email/reply`
   - **Stop** (so Mailgun doesn't try to relay it elsewhere)
5. Priority: 10.
6. Save the route.
7. In Workforce0's `.env`, set a shared secret:
   ```
   EMAIL_WEBHOOK_SECRET=$(openssl rand -base64 32)
   ```
   Restart Workforce0.
8. Back in Mailgun, edit the route again. Under **Advanced options** → **Custom Headers**, add:
   - Header: `X-Workforce0-Secret`
   - Value: _(paste the same string you put in `.env`)_
9. Set the outbound reply-to address on your Workforce0 email channel to the same `approvals@yourcompany.com`.

Mailgun will forward each inbound email as a JSON POST with `from`, `subject`, `body-plain` (which we read as `text`). You may need a simple transform — see below.

### Mailgun transform (if needed)

Mailgun's native variable names are `From`, `Subject`, `body-plain`. Workforce0's webhook expects `from`, `subject`, `text`. Two options:

- **Simplest:** use Mailgun's store-and-notify mode, then poll. Skip this, use Path B instead.
- **Transform via a 5-line worker:** deploy a Cloudflare Worker / Vercel edge function that accepts Mailgun's payload and reposts it as the Workforce0 shape. Example:
  ```js
  export default {
    async fetch(req) {
      const form = await req.formData();
      const body = {
        from: form.get('From'),
        subject: form.get('Subject'),
        text: form.get('body-plain'),
        messageId: form.get('Message-Id'),
      };
      await fetch('https://workforce0.yourcompany.com/webhooks/email/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workforce0-Secret': '<secret>',
        },
        body: JSON.stringify(body),
      });
      return new Response('ok');
    },
  };
  ```

---

## Path B — Zapier Email Parser (5-minute setup, no code)

**Cost:** Free tier covers ~100 approvals/month.

1. Visit [parser.zapier.com](https://parser.zapier.com), create a new mailbox. You get an address like `abc1234@robot.zapier.com`.
2. Send a sample APPROVE email to it — Zapier will ask you to highlight `from` and the body text to create templates.
3. Zapier → **Create Zap**:
   - Trigger: Email Parser → New Email
   - Action: Webhooks → POST
     - URL: `https://workforce0.yourcompany.com/webhooks/email/reply`
     - Headers: `X-Workforce0-Secret: <your-secret>`, `Content-Type: application/json`
     - Data (JSON mode): `{"from": "{{from}}", "subject": "{{subject}}", "text": "{{body}}"}`
4. Point approvers' reply-to at the Zapier parser address.

Easiest path if you don't run your own email infra.

---

## Path C — Postmark inbound (best for teams already on Postmark)

1. Postmark → **Servers** → your inbound server → **Settings** → **Webhook URL**: `https://workforce0.yourcompany.com/webhooks/email/reply`.
2. Postmark sends its native JSON which includes `From`, `Subject`, `TextBody`. Workforce0 wants `from`, `subject`, `text` — same Cloudflare-Worker transform as Path A.

---

## Verify it works

1. Trigger a brief that needs review (or call `POST /api/agents/prds/:id/notify-approvers` manually).
2. Wait for the approver's email to arrive.
3. Reply to it with `APPROVE <token>` on its own line.
4. Within 60 seconds: the approval status flips in Workforce0, the token is invalidated, and the audit log shows `prd.approve.email`.

## Troubleshooting

- **"401 invalid_signature"** — the `X-Workforce0-Secret` header doesn't match `EMAIL_WEBHOOK_SECRET`. Double-check both sides.
- **"503 not_configured"** — you didn't set `EMAIL_WEBHOOK_SECRET` in `.env`, or you didn't restart Workforce0 after setting it.
- **"200 ok, acted: false"** — the reply arrived but didn't contain `APPROVE <token>` or `REJECT <token>`. Often happens when the email client quoted the original message and the reply prefix confuses the regex. Tell the approver to put the command on its own line at the top of the reply.
- **Tokens are 12 hex chars** — case-insensitive. If regex matching fails, the token probably expired (7-day TTL) — re-trigger notify-approvers to mint a fresh one.

## Security

- Tokens are one-shot: consumed on first successful action.
- Tokens are short and random (48 bits of entropy) — guessing one is not feasible within the 7-day window.
- The shared secret (`EMAIL_WEBHOOK_SECRET`) is compared with timing-safe equality — no timing-attack leak.
- Workforce0 never initiates outbound mail from this endpoint, so a compromised secret can't spam.
- If you suspect the secret leaked: rotate `EMAIL_WEBHOOK_SECRET`, restart Workforce0, update your forwarding service's header.
