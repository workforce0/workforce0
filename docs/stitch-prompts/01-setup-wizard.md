# Stitch prompt: First-run setup wizard

**Purpose:** First five minutes after install. Non-technical exec just logged in for the first time. Get them to "first brief" without touching a config file.

**User goal:** Feel confident this will work in under a minute per step.

---

## Paste this into Stitch

```
Design a 4-step first-run setup wizard for Workforce0 (OSS AI workforce
platform for non-technical product leaders). Full-screen, centered card
(max width 640px), off-white background.

Shared layout on every step:
- Top: horizontal progress indicator showing 4 dots, current step filled
  indigo (#4F46E5), others light gray.
- Below progress: step title (32px, bold), one-sentence subtitle (16px,
  muted).
- Main content area: the step's form.
- Footer: "Back" ghost button left, "Continue" primary indigo button right.
  First step shows "Skip setup" link instead of Back.

Step 1 — Welcome & workspace name
- Title: "Name your workspace"
- Subtitle: "This is what your team will see at the top of the app."
- Single text input, placeholder "Acme Product Team", auto-focus.
- Helper text below input: "You can change this later."

Step 2 — Connect your AI provider (BYOK)
- Title: "Bring your own AI key"
- Subtitle: "Workforce0 uses your keys directly — no markup, no middleman."
- Three provider cards in a row, each with logo, name, and a "Paste API key"
  button: Google Gemini (marked "Required • free tier"), Anthropic Claude
  (marked "Optional"), OpenAI (marked "Optional").
- Clicking a card expands it inline with a password-style input + a button
  labeled "Where do I find this?" that opens a tooltip with a screenshot
  placeholder and a link.
- Below cards: green "Connection tested" pill appears after save.

Step 3 — Pick your first integration
- Title: "Connect your first tool (optional)"
- Subtitle: "You can skip this and add integrations later from Settings."
- Grid of 6 integration cards: Jira, Slack, Google Chat, Google Drive,
  GitHub, Linear. Each card: logo, name, one-line description, "Connect"
  button.
- A seventh card: "Skip for now" — dashed border, muted.

Step 4 — You're ready
- Title: "You're all set, [name]"
- Subtitle: "Here's what you can do next."
- Three big action cards stacked vertically: "Paste your first meeting
  transcript" (primary, indigo), "Upload a recording", "Dial in from a
  phone" (shows phone number). Each card has an icon, a one-line
  explanation, and an arrow.
- Footer button changes to "Take me to the dashboard".

Tone everywhere: friendly, confident, not techy. Never say "API", "config",
or "credentials" — use "key", "token", or "connection".
```

---

## Expected outputs from Stitch

- 4 desktop frames, one per step
- Mobile-friendly variant for step 1 (others can reflow)
- Component export for the step-progress indicator

## Implementation notes (for later)

- Route: `frontend/src/app/(onboarding)/setup/page.tsx`
- State: persist to backend at each step, not all at the end — lets user close and resume
- Don't block on step 2 if user has no key — allow skip with a clear warning
- Confetti on step 4 is allowed
