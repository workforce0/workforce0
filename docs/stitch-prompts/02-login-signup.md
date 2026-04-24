# Stitch prompt: Login / Signup

**Purpose:** Clean, forgettable auth. Should feel like Linear/Vercel — not like a bank.

**User goal:** Get in without thinking.

---

## Paste this into Stitch

```
Design login and signup pages for Workforce0 (open-source AI workforce
platform for non-technical product leaders). Two frames.

Shared shell:
- Split layout: left panel (50%) = auth form on off-white (#FAFAF9).
  Right panel (50%) = testimonial or product shot on a deep indigo
  (#4F46E5) background with white text.
- Left panel: small Workforce0 wordmark top-left, auth form centered
  vertically (max width 360px).
- Right panel: one-line pull-quote from a fictional product leader, their
  name/title/company, a subtle product screenshot mockup below.

Frame 1 — Login
- Heading: "Welcome back"
- Subheading: "Sign in to your Workforce0 workspace."
- Email field, password field (with show/hide eye icon).
- "Forgot password?" link right-aligned above the sign-in button.
- Primary button: "Sign in" (indigo, full width).
- Divider "or"
- Secondary button: "Continue with GitHub" (black, GitHub mark).
- Footer: "No account? Create one" link to signup.

Frame 2 — Signup
- Heading: "Create your workspace"
- Subheading: "Self-hosted. Your data stays on your infrastructure."
- Full name field, email field, password field with strength meter
  (weak/okay/strong pill).
- Checkbox: "I agree to the terms and privacy policy" (both linked).
- Primary button: "Create workspace"
- Footer: "Already have an account? Sign in" link.

Right panel on BOTH frames:
- Quote: "We ship product decisions in a morning instead of a month."
  — Priya, VP Product, Kestrel.
- Below quote: muted screenshot of the approval queue (blurred, decorative).
- Bottom of right panel: three tiny logos of OSS projects the user will
  recognize (Cal.com, Plausible, n8n style — implying "we're one of these").

Error states: single red helper text line under the offending field, never
a full-width alert banner.
```

---

## Expected outputs

- 2 frames (login, signup)
- Error state variant (wrong password)
- Mobile stack (right panel becomes top banner, 20% height)

## Implementation notes

- Routes exist: `frontend/src/app/login/`, `frontend/src/app/signup/`
- Keep GitHub OAuth optional — it should degrade gracefully if `GITHUB_CLIENT_ID` not set
- First-ever user on a fresh install becomes admin automatically; no invite code needed
