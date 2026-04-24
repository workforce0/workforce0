# One-click deploy

For non-technical users — no terminal required. Click a button, answer a few prompts, and Workforce0 is live on the internet with its own URL.

Every platform below spins up Postgres + Redis + backend + frontend automatically. You only need to paste your Gemini API key.

## Railway (easiest, free tier)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/workforce0)

1. Click the button above.
2. Sign in with GitHub (free).
3. Railway asks for one value: your `GEMINI_API_KEY` — [get one here](https://aistudio.google.com/app/apikey).
4. Click **Deploy**. In about 3 minutes you get a URL like `workforce0-production.up.railway.app`.
5. Open the URL, create your admin account, and you're in.

**Cost:** Railway's free tier ($5/month credit) covers light usage. A real workload runs around $10–20/month.

## Render (free tier)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/workforce0/workforce0)

1. Click the button.
2. Sign in with GitHub.
3. Render reads `render.yaml` from the repo and sets up all four services.
4. Paste your `GEMINI_API_KEY` when asked.
5. Wait about 5 minutes for the first build.

**Cost:** Free tier sleeps after 15 min idle — fine for personal use. $7/month/service for always-on.

## Fly.io

```bash
brew install flyctl          # or https://fly.io/docs/hands-on/install-flyctl/
fly auth signup
fly launch --from https://github.com/workforce0/workforce0
```

Fly asks for your Gemini key during launch and provisions Postgres and Redis automatically.

**Cost:** Generous free allowances (3 shared-CPU VMs + 3 GB Postgres). Usually $0–10/month for a personal deploy.

## DigitalOcean Marketplace

1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps).
2. Click **Create App** → **GitHub** → select `workforce0/workforce0`.
3. DigitalOcean detects `.do/app.yaml` and configures all four services.
4. Set `GEMINI_API_KEY` as an app-level secret.
5. Click **Create resources**.

**Cost:** From $12/month (Basic tier). Free 60-day trial for new accounts.

## Vercel + Supabase + Upstash (serverless)

Most complex, but free for small loads. See [`docs/deploy-vercel.md`](./deploy-vercel.md) for step-by-step.

## After deploy

No matter which platform you picked:

1. Open the URL your platform gave you
2. Click **Sign up** and create your admin account
3. Follow the in-app setup wizard
4. Connect your first integration from **Settings → Integrations**

## Troubleshooting

**"Database connection failed"** — Your DB didn't finish provisioning. Wait 60 seconds and reload.

**"GEMINI_API_KEY invalid"** — Double-check the key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey). Make sure you enabled the Gemini API.

**The deploy button 404s** — This repo's templates are still being published. In the meantime, use the [quickstart](./quickstart.md) on your own machine.

## Custom domain

Each platform has its own steps. Full walkthrough in [`docs/self-hosting.md#custom-domain`](./self-hosting.md#custom-domain).
