"use client";

/**
 * Workforce0 — public landing page.
 *
 * Audience is the **technical operator** (the person who runs
 * `docker compose up`). The dashboard persona — non-technical execs
 * who live in Slack — never sees this page. See CLAUDE.md for the
 * load-bearing version of the split-audience contract.
 *
 * Design-system: "Aperture" — Linear × Raycast × Vercel. Minimal,
 * generous whitespace, one indigo accent, strong typography. Every
 * color, radius, shadow, and easing comes from globals.css tokens.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Github,
  Terminal,
  ShieldCheck,
  Cpu,
  MessageSquare,
  Phone,
  GitBranch,
  Workflow,
  KeyRound,
  Code2,
  Slack,
  Check,
  Copy,
  Zap,
  Layers,
  Users,
  Sparkles,
} from "lucide-react";
import { isAuthenticated } from "@/lib/auth";

const GITHUB_REPO_URL = "https://github.com/workforce0/workforce0";

// Landing-page doc links route to the Starlight docs site. Locally this
// runs on :4321; in production point at your deployed docs URL.
const DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ??
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4321"
    : "https://docs.workforce0.com");

const docUrl = (slug: string) => `${DOCS_URL}/${slug}`;

const DOCKER_ONE_LINER = `git clone ${GITHUB_REPO_URL}
cd workforce0 && docker compose up`;

// Hosted mode = static-exported public marketing build (Cloudflare Pages).
// Skip the auth-redirect and swap auth CTAs for "Install on GitHub" links.
const HOSTED_MODE = process.env.NEXT_PUBLIC_HOSTED_MODE === "1";

export default function Landing() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(HOSTED_MODE);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (HOSTED_MODE) return;
    if (isAuthenticated()) {
      router.replace("/dashboard");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(DOCKER_ONE_LINER);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop — clipboard errors are not worth surfacing */
    }
  }

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-canvas">
        <div className="w-8 h-8 rounded-full border-2 border-ink-faint border-t-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <TopNav />

      <main id="main-content">
        <Hero />
        <AudienceSplit />
        <HowItWorks />
        <FeatureGrid />
        <InstallCTA onCopy={copyCommand} copied={copied} />
        <WhyOpenSource />
        <FinalCTA />
      </main>

      <Footer />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Top nav
// ─────────────────────────────────────────────────────────────

