"use client";

/**
 * Workforce0 — public landing page (Aperture + openclaw-inspired).
 *
 * Centered hero, one punchy tagline, install command as the centerpiece.
 * Dark-first, indigo accent with multi-stop gradient glow. Sections below
 * the fold: audience split, how it works, feature grid, integrations row,
 * acknowledgements, final CTA.
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
  Star,
  Video,
  FileText,
  Briefcase,
  Globe,
} from "lucide-react";
import { isAuthenticated } from "@/lib/auth";

const GITHUB_REPO_URL = "https://github.com/workforce0/workforce0";

const DOCS_URL =
  process.env.NEXT_PUBLIC_DOCS_URL ??
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:4321"
    : "https://docs.workforce0.com");

const docUrl = (slug: string) => `${DOCS_URL}/${slug}`;

const DOCKER_ONE_LINER = `git clone ${GITHUB_REPO_URL} && cd workforce0 && docker compose up`;

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
    <div className="min-h-dvh bg-canvas text-ink relative overflow-hidden">
      {/* Ambient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
      >
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[radial-gradient(ellipse_at_center,_var(--color-accent-subtle)_0%,_transparent_60%)]" />
        <div className="absolute top-[20vh] right-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,_rgba(139,92,246,0.10)_0%,_transparent_70%)]" />
        <div className="absolute top-[60vh] left-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,_rgba(14,165,233,0.08)_0%,_transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,_transparent_70%,_var(--color-canvas)_100%)]" />
        {/* Grid texture */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <TopNav />

      <main id="main-content">
        <Hero onCopy={copyCommand} copied={copied} />
        <SocialProof />
        <HowItWorks />
        <AudienceSplit />
        <FeatureGrid />
        <IntegrationsRow />
        <WhyOpenSource />
        <Acknowledgements />
        <FinalCTA />
      </main>

      <Footer />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function TopNav() {
  return (
    <header className="sticky top-0 z-40 bg-canvas/70 backdrop-blur-xl border-b border-border">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md"
          aria-label="Workforce0 home"
        >
          <span className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-accent via-accent-active to-violet-500 grid place-items-center shadow-[0_0_24px_rgba(79,70,229,0.45)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          <span className="text-[14.5px] font-semibold tracking-tight">Workforce0</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-[13px] text-ink-secondary" aria-label="Primary">
          <NavLink href="#how-it-works">How it works</NavLink>
          <NavLink href="#features">Features</NavLink>
          <NavLink href="#install">Install</NavLink>
          <NavLink href={docUrl("")} external>Docs</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label="Star Workforce0 on GitHub"
          >
            <Github className="w-4 h-4" aria-hidden />
            GitHub
          </a>
          {HOSTED_MODE ? (
            <a
              href="#install"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-gradient-to-r from-accent to-accent-active text-white text-[13px] font-semibold hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 shadow-[0_0_16px_rgba(79,70,229,0.35)]"
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </a>
          ) : (
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-gradient-to-r from-accent to-accent-active text-white text-[13px] font-semibold hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 shadow-[0_0_16px_rgba(79,70,229,0.35)]"
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5" aria-hidden />
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
//  HERO
// ─────────────────────────────────────────────────────────────

function Hero({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  return (
    <section className="relative pt-20 pb-16 sm:pt-28 sm:pb-24">
      <div className="max-w-5xl mx-auto px-5 lg:px-8 text-center">
        {/* Release pill */}
        <a
          href={`${GITHUB_REPO_URL}/releases/tag/v0.1.0`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-7 px-3 rounded-full border border-border bg-surface/60 backdrop-blur text-[12px] font-medium text-ink-secondary hover:border-accent/40 hover:text-ink transition-all"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald shadow-[0_0_10px_rgba(16,185,129,0.6)]" aria-hidden />
          <span className="text-emerald font-semibold">v0.1.0</span>
          <span className="text-ink-tertiary">•</span>
          <span>Initial public release</span>
          <ArrowRight className="w-3.5 h-3.5 opacity-60" aria-hidden />
        </a>

        {/* Headline */}
        <h1 className="mt-7 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-[var(--tracking-display)] leading-[1.02]">
          The AI workforce that
          <br />
          runs on{" "}
          <span className="relative inline-block">
            <span className="bg-gradient-to-r from-accent via-violet-400 to-sky-400 bg-clip-text text-transparent">
              your infrastructure
            </span>
            <span
              aria-hidden
              className="absolute inset-x-0 -bottom-1 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-60"
            />
          </span>
          .
        </h1>

        {/* Subhead */}
        <p className="mt-6 text-[17px] sm:text-[19px] leading-[1.55] text-ink-secondary max-w-2xl mx-auto">
          Open-source, self-hosted, BYOK. Meetings become briefs, briefs become
          tickets, tickets become code your team reviews and ships. Your exec
          approves from Slack.
        </p>

        {/* Install command — the centerpiece */}
        <div className="mt-10 max-w-2xl mx-auto">
          <div className="group relative">
            {/* Glow */}
            <div
              aria-hidden
              className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-accent via-violet-500 to-sky-500 opacity-30 blur-lg group-hover:opacity-50 transition-opacity"
            />
            <figure className="relative rounded-xl bg-[#0a0a0c] border border-white/10 shadow-[var(--shadow-float)] overflow-hidden text-left">
              <figcaption className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose/70" aria-hidden />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber/70" aria-hidden />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald/70" aria-hidden />
                  <span className="ml-3 text-[11.5px] text-white/50 font-mono">install</span>
                </div>
                <button
                  type="button"
                  onClick={onCopy}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={copied ? "Command copied" : "Copy install command"}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" aria-hidden /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden /> Copy
                    </>
                  )}
                </button>
              </figcaption>
              <pre className="px-5 py-5 text-[13.5px] leading-[1.7] font-mono text-white/90 overflow-x-auto whitespace-pre" aria-label="Install command">
                <span className="text-white/40 select-none">$ </span>
                <span className="text-accent">git clone</span>{" "}
                <span className="text-white/80">{GITHUB_REPO_URL}</span>
                {"\n"}
                <span className="text-white/40 select-none">$ </span>
                <span className="text-accent">cd</span> workforce0{" "}
                <span className="text-white/60">&&</span>{" "}
                <span className="text-accent">docker compose</span> up
              </pre>
            </figure>
          </div>
        </div>

        {/* Secondary CTAs */}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-surface border border-border text-ink text-[14px] font-semibold hover:bg-surface-hover hover:border-border-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Github className="w-4 h-4" aria-hidden />
            Star on GitHub
          </a>
          <a
            href={docUrl("getting-started/quickstart/")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-transparent text-ink text-[14px] font-semibold hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Read the quickstart
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </a>
        </div>

        {/* Facts strip */}
        <dl className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12.5px] text-ink-tertiary">
          <FactItem label="License" value="MIT" />
          <FactDot />
          <FactItem label="Data" value="Self-hosted" />
          <FactDot />
          <FactItem label="AI" value="BYOK — any model" />
          <FactDot />
          <FactItem label="Telemetry" value="None" />
        </dl>
      </div>
    </section>
  );
}

function FactItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="text-ink font-semibold">{value}</span>
      </dd>
    </div>
  );
}

function FactDot() {
  return <span aria-hidden className="w-1 h-1 rounded-full bg-ink-tertiary/40" />;
}

// ─────────────────────────────────────────────────────────────
//  SOCIAL PROOF — quick inspiration + "works with" row
// ─────────────────────────────────────────────────────────────

function SocialProof() {
  const items = [
    "Inspired by Linear, Raycast, Vercel",
    "Project Graph concept: safishamsi/graphify",
    "Prompt-caching discipline: NousResearch",
  ];
  return (
    <section className="relative border-y border-border bg-surface-muted/60 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 py-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[12px] text-ink-tertiary">
        <span className="font-semibold uppercase tracking-[0.14em] text-[11px]">
          Standing on shoulders ↓
        </span>
        {items.map((i) => (
          <span key={i} className="whitespace-nowrap">
            {i}
          </span>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  HOW IT WORKS
// ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      icon: <Zap className="w-5 h-5" aria-hidden />,
      title: "Capture",
      body:
        "Upload a recording, paste a transcript, or dial in by phone. Whisper + domain-aware prompts turn audio into structured notes.",
    },
    {
      icon: <Sparkles className="w-5 h-5" aria-hidden />,
      title: "Decompose",
      body:
        "Chief-of-staff agent drafts a brief, asks clarifying questions, and breaks approved work into steps with roles and skills.",
    },
    {
      icon: <Users className="w-5 h-5" aria-hidden />,
      title: "Dispatch",
      body:
        "Specialist agents (BA, architect, dev, QA) pull tickets. Dev code-gen runs on your laptop via Claude Code / Cursor — source code doesn't route through our backend.",
    },
    {
      icon: <Check className="w-5 h-5" aria-hidden />,
      title: "Approve",
      body:
        "Summaries post to Slack / WhatsApp / Teams. Your exec approves with a reply. The web UI is for audit — not daily work.",
    },
  ];

  return (
    <section id="how-it-works" className="py-20 sm:py-28 relative">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="Meeting in. Shipped work out."
          body="Four steps. Each is observable, auditable, replayable. No black box."
        />

        <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4" role="list">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="group relative rounded-2xl bg-surface/80 backdrop-blur border border-border p-5 transition-all hover:border-border-strong hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
            >
              <div className="flex items-center justify-between">
                <span className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-accent-subtle to-transparent text-accent ring-1 ring-accent/20">
                  {s.icon}
                </span>
                <span
                  aria-hidden
                  className="font-mono text-[11px] font-semibold text-ink-tertiary"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[13px] text-ink-secondary leading-relaxed">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  AUDIENCE SPLIT
// ─────────────────────────────────────────────────────────────

function AudienceSplit() {
  return (
    <section className="relative py-20 sm:py-24 border-y border-border bg-surface-muted/40">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <SectionHeader
          eyebrow="Who it's for"
          title="Two audiences. One product."
          body="Workforce0 splits setup from day-to-day use. One of you installs it. The rest of your team never touches the web UI."
        />

        <div className="mt-12 grid md:grid-cols-2 gap-4">
          <AudienceCard
            tag="For operators"
            icon={<Terminal className="w-5 h-5" aria-hidden />}
            title="Install once, hand it off."
            body="You're comfortable with Docker, API keys, and env vars. You spin up the stack, paste BYOK keys, wire Jira / Slack / Google once. After that, the product runs itself."
            points={[
              "Docker Compose, Railway, Render, Fly, DigitalOcean — pick your path",
              "BYOK for Anthropic / OpenAI / Google, or local Ollama",
              "Logs where you already look. No mystery boxes.",
            ]}
          />
          <AudienceCard
            tag="For everyone else"
            icon={<MessageSquare className="w-5 h-5" aria-hidden />}
            title="Live in Slack, ship in Jira."
            body="Execs, PMs, operators. They get brief summaries in their comms channel, approve with a reply, and move on. The web UI is audit-only — they rarely open it."
            points={[
              "Slack / Google Chat / WhatsApp — choose the room they already live in",
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
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-accent-subtle to-transparent text-accent ring-1 ring-accent/20">
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
            <Check className="w-4 h-4 mt-0.5 text-accent flex-shrink-0" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
//  FEATURES
// ─────────────────────────────────────────────────────────────

function FeatureGrid() {
  const features = [
    {
      icon: <Cpu className="w-5 h-5" aria-hidden />,
      title: "Multi-model AI Council",
      body: "BA agent drafts briefs through multi-model consensus across Claude, GPT, and Gemini. The planner gracefully falls back across providers. One provider down? The system keeps moving.",
    },
    {
      icon: <KeyRound className="w-5 h-5" aria-hidden />,
      title: "BYOK, no markup",
      body: "Use the API keys you already pay for. No pay-per-token reselling, no hidden inference fees, no lock-in.",
    },
    {
      icon: <Slack className="w-5 h-5" aria-hidden />,
      title: "Comms-first workflow",
      body: "Slack, Google Chat, WhatsApp — two-way reply-to-approve. Teams is one-way notifications today. The exec never opens the app; approvals happen in the room they already work in.",
    },
    {
      icon: <Workflow className="w-5 h-5" aria-hidden />,
      title: "Integration wizards",
      body: "Visual setup for Jira, Google Chat, Drive, GitHub, Twilio. Get-your-API-key buttons that open the right vendor page.",
    },
    {
      icon: <Phone className="w-5 h-5" aria-hidden />,
      title: "Voice dial-in",
      body: "Gemini Live + Twilio Media Stream. Call a number, have a meeting, get a brief. Nothing to install on the attendees' side.",
    },
    {
      icon: <GitBranch className="w-5 h-5" aria-hidden />,
      title: "Project graph",
      body: "Full TS/JS AST plus a regex-based Python extractor (Go, Rust, Java on the way). God-nodes feed the planner so decompositions target the parts of the repo that matter.",
    },
    {
      icon: <ShieldCheck className="w-5 h-5" aria-hidden />,
      title: "Row-level isolation",
      body: "Prisma middleware enforces tenant and project scopes on every read. Audit UI shows the decision trail for every approval.",
    },
    {
      icon: <Code2 className="w-5 h-5" aria-hidden />,
      title: "Local code-gen",
      body: "The dev agent uses your Claude Code / Cursor subscription via a local daemon. Source code flows to the CLI you already trust — not through our backend.",
    },
    {
      icon: <Layers className="w-5 h-5" aria-hidden />,
      title: "Skills + subagents",
      body: "A vendored library of playbooks and specialists the chief-of-staff can pick from. Add your own without forking.",
    },
  ];

  return (
    <section id="features" className="relative py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <SectionHeader
          eyebrow="Features"
          title="Everything a product org runs on."
          body="Built from the ground up as self-hosted, provider-agnostic, audit-friendly. Each feature is optional — the parts you don't turn on don't run."
        />

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
    <article className="group relative rounded-2xl bg-surface/70 backdrop-blur-sm border border-border p-5 transition-all duration-[var(--dur)] ease-[var(--ease-smooth)] hover:border-accent/30 hover:bg-surface hover:shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-accent-subtle to-transparent text-accent ring-1 ring-accent/20 transition-transform group-hover:scale-[1.06]">
          {icon}
        </span>
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[13.5px] text-ink-secondary leading-relaxed">{body}</p>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
//  INTEGRATIONS ROW
// ─────────────────────────────────────────────────────────────

function IntegrationsRow() {
  const integrations = [
    { name: "Slack", icon: <Slack className="w-5 h-5" aria-hidden /> },
    { name: "Google Chat", icon: <MessageSquare className="w-5 h-5" aria-hidden /> },
    { name: "WhatsApp", icon: <Phone className="w-5 h-5" aria-hidden /> },
    { name: "Jira", icon: <Briefcase className="w-5 h-5" aria-hidden /> },
    { name: "GitHub", icon: <Github className="w-5 h-5" aria-hidden /> },
    { name: "Google Drive", icon: <FileText className="w-5 h-5" aria-hidden /> },
    { name: "Twilio voice", icon: <Video className="w-5 h-5" aria-hidden /> },
    { name: "Email reply", icon: <Users className="w-5 h-5" aria-hidden /> },
  ];
  return (
    <section className="relative py-16 sm:py-20 border-y border-border bg-surface-muted/40">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <SectionHeader
          eyebrow="Works with your stack"
          title="Plug into the tools your team already uses."
          body="Every integration is optional and disabled gracefully when keys aren't set. No 'sign up to see what's supported.'"
        />

        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {integrations.map((i) => (
            <div
              key={i.name}
              className="flex items-center justify-center gap-2.5 h-14 rounded-xl border border-border bg-surface/60 backdrop-blur-sm hover:border-border-strong transition-colors"
            >
              <span className="text-ink-secondary">{i.icon}</span>
              <span className="text-[13px] font-medium text-ink">{i.name}</span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-[12.5px] text-ink-tertiary">
          Plus local models via{" "}
          <code className="font-mono text-ink">Ollama</code>,{" "}
          <code className="font-mono text-ink">vLLM</code>,{" "}
          <code className="font-mono text-ink">LM Studio</code>, or any OpenAI-compatible endpoint.
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  WHY OPEN SOURCE
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
      body: "Vanilla Postgres, Redis, Node. Run it on Docker Compose, Fly, Railway, Render, DigitalOcean, or a Hetzner box. We don't own your runway.",
    },
  ];

  return (
    <section className="relative py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <SectionHeader
          eyebrow="Why open-source"
          title="Not a SaaS. Not a trial. Just the software."
          body="AI platforms that capture your meetings, your decisions, and your code pipeline are too important to rent. Workforce0 is MIT-licensed software you clone and run."
        />

        <div className="mt-12 grid sm:grid-cols-3 gap-4">
          {pillars.map((p) => (
            <article
              key={p.title}
              className="relative rounded-2xl bg-surface/80 backdrop-blur border border-border p-6 overflow-hidden"
            >
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
              />
              <h3 className="text-[16px] font-semibold">{p.title}</h3>
              <p className="mt-2 text-[13.5px] text-ink-secondary leading-relaxed">{p.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  ACKNOWLEDGEMENTS
// ─────────────────────────────────────────────────────────────

function Acknowledgements() {
  const credits = [
    {
      title: "Project Graph",
      body: "The god-nodes idea, EXTRACTED vs INFERRED edge confidence tags, and the graph-based planner enrichment come from",
      link: "https://github.com/safishamsi/graphify",
      label: "safishamsi/graphify",
    },
    {
      title: "Prompt-caching discipline",
      body: "The 'never mutate past messages' rule that keeps Anthropic's prompt cache warm comes from",
      link: "https://github.com/NousResearch/hermes-agent",
      label: "NousResearch/hermes-agent",
    },
    {
      title: "Design language",
      body: "Our 'Aperture' design system borrows heavily from the visual discipline of",
      link: "#",
      label: "Linear, Raycast, and Vercel",
    },
  ];
  return (
    <section className="relative py-20 sm:py-24 border-y border-border bg-surface-muted/40">
      <div className="max-w-6xl mx-auto px-5 lg:px-8">
        <SectionHeader
          eyebrow="Standing on shoulders"
          title="Where the good ideas came from."
          body="Workforce0 is a synthesis, not an original thought. Credit where it's due."
        />

        <div className="mt-12 grid sm:grid-cols-3 gap-4">
          {credits.map((c) => (
            <article
              key={c.title}
              className="rounded-2xl bg-surface border border-border p-6"
            >
              <h3 className="text-[14px] font-semibold text-ink">{c.title}</h3>
              <p className="mt-3 text-[13px] text-ink-secondary leading-relaxed">
                {c.body}{" "}
                {c.link.startsWith("http") ? (
                  <a
                    href={c.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {c.label}
                  </a>
                ) : (
                  <span className="text-ink">{c.label}</span>
                )}
                .
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  FINAL CTA
// ─────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section id="install" className="relative py-24 sm:py-32">
      <div className="max-w-4xl mx-auto px-5 lg:px-8">
        <div className="relative rounded-3xl bg-gradient-to-br from-[#0a0a0c] via-[#0e0e10] to-[#15151a] text-white p-10 sm:p-14 overflow-hidden shadow-[var(--shadow-float)]">
          {/* Glow blobs (kept subtle so CTAs stay readable) */}
          <div aria-hidden className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-accent/15 blur-3xl" />
          <div aria-hidden className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-violet-500/10 blur-3xl" />

          <div className="relative text-center">
            <div className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/10 border border-white/15 text-[11.5px] font-medium">
              <Star className="w-3.5 h-3.5 text-amber" aria-hidden />
              Open-source since 2026-04
            </div>
            <h2 className="mt-5 text-3xl sm:text-5xl font-bold tracking-[var(--tracking-display)] leading-[1.05]">
              Spin it up. See if it fits.
            </h2>
            <p className="mt-5 text-[15px] sm:text-[17px] text-white/70 max-w-xl mx-auto leading-relaxed">
              A fresh install on a laptop takes a couple of minutes. First
              brief approved in Slack: same afternoon.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white text-[#0a0a0c] text-[14.5px] font-semibold hover:bg-white/90 transition-colors"
              >
                <Github className="w-4 h-4" aria-hidden />
                Clone on GitHub
              </a>
              <a
                href={docUrl("getting-started/quickstart/")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white/10 border border-white/15 text-white text-[14.5px] font-semibold hover:bg-white/15 transition-colors"
              >
                Read the docs
                <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  FOOTER
// ─────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="relative border-t border-border bg-canvas">
      <div className="max-w-6xl mx-auto px-5 lg:px-8 py-10 flex flex-col sm:flex-row gap-6 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="relative w-6 h-6 rounded-md bg-gradient-to-br from-accent via-accent-active to-violet-500 grid place-items-center">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

// ─────────────────────────────────────────────────────────────
//  SHARED
// ─────────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-3xl mx-auto text-center">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-[var(--tracking-display)] leading-tight">
        {title}
      </h2>
      <p className="mt-4 text-[15.5px] text-ink-secondary leading-relaxed">{body}</p>
    </div>
  );
}

// Hidden but imported icon components that keep React happy when the
// variable is referenced from data but never used directly.
// (Globe kept for future lang-switcher.)
void Globe;
