/**
 * Workforce0 guided tour step definitions.
 *
 * Architecture
 * ────────────
 * Every page that participates in the tour gets:
 *   1. A list of `DriveStep`s built here (route → step list)
 *   2. `data-tour="..."` anchors on the elements those steps highlight
 *
 * `GuidedTour.tsx` reads the current pathname, fetches the matching step
 * list, drives it, then advances to the next route in `TOUR_ROUTE_ORDER`.
 *
 * This is Phase 1 — five pages curated for first-time setup of the four
 * capabilities a Workforce0 install enables: voice intake, meeting note-
 * taker, WhatsApp, dev+PR. The remaining dashboard pages get tour
 * coverage in follow-up PRs (issue #44 follow-up + sister tickets).
 *
 * Originally adapted from aether2.0's `lib/tour/tourSteps.ts`.
 */
import { DriveStep } from "driver.js";

// Names hoisted so the EXPLORE_BTN HTML below can reference the
// pause-event constant without duplicating the string literal.
export const TOUR_KEY = "wf0_tour_active";
export const TOUR_PAUSED_KEY = "wf0_tour_paused";
export const TOUR_SEEN_PREFIX = "wf0_tour_seen_";

export const TOUR_START_EVENT = "wf0-tour-start";
export const TOUR_PAUSE_EVENT = "wf0-tour-pause";

const EXPLORE_BTN =
  `<br/><button class="tour-explore-btn" onclick="window.dispatchEvent(new Event('${TOUR_PAUSE_EVENT}'))">Explore on your own</button>`;

function buildDashboardSteps(): DriveStep[] {
  return [
    {
      popover: {
        title: "Welcome to Workforce0",
        description:
          "We'll walk you through the four things a fresh install gives " +
          "your team: take voice calls, record meetings, send WhatsApp " +
          "approvals, and ship code — all powered by AI agents." +
          EXPLORE_BTN,
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="sidebar-nav"]',
      popover: {
        title: "Your control room",
        description:
          "Everything lives here. Engagements is the chief-of-staff " +
          "agent's task list, Meetings is your call history, and " +
          "Settings → Integrations is where this whole tour ends.",
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-tour="header-tour-button"]',
      popover: {
        title: "Restart this tour anytime",
        description:
          "If you want a refresher later, click the Tour button in the " +
          "top bar. The tour resumes from whichever page you're on.",
        side: "bottom",
        align: "end",
      },
    },
  ];
}

