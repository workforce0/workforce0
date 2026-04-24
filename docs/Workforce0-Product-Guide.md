# Workforce0 — Your AI Workforce

> Transform business meetings into deployed software and executed actions.
> AI agents handle the work — you approve the results.

---

## What is Workforce0?

Every day, your team sits through meetings, takes notes, writes briefs, assigns work, and follows up. It takes hours. Sometimes days. By the time a product requirement is written and handed to engineering, the meeting that sparked it is a distant memory.

Workforce0 changes that equation entirely. You have your meeting, share the transcript, and AI does the rest — generating structured briefs, writing user stories, creating action items, and even building the software. Think of it as hiring a consulting firm that works in seconds instead of weeks and never drops the ball on follow-through.

The result? Your team spends time making decisions, not doing paperwork. Meetings become the starting line for real work, not a bottleneck before it begins.

## How It Works

1. **Have your meeting** — Sprint planning, product review, Gemba walk, customer call, any meeting at all.
2. **Share the transcript** — Paste it directly, upload a file (.vtt, .srt, .txt), or connect Google Meet for automatic capture.
3. **AI generates a brief** — Requirements, user stories, action items — structured, organized, and ready for review.
4. **Review and approve** — AI flags what it is unsure about. You approve, edit, or send back for revision.
5. **AI builds it** — Your AI developer writes the code, creates tests, and opens a pull request.
6. **QA validates** — AI reviews the code against the original requirements automatically.
7. **You ship** — Merge the pull request and deploy. Done.

From a 30-minute meeting to a working pull request — same day.

## What You Get

### For Product Leaders
- Meeting to structured brief in **20 seconds** (not 4 hours)
- 90%+ first-pass approval rate on generated briefs
- AI flags gaps and asks the right questions before work begins
- Download briefs as documents or sync to Jira automatically

### For Engineering Leaders
- Pull requests generated directly from approved briefs
- Code follows your team's conventions (AI learns your patterns)
- Quality checks run automatically — no manual review bottleneck
- Works with any git provider (GitHub, GitLab, Bitbucket)

### For Operations & Manufacturing
- Gemba walk notes become structured improvement tickets instantly
- Safety incident reports generated from conversations
- Action items with owners, deadlines, and verification methods
- Jira integration for tracking progress across teams

## Getting Started

### Step 1: Deploy Workforce0
Click a [one-click deploy button](./one-click-deploy.md) (Railway, Render, Fly) and paste your Gemini API key. Or if you have an IT person, they run `docker compose up -d` from the repo. Either way — about 5 minutes.

### Step 2: Create Your Account
Open your new Workforce0 URL and click **Sign up**. First person on the workspace becomes the admin.

### Step 3: Paste Your First Transcript
Click **"Paste Transcript"** on the Meetings page. Paste any meeting notes, conversation, or call transcript.

### Step 4: Review Your Brief
AI generates a structured brief in roughly 20 seconds. Review it, approve it, or request changes — all from the browser.

### Step 5: Connect Your AI Agent (Optional)
For automatic code generation, your IT team installs the Workforce0 agent on a dedicated machine. One-time setup:

```
docker run -d workforce0/agent -e WF0_TOKEN=your_token
```

Your IT team handles this once — you never touch it again.

## Self-Hosted & Open Source

Workforce0 is free and open source under the MIT license. You run it on your own infrastructure, with your own AI keys.

- **No per-seat fees.** Your whole team for one flat infrastructure cost (typically $10–40/month for a small team).
- **No per-token markup.** You pay Google/Anthropic/OpenAI directly at their published rates — nothing extra to Workforce0.
- **No vendor lock-in.** Fork the repo. Extend it. Ship it. It's yours.

### Getting it running

Three options, easiest first:

1. **One-click deploy** — Click a Railway or Render button, paste your Gemini key, done in 5 minutes. No terminal. [See deploy options](./one-click-deploy.md).
2. **Docker Compose** — Your IT person runs `docker compose up -d` on any Linux box. [Quickstart](./quickstart.md).
3. **From source** — Clone, modify, run. For teams that want to customize.

## ROI Calculator

| Without Workforce0 | With Workforce0 |
|---------------------|-----------------|
| 4 hours to write a brief | 20 seconds |
| 2-5 days to code a feature | 30 minutes |
| $200-400 per brief (analyst time) | $0.008 per brief |
| 2 weeks from meeting to pull request | Same day |

**Typical monthly savings for a 10-person product team: $8,000-15,000**

## Security & Privacy

- Your data never leaves your infrastructure
- The AI agent runs on **your** machine, not ours
- Meeting transcripts are encrypted at rest
- SOC 2 compliance on the roadmap
- We never train on your data — ever

## FAQ

**Q: Do I need to be technical?**
No. The product is designed for executives and business leaders. Your dev team sets up the agent once — after that, everything works from the browser.

**Q: What AI models do you use?**
Google Gemini for meeting analysis (fast and cost-effective). Anthropic Claude for code generation (best-in-class quality). You bring your own subscriptions.

**Q: Can I use this without the code generation?**
Absolutely. Many teams use Workforce0 just for meeting-to-brief conversion. The code generation is entirely optional.

**Q: What about Zoom and Teams?**
Download your transcript from Zoom or Teams and upload it as a .vtt or .txt file. Native integrations are coming soon.

**Q: How long does setup take?**
You can be generating briefs within 5 minutes of signing up. The optional AI agent for code generation takes about 30 minutes for your IT team to install.

---

*Workforce0 — Stop doing the work. Start approving the results.*
