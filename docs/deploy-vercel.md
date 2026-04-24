# Deploy on Vercel + Supabase + Upstash

The serverless path. Most moving parts, but it stitches together three generous free tiers — so if you want to run Workforce0 for $0/month while you evaluate it, this is the cheapest route.

## When to pick this vs Railway / Render / Fly

Pick this if you already live inside Vercel, want the fastest possible frontend (global CDN + edge caching), and are comfortable wiring three services together. For everyone else, [Railway](./one-click-deploy.md#railway-easiest-free-tier) or [Render](./one-click-deploy.md#render-free-tier) is simpler — one platform, one dashboard, one click.

Workforce0's backend is a long-lived Fastify server (WebSockets for voice, background jobs, Prisma connection pools). Vercel's serverless functions are not a great fit for that runtime, so this guide uses a **hybrid setup**:

- **Frontend (Next.js)** → Vercel
- **Backend (Fastify)** → Railway (or any always-on host)
- **Postgres** → Supabase
- **Redis** → Upstash

> Porting the backend to Next.js API routes is technically possible, but it's a multi-day refactor and you'll lose the voice features that depend on persistent WebSocket connections. Out of scope for this guide.

## Prerequisites

Free accounts — no credit card needed on any of them for the starter tiers:

- [Vercel](https://vercel.com/signup) — frontend hosting
- [Supabase](https://supabase.com/dashboard/sign-up) — managed Postgres
- [Upstash](https://console.upstash.com/login) — managed Redis
- [Railway](https://railway.app/login) — backend hosting (for the Fastify server)
- [GitHub account](https://github.com/join) — to fork this repo
- A [Gemini API key](https://aistudio.google.com/app/apikey) — free

Fork [workforce0](https://github.com/workforce0/workforce0) to your own GitHub account before you start. Vercel and Railway both deploy from your fork.

---

## Step 1 — Backend on Railway

We need the Fastify backend live first, because the frontend needs its URL.

Follow the [Railway section of the one-click deploy guide](./one-click-deploy.md#railway-easiest-free-tier), but **stop before setting `DATABASE_URL` and `REDIS_URL`** — we're going to point those at Supabase and Upstash in Step 5.

Once Railway finishes deploying, copy the generated URL (something like `workforce0-production.up.railway.app`). Keep it in a scratch note — you'll paste it in Step 4.

## Step 2 — Supabase Postgres

1. Open the [Supabase dashboard](https://supabase.com/dashboard) and click **New project**.
2. Name it `workforce0`, pick a region close to your users, and set a database password (save this — Supabase won't show it again).
3. Wait ~2 minutes for provisioning.
4. Click **Project Settings → Database → Connection string** and choose the **URI** tab.
5. Copy the **Transaction pooler** connection string. It looks like:
   ```
   postgresql://postgres.xxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
6. Replace `[PASSWORD]` with the password you saved. This is your `DATABASE_URL`.

> Use the pooler string (port 6543), not the direct connection (port 5432). Prisma + Supabase works best with pgBouncer in front.

**Free tier:** 500 MB database, 2 GB bandwidth/month, 50k monthly active users. Plenty for a team of 10–20 running Workforce0.

## Step 3 — Upstash Redis

1. Open the [Upstash console](https://console.upstash.com/) and click **Create Database**.
2. Pick the **Global** type (multi-region, low latency) and choose a primary region close to your Railway backend.
3. Name it `workforce0-redis` and click **Create**.
4. On the database page, scroll to **REST API** and toggle to the **Redis** tab.
5. Copy the **Endpoint URL** — it looks like:
   ```
   rediss://default:xxx@apn1-witty-fox-12345.upstash.io:6379
   ```
6. That's your `REDIS_URL`.

**Free tier:** 10,000 commands/day, 256 MB storage. Workforce0 uses Redis for session cache and rate limiting — 10k commands/day covers a team of ~5 comfortably.

## Step 4 — Frontend on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and click **Import Git Repository**.
2. Select your forked `workforce0` repo.
3. On the configure screen:
   - **Framework preset:** Next.js (auto-detected)
   - **Root directory:** `frontend`
   - **Build command:** leave default (`next build`)
4. Expand **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `BACKEND_URL` | your Railway URL from Step 1 (e.g. `https://workforce0-production.up.railway.app`) |
   | `NEXT_PUBLIC_API_URL` | same Railway URL |

5. Click **Deploy**. First build takes ~2 minutes.

Once it's done, Vercel gives you a URL like `workforce0-yourname.vercel.app`. Don't open it yet — the backend still needs its database and Redis.

## Step 5 — Point backend at Supabase and Upstash

Back in your Railway project:

1. Click the backend service → **Variables**.
2. Set (or update):
   - `DATABASE_URL` → the Supabase pooler URL from Step 2
   - `REDIS_URL` → the Upstash URL from Step 3
   - `FRONTEND_URL` → your Vercel URL from Step 4 (e.g. `https://workforce0-yourname.vercel.app`) — this matters for CORS
   - `GEMINI_API_KEY` → your Gemini key
3. Railway auto-redeploys on save. Wait for the green checkmark.

## Step 6 — Run database migrations

Prisma needs to create the tables in Supabase. Easiest way is locally, one time:

```bash
git clone https://github.com/YOUR-USERNAME/workforce0.git
cd workforce0/mvp
npm install
export DATABASE_URL="postgresql://postgres.xxx:[PASSWORD]@..."   # your Supabase URL
npx prisma migrate deploy
```

You should see `All migrations have been successfully applied`. Close your terminal — you won't need this again unless you upgrade Workforce0 and new migrations land.

> If you'd rather not run anything locally, add a one-shot Railway job: `npx prisma migrate deploy` as a deploy command. Railway's docs have a [step-by-step](https://docs.railway.app/guides/migrations).

## Step 7 — First run

1. Open your Vercel URL (`https://workforce0-yourname.vercel.app`).
2. Click **Sign up** and create your admin account.
3. Follow the in-app setup wizard — paste your Gemini key if you didn't set it on Railway, pick your integrations, invite teammates.
4. Open **Settings → Integrations** to connect Jira, Google Chat, etc.

From here, everything is the same as any other deploy. Onboard your team, upload a meeting, approve a brief, ship.

---

## Costs

Running lightly (personal use, ~10 briefs/day):

| Service | Free tier covers | You pay when |
|---|---|---|
| Vercel | 100 GB bandwidth, unlimited deploys | You outgrow the Hobby plan (~$20/mo Pro) |
| Supabase | 500 MB DB, 50k MAU | You pass 500 MB (~$25/mo Pro) |
| Upstash | 10k commands/day | You pass 10k/day (~$0.20/100k commands) |
| Railway | $5/mo credit | Your backend uses more than ~$5 of compute/month |

Typical total for a 5-person team running Workforce0 daily: **$5–15/month** (Railway overage only, everything else stays free). A 20-person team: **$30–60/month**.

## Troubleshooting

**"Application error" on Vercel** — almost always a missing env var. Check Vercel → your project → Settings → Environment Variables. `BACKEND_URL` and `NEXT_PUBLIC_API_URL` both need to be set, and both need to point at the Railway URL (with `https://`).

**First request after idle is slow** — Vercel's frontend is always-warm, but your Railway backend may spin down on the free tier. Upgrade to a Hobby plan ($5/mo) for always-on, or accept the ~5-second cold start on the first request.

**CORS errors in the browser console** — Your backend needs `FRONTEND_URL` set to your exact Vercel URL (with `https://`, no trailing slash). Railway → Variables → `FRONTEND_URL`, then redeploy.

**"Prisma Client could not connect"** — You used the direct connection string instead of the pooler. Go back to Step 2 and copy the **Transaction pooler** string (port 6543).

**Auth redirects loop** — Your cookies aren't being set because the frontend and backend are on different domains. That's normal for this setup. Make sure `NEXT_PUBLIC_API_URL` is `https://` (not `http://`) — browsers refuse to set secure cookies over plain HTTP.

**Voice/dial-in not working** — The voice feature needs persistent WebSockets, which work fine on Railway but require Twilio webhooks to point at the Railway URL (not Vercel). See [`docs/voice.md`](./voice.md) for Twilio wiring.

## Custom domain

Both Vercel and Railway support custom domains on their free tiers. Point `app.yourcompany.com` at Vercel and `api.yourcompany.com` at Railway, then update `BACKEND_URL`, `NEXT_PUBLIC_API_URL`, and `FRONTEND_URL` accordingly. Full walkthrough in [`docs/self-hosting.md#custom-domain`](./self-hosting.md#custom-domain).

---

Still stuck? Open a [discussion](https://github.com/workforce0/workforce0/discussions) and we'll help you through it.
