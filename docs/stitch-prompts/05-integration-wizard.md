# Stitch prompt: Integration wizard (Jira example)

**Purpose:** Non-technical exec connects Jira without editing any config. Step-by-step, with "Get my API key" buttons and inline screenshots.

**User goal:** "It just worked" — no thinking required.

**This is the single most important non-dev UX moment in the product.**

---

## Paste this into Stitch

```
Design a 3-step integration connection wizard for Workforce0. Example
integration: Jira. The user is a non-technical VP of Product — they
have never created an API token before.

Shell: modal overlay, centered card (600px wide), off-white background,
subtle dim behind.

Modal header:
- Left: Jira logo + "Connect Jira" title.
- Right: close X.
- Below title: 3-dot progress indicator.

Step 1 — Your Jira URL
- Heading: "What's your Jira address?"
- Subtitle: "The one you use in your browser."
- Single input, placeholder "yourcompany.atlassian.net", helper text
  below: "Paste everything between https:// and the first slash."
- "Continue" button primary indigo (disabled until input is non-empty).

Step 2 — Your API token (the scary step, made friendly)
- Heading: "Create a Jira API token"
- Subtitle: "This lets Workforce0 create tickets on your behalf. Takes 30 seconds."
- Numbered list (3 items), each with:
    1. A one-line instruction in plain English.
    2. A small screenshot thumbnail on the right (placeholder).
    3. For step 1 of the list: a big button "Open Jira token page"
       (opens Atlassian token page in a new tab).
- Below the numbered list: a labeled input "Paste your token here" with
  password-style hidden characters and a show/hide eye icon.
- Helper text: "Your token is stored encrypted and only used to create
  tickets. You can revoke it any time in Jira."
- "Back" ghost button, "Test connection" primary button.

Step 3 — Test and finish
- While testing: spinner + "Checking your Jira connection…"
- On success: big green checkmark, "Connected!" heading, body text
  "Workforce0 can now create tickets in your Jira. Pick a default project
  below or change it anytime in Settings."
- Dropdown: "Default project" (pre-populated from live Jira API call,
  showing project name + key).
- "Done" primary button.

Error states (critical — make these forgiving):
- Wrong URL: "Hmm, we can't reach that address. Double-check it's
  `yourcompany.atlassian.net` (no https://, no slashes)."
- Wrong token: "That token didn't work. Common fix: make sure you pasted
  the full token and your email is the one you use to log in to Jira."
- Always show a "Need help? Chat with us" link at the bottom of error
  messages.

Tone: never use "API", "credentials", or "authentication". Use "connect",
"token", "link up".

Screenshots inside the wizard should be real Atlassian UI mockups — show
exactly which button to click.
```

---

## Expected outputs

- Step 1, 2, 3 happy path
- Loading state (between 2 and 3)
- Success state
- Two error states (wrong URL, wrong token)
- Disconnect flow (single confirmation modal: "This will stop Workforce0 from creating Jira tickets. You can reconnect any time.")

## This is a template — reuse for every integration

The 3-step structure (URL/identifier → token → test) generalizes. Create matching prompts for Slack, Google Chat, GitHub, Linear, etc. by swapping the specifics.

## Implementation notes

- Route: overlay on `frontend/src/app/(dashboard)/settings/integrations/page.tsx`
- Service layer: `mvp/src/services/integrations/jira.service.ts` already has `testConnection()` — wire it up
- Tokens stored encrypted via `mvp/src/lib/encryption.ts` (use `JWT_SECRET` as the KEK)
- This wizard is the example every new integration follows — document the pattern in `CONTRIBUTING.md § Adding a new integration`