function TopNav() {
  return (
    <header className="sticky top-0 z-40 bg-canvas/80 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas rounded-md"
          aria-label="Workforce0 home"
        >
          <span className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-active grid place-items-center shadow-[0_0_18px_rgba(79,70,229,0.35)]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          <span className="text-[14.5px] font-semibold tracking-tight">Workforce0</span>
        </Link>

        <nav
          className="hidden md:flex items-center gap-1 text-[13px] text-ink-secondary"
          aria-label="Primary"
        >
          <NavLink href="#features">Features</NavLink>
          <NavLink href="#how-it-works">How it works</NavLink>
          <NavLink href="#install">Install</NavLink>
          <NavLink href={docUrl("getting-started/quickstart/")} external>Docs</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label="Star Workforce0 on GitHub"
          >
            <Github className="w-4 h-4" aria-hidden="true" />
            GitHub
          </a>
          {HOSTED_MODE ? (
            <a
              href="#install"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-ink text-ink-inverse text-[13px] font-medium hover:bg-ink-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          ) : (
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-ink text-ink-inverse text-[13px] font-medium hover:bg-ink-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const className =
    "px-3 h-9 inline-flex items-center rounded-md hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
//  Hero
// ─────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* decorative glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[500px] bg-[radial-gradient(ellipse_at_center,_var(--color-accent-subtle)_0%,_transparent_60%)]"
      />

      <div className="relative max-w-6xl mx-auto px-5 lg:px-8 pt-20 pb-16 sm:pt-28 sm:pb-24">
        <div className="max-w-3xl animate-fade-in-up">
          <div className="inline-flex items-center gap-2 h-7 px-3 rounded-full border border-border bg-surface/60 backdrop-blur text-[12px] font-medium text-ink-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent-glow)]" aria-hidden="true" />
            Open-source · Self-hosted · BYOK
          </div>

          <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[var(--tracking-display)] leading-[1.05]">
            An AI workforce<br />
            that runs on <span className="text-accent">your</span> infrastructure.
          </h1>

          <p className="mt-5 text-[17px] sm:text-[18px] leading-[1.6] text-ink-secondary max-w-2xl">
            Workforce0 turns meetings into briefs, briefs into tickets, and tickets into shipped work — orchestrated by a multi-model AI council. Clone it, bring your own API keys, and run it where your data already lives.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="#install"
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-ink text-ink-inverse text-[14px] font-semibold hover:bg-ink-secondary transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas shadow-[var(--shadow-card)]"
            >
              <Terminal className="w-4 h-4" aria-hidden="true" />
              Install in 60 seconds
            </Link>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-surface border border-border text-ink text-[14px] font-semibold hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Github className="w-4 h-4" aria-hidden="true" />
              Star on GitHub
            </a>
          </div>

          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 text-[13px] text-ink-tertiary">
            <div>
              <dt className="sr-only">License</dt>
              <dd><span className="text-ink font-semibold">MIT</span> license</dd>
            </div>
            <div>
              <dt className="sr-only">Data</dt>
              <dd><span className="text-ink font-semibold">Self-hosted</span> — your data, your keys</dd>
            </div>
            <div>
              <dt className="sr-only">AI models</dt>
              <dd><span className="text-ink font-semibold">Any model</span> — Claude, GPT, Gemini, Ollama</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Audience split
// ─────────────────────────────────────────────────────────────

function AudienceSplit() {
  return (
    <section className="border-y border-border bg-surface-muted">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 py-16 sm:py-20">
        <div className="max-w-2xl mb-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Who it's for</p>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Two audiences. One product.
          </h2>
          <p className="mt-3 text-[15px] text-ink-secondary leading-relaxed">
            Workforce0 splits setup from day-to-day use. One of you installs it. The rest of your team never touches the web UI.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <AudienceCard
            tag="For operators"
            icon={<Terminal className="w-5 h-5" aria-hidden="true" />}
            title="Install once, hand it off."
            body="You&apos;re comfortable with Docker, API keys, and env vars. You spin up the stack, paste in the BYOK keys, wire Jira / Slack / Google once. After that the product runs itself."
            points={[
              "Docker Compose, Kubernetes, Railway, Fly — pick your path",
              "BYOK for Anthropic / OpenAI / Google, or local Ollama",
              "Logs where you already look. No mystery boxes.",
            ]}
          />
          <AudienceCard
            tag="For everyone else"
            icon={<MessageSquare className="w-5 h-5" aria-hidden="true" />}
            title="Live in Slack, ship in Jira."
            body="Execs, PMs, operators. They get brief summaries in their comms channel, approve with a reply, and move on. The web UI is audit-only — they rarely open it."
            points={[
              "Slack / Teams / WhatsApp — choose the room they already live in",
              "Approve or redirect with a reply, never a form",
              "Decisions are logged, nothing is lost in DMs",
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function AudienceCard({
  tag,
  icon,
  title,
  body,
  points,
}: {
  tag: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  points: string[];
}) {
  return (
    <article className="group relative rounded-2xl bg-surface border border-border p-6 sm:p-7 transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-accent-subtle text-accent">
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
          {tag}
        </span>
      </div>
      <h3 className="mt-4 text-[20px] sm:text-[22px] font-bold tracking-tight leading-snug">
        {title}
      </h3>
      <p className="mt-3 text-[14px] text-ink-secondary leading-relaxed">{body}</p>
      <ul className="mt-5 space-y-2.5" role="list">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-[13.5px] text-ink-secondary">
            <Check className="w-4 h-4 mt-0.5 text-accent flex-shrink-0" aria-hidden="true" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
//  How it works
// ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      icon: <Zap className="w-5 h-5" aria-hidden="true" />,
      title: "Capture",
      body: "Upload a meeting recording, dial in with voice, or paste a transcript. Whisper + domain-aware prompts turn audio into structured notes.",
    },
    {
      icon: <Sparkles className="w-5 h-5" aria-hidden="true" />,
      title: "Decompose",
      body: "The chief-of-staff agent drafts a brief, asks clarifying questions where needed, and breaks it into small steps — each with a role, skills, and acceptance criteria.",
    },
    {
      icon: <Users className="w-5 h-5" aria-hidden="true" />,
      title: "Dispatch",
      body: "Specialist agents (BA, architect, dev, QA) pull tickets from the queue. Your local agent daemon runs code-gen with your Claude Code / Cursor subscription — no keys leave your laptop.",
    },
    {
      icon: <Check className="w-5 h-5" aria-hidden="true" />,
      title: "Approve",
      body: "Summaries post to Slack / WhatsApp / Teams. Your team approves with a reply. The web UI is there if you want to audit — not if you want to work.",
    },
  ];

  return (
    <section id="how-it-works" className="py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <div className="max-w-2xl mb-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">How it works</p>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Meeting in. Shipped work out.
          </h2>
          <p className="mt-3 text-[15px] text-ink-secondary leading-relaxed">
            Four steps. Each is observable, auditable, and replay-able. No black box.
          </p>
        </div>

        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" role="list">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="relative rounded-xl bg-surface border border-border p-5 transition-all hover:border-border-strong"
            >
              <div className="flex items-center justify-between">
                <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent-subtle text-accent">
                  {s.icon}
                </span>
                <span
                  aria-hidden="true"
                  className="font-mono text-[11px] font-semibold text-ink-tertiary"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[13px] text-ink-secondary leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Feature grid
// ─────────────────────────────────────────────────────────────

function FeatureGrid() {
  const features = [
    {
      icon: <Cpu className="w-5 h-5" aria-hidden="true" />,
      title: "Multi-model AI Council",
      body: "Every planner call runs through consensus across Claude, GPT, and Gemini. One provider down? The council keeps planning.",
    },
    {
      icon: <KeyRound className="w-5 h-5" aria-hidden="true" />,
      title: "BYOK, no markup",
      body: "Use the API keys you already pay for. No pay-per-token reselling, no hidden inference fees, no vendor lock-in.",
    },
    {
      icon: <Slack className="w-5 h-5" aria-hidden="true" />,
      title: "Comms-first workflows",
      body: "Slack, WhatsApp, Teams, Google Chat. The exec never opens the app — approvals happen in the room they already work in.",
    },
    {
      icon: <Workflow className="w-5 h-5" aria-hidden="true" />,
      title: "Integration wizards",
      body: "Visual setup for Jira, Google Chat, Drive, GitHub, Twilio. Get-your-API-key buttons that open the right vendor page.",
    },
    {
      icon: <Phone className="w-5 h-5" aria-hidden="true" />,
      title: "Voice dial-in",
      body: "Gemini Live + Twilio Media Stream. Call a number, have a meeting, get a brief. No app to install on the attendees' side.",
    },
    {
      icon: <GitBranch className="w-5 h-5" aria-hidden="true" />,
      title: "Project graph",
      body: "Native AST extraction across TS, JS, and Python. God-nodes feed the planner so decompositions target the parts of the repo that actually matter.",
    },
    {
      icon: <ShieldCheck className="w-5 h-5" aria-hidden="true" />,
      title: "Row-level isolation",
      body: "Prisma middleware enforces tenant and project scopes on every read. Audit UI shows the decision trail for every approval.",
    },
    {
      icon: <Code2 className="w-5 h-5" aria-hidden="true" />,
      title: "Local code-gen",
      body: "The dev agent uses your Claude Code / Cursor subscription via a local daemon. Production code never leaves your machine.",
    },
    {
      icon: <Layers className="w-5 h-5" aria-hidden="true" />,
      title: "Skills + subagents",
      body: "A vendored library of playbooks and specialists the chief-of-staff can pick from. Add your own without forking.",
    },
  ];

  return (
    <section id="features" className="border-y border-border bg-surface-muted">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 py-20 sm:py-24">
        <div className="max-w-2xl mb-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Features</p>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Everything that makes a product org run.
          </h2>
          <p className="mt-3 text-[15px] text-ink-secondary leading-relaxed">
            Built from the ground up as a self-hosted, provider-agnostic, audit-friendly system. Each feature is optional — the parts you don&apos;t turn on don&apos;t run.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="group rounded-xl bg-surface border border-border p-5 transition-all duration-[var(--dur)] ease-[var(--ease-smooth)] hover:border-border-strong hover:shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent-subtle text-accent transition-transform group-hover:scale-[1.05]">
          {icon}
        </span>
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[13.5px] text-ink-secondary leading-relaxed">{body}</p>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
//  Install CTA
// ─────────────────────────────────────────────────────────────

function InstallCTA({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  return (
    <section id="install" className="py-20 sm:py-24">
      <div className="max-w-4xl mx-auto px-5 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Install</p>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Two commands. One cup of coffee.
          </h2>
          <p className="mt-3 text-[15px] text-ink-secondary leading-relaxed">
            Clone the repo, bring up the stack, open the setup wizard in your browser. Full guide is in the <a href={docUrl("getting-started/quickstart/")} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-2 hover:underline">quickstart</a>.
          </p>
        </div>

        <figure className="rounded-2xl bg-ink shadow-[var(--shadow-float)] overflow-hidden">
          <figcaption className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose/70" aria-hidden="true" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber/70" aria-hidden="true" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald/70" aria-hidden="true" />
              <span className="ml-3 text-[11.5px] text-white/50 font-mono">terminal</span>
            </div>
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              aria-label={copied ? "Command copied" : "Copy install command"}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  Copy
                </>
              )}
            </button>
          </figcaption>
          <pre className="px-5 py-5 text-[13.5px] leading-[1.7] font-mono text-white/90 overflow-x-auto" aria-label="Install command">
            <span className="text-white/40 select-none">$ </span>
            <span className="text-accent">git clone</span> https://github.com/workforce0/workforce0
            {"\n"}
            <span className="text-white/40 select-none">$ </span>
            <span className="text-accent">cd</span> workforce0 && <span className="text-accent">docker compose</span> up
          </pre>
        </figure>

        <p className="mt-4 text-center text-[12.5px] text-ink-tertiary">
          Then open <span className="font-mono text-ink">http://localhost:3000</span> — the setup wizard takes it from there.
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Why OSS
// ─────────────────────────────────────────────────────────────

function WhyOpenSource() {
  const pillars = [
    {
      title: "Your data stays yours.",
      body: "Transcripts, briefs, approvals, comms history — all live in your Postgres. We never see any of it because we don't run anything.",
    },
    {
      title: "Your spend stays yours.",
      body: "BYOK means you pay OpenAI / Anthropic / Google directly at their actual rates. No resold tokens, no monthly SaaS tier.",
    },
    {
      title: "Your stack stays yours.",
      body: "Vanilla Postgres, Redis, Node. Run it on k8s, Fly, Railway, a Hetzner box, or your laptop. We don't own your runway.",
    },
  ];

  return (
    <section className="border-t border-border bg-surface-muted py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <div className="max-w-2xl mb-12">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">Why open-source</p>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Not a SaaS. Not a trial. Just the software.
          </h2>
          <p className="mt-3 text-[15px] text-ink-secondary leading-relaxed">
            AI platforms that capture your meetings, your decisions, and your code pipeline are too important to rent. Workforce0 is MIT-licensed software you clone and run.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {pillars.map((p) => (
            <article
              key={p.title}
              className="rounded-xl bg-surface border border-border p-6"
            >
              <h3 className="text-[15px] font-semibold">{p.title}</h3>
              <p className="mt-2 text-[13.5px] text-ink-secondary leading-relaxed">{p.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Final CTA
// ─────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-5 lg:px-8">
        <div className="relative rounded-3xl bg-ink text-ink-inverse p-10 sm:p-14 overflow-hidden shadow-[var(--shadow-float)]">
          <div
            aria-hidden="true"
            className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-accent/30 blur-3xl"
          />
          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.1]">
              Spin it up. See if it fits.
            </h2>
            <p className="mt-4 text-[15px] sm:text-[16px] text-white/70 max-w-xl leading-relaxed">
              A fresh install on a laptop takes about a minute. First brief approved in Slack: about a day.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-ink text-[14px] font-semibold hover:bg-white/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                <Github className="w-4 h-4" aria-hidden="true" />
                Clone on GitHub
              </a>
              <a
                href={docUrl("getting-started/quickstart/")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white/10 border border-white/15 text-white text-[14px] font-semibold hover:bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                Read the docs
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Footer
// ─────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-border bg-canvas">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 py-10 flex flex-col sm:flex-row gap-6 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="relative w-6 h-6 rounded-md bg-gradient-to-br from-accent to-accent-active grid place-items-center">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          <span className="text-[13px] text-ink-secondary">
            Workforce0 · <span className="text-ink-tertiary">MIT</span>
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]" aria-label="Footer">
          <a href={docUrl("getting-started/quickstart/")} target="_blank" rel="noopener noreferrer" className="text-ink-secondary hover:text-ink transition-colors">Docs</a>
          <a href={docUrl("self-hosting/docker-compose/")} target="_blank" rel="noopener noreferrer" className="text-ink-secondary hover:text-ink transition-colors">Self-hosting</a>
          <a href={docUrl("byok/overview/")} target="_blank" rel="noopener noreferrer" className="text-ink-secondary hover:text-ink transition-colors">BYOK</a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="text-ink-secondary hover:text-ink transition-colors">
            GitHub
          </a>
          {!HOSTED_MODE && (
            <Link href="/login" className="text-ink-secondary hover:text-ink transition-colors">Sign in</Link>
          )}
        </nav>
      </div>
    </footer>
  );
}