function buildIntegrationsSteps(): DriveStep[] {
  return [
    {
      element: '[data-tour="integrations-header"]',
      popover: {
        title: "Connect once, use everywhere",
        description:
          "All AI keys, Twilio creds, and SaaS tokens live here. Stored " +
          "encrypted per tenant; never logged. Hot-reloads — no backend " +
          "restart needed when you save.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="integration-card-twilio"]',
      popover: {
        title: "Twilio: voice + WhatsApp",
        description:
          "One Twilio account drives both inbound voice calls and " +
          "WhatsApp approvals. Click Connect, paste Account SID + Auth " +
          "Token + your number, and the wizard tests it against the " +
          "Twilio API live.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="integration-card-github"]',
      popover: {
        title: "GitHub: ship code",
        description:
          "Connect a fine-grained GitHub PAT scoped to the repos you " +
          "want the AI to push branches and open PRs against. The dev " +
          "agent uses this for end-to-end ticket → PR work.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="integration-card-slack"]',
      popover: {
        title: "Slack (or Google Chat) for daily comms",
        description:
          "The chief-of-staff agent posts briefs and approval requests " +
          "here. Replies feed back into the workflow — so your team " +
          "approves work without ever opening this dashboard.",
        side: "bottom",
        align: "start",
      },
    },
  ];
}

function buildMeetingsSteps(): DriveStep[] {
  return [
    {
      element: '[data-tour="meetings-header"]',
      popover: {
        title: "Meetings — calls + recordings in one place",
        description:
          "Every inbound voice call and uploaded recording lands here. " +
          "Auto-transcribed locally (whisper), summarised by your AI " +
          "council, action items extracted into tickets.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="meetings-upload"]',
      popover: {
        title: "Drop a recording",
        description:
          "Upload a Zoom/Meet/Teams recording (mp3, mp4, m4a) and " +
          "Workforce0 transcribes + summarises it. No bot has to join " +
          "the call.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="meetings-voice-dialin"]',
      popover: {
        title: "Have the AI join a live call",
        description:
          "Click here to dial the AI into an active Meet/Zoom " +
          "conference as a participant. Pick Silent Observer (just " +
          "transcribes) or Active Participant (answers questions when " +
          "addressed by name).",
        side: "bottom",
        align: "end",
      },
    },
  ];
}

function buildEngagementsSteps(): DriveStep[] {
  return [
    {
      element: '[data-tour="engagements-header"]',
      popover: {
        title: "Engagements — the agent's work tracker",
        description:
          "Every brief goes through phases: drafted → reviewed → " +
          "approved → in-progress → done. The chief-of-staff agent " +
          "manages this for you — you only step in to approve or " +
          "redirect.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="engagements-list"]',
      popover: {
        title: "All your active engagements",
        description:
          "Anything the AI is working on — a meeting brief, a feature " +
          "spec, a customer follow-up. Click one to see the agent's " +
          "reasoning trace and intermediate outputs.",
        side: "bottom",
        align: "start",
      },
    },
  ];
}

function buildPrdsSteps(): DriveStep[] {
  return [
    {
      element: '[data-tour="prds-header"]',
      popover: {
        title: "Briefs — auto-generated from meetings",
        description:
          "After every meeting (call, recording, dial-in), the BA " +
          "agent drafts a structured brief: problem, scope, success " +
          "criteria, acceptance tests. You approve it (or edit), and " +
          "the dev agent picks it up to write code + open a PR.",
        side: "bottom",
        align: "start",
      },
    },
    {
      element: '[data-tour="prds-create"]',
      popover: {
        title: "Approve once, ship many",
        description:
          "Briefs that need your attention surface here. One click to " +
          "approve, the dev agent creates Jira tickets and (if GitHub " +
          "is connected) raises the PR. You only step in when the AI " +
          "council can't agree.",
        side: "bottom",
        align: "end",
      },
    },
    {
      popover: {
        title: "You're set up",
        description:
          "Voice in, meetings transcribed, briefs auto-generated, " +
          "code shipped via PR, approvals over Slack/WhatsApp. Day-to-" +
          "day the exec lives in their phone — you live wherever you " +
          "want. Hit the Tour button anytime for a refresher.",
        side: "bottom",
        align: "center",
      },
    },
  ];
}

const STATIC_TOUR_STEPS: Record<string, DriveStep[]> = {
  "/dashboard": buildDashboardSteps(),
  "/settings/integrations": buildIntegrationsSteps(),
  "/meetings": buildMeetingsSteps(),
  "/engagements": buildEngagementsSteps(),
  "/prds": buildPrdsSteps(),
};

const BASE_TOUR_ROUTE_ORDER = [
  "/dashboard",
  "/settings/integrations",
  "/meetings",
  "/engagements",
  "/prds",
];

export function getTourRouteOrder(_isAdmin: boolean): string[] {
  // No admin-only tour pages in Phase 1. Argument kept so the call site
  // stays stable when admin-only steps land in Phase 2.
  return BASE_TOUR_ROUTE_ORDER;
}

export const TOUR_ROUTE_ORDER = BASE_TOUR_ROUTE_ORDER;

export const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/settings/integrations": "Integrations",
  "/meetings": "Meetings",
  "/engagements": "Engagements",
  "/prds": "PRDs",
};

export function normalizeTourPath(pathname: string): string {
  // Match nested routes like `/settings/integrations/...` against the
  // exact `/settings/integrations` step list. Order matters — longer
  // prefixes win.
  const knownPrefixes = ["/settings/integrations"];
  for (const prefix of knownPrefixes) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return prefix;
  }
  const parts = pathname.split("/").filter(Boolean);
  return "/" + (parts[0] || "");
}

export function getStepsForRoute(pathname: string): DriveStep[] | undefined {
  return STATIC_TOUR_STEPS[normalizeTourPath(pathname)];
}

export function hasStepsForRoute(pathname: string): boolean {
  const normalized = normalizeTourPath(pathname);
  return Array.isArray(STATIC_TOUR_STEPS[normalized]) &&
    STATIC_TOUR_STEPS[normalized].length > 0;
}
