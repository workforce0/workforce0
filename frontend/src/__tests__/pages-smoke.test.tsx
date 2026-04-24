/**
 * Smoke tests for all dashboard pages.
 * Verifies each page renders without crashing and shows key UI elements.
 *
 * Uses static imports — vi.mock() hoisting guarantees mocks are active
 * before any module code runs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockApi,
  mockGetUser,
  mockUseParams,
  mockUsePathname,
  mockUseRouter,
  mockUseSearchParams,
} = vi.hoisted(() => ({
  mockApi: {
    getDashboardStats: vi.fn(),
    getMeetings: vi.fn(),
    getMeeting: vi.fn(),
    getTranscript: vi.fn(),
    getPrds: vi.fn(),
    getPrd: vi.fn(),
    getTasks: vi.fn(),
    getEngagements: vi.fn(),
    getSettings: vi.fn(),
    getTeam: vi.fn(),
    getNotifications: vi.fn(),
    getActivity: vi.fn(),
    getModelConfig: vi.fn(),
    getAvailableModels: vi.fn(),
    scheduleMeeting: vi.fn(),
    generateBrief: vi.fn(),
    approvePrd: vi.fn(),
    rejectPrd: vi.fn(),
    createTickets: vi.fn(),
    updateIntegrations: vi.fn(),
    updateNotifications: vi.fn(),
    updateAccount: vi.fn(),
    updateSpendingCap: vi.fn(),
    testIntegration: vi.fn(),
    addTeamMember: vi.fn(),
    removeTeamMember: vi.fn(),
    updateTeamMember: vi.fn(),
    pauseEngagement: vi.fn(),
    resumeEngagement: vi.fn(),
    advanceEngagement: vi.fn(),
    updateModelConfig: vi.fn(),
    dismissNotification: vi.fn(),
    getDashboardROI: vi.fn(),
    getUsage: vi.fn(),
    ssoAuthorize: vi.fn(),
    ssoCallback: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    getMe: vi.fn(),
    getAuditLog: vi.fn(),
    getAnalytics: vi.fn(),
    getMeetingAnalytics: vi.fn(),
    getPrdCouncil: vi.fn(),
    getWebhooks: vi.fn(),
    createWebhook: vi.fn(),
    updateWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    testWebhook: vi.fn(),
    getWebhookEvents: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
  mockGetUser: vi.fn(),
  mockUseParams: vi.fn(() => ({ id: "test-123" })),
  mockUsePathname: vi.fn(() => "/dashboard"),
  mockUseRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  })),
  mockUseSearchParams: vi.fn(() => new URLSearchParams()),
}));

// ─── Module mocks ───────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useParams: mockUseParams,
  usePathname: mockUsePathname,
  useRouter: mockUseRouter,
  useSearchParams: mockUseSearchParams,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/lib/api", () => ({
  api: mockApi,
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

vi.mock("@/lib/auth", () => ({
  getUser: mockGetUser,
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  isAuthenticated: vi.fn(() => true),
  isOnboardingComplete: vi.fn(() => true),
  isChecklistDismissed: vi.fn(() => true),
  setOnboardingComplete: vi.fn(),
  setChecklistDismissed: vi.fn(),
  getToken: vi.fn(() => "mock-token"),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── lucide-react mock ──────────────────────────────────────────────────────
// IMPORTANT: Do NOT use a Proxy here. Proxy-based mocks hang Vitest's module
// analysis because Vitest inspects __esModule, Symbol.toStringTag, and `then`
// (thenable detection). A Proxy intercepts these and breaks resolution.
// Instead, use an explicit factory for all icon names used across pages.
vi.mock("lucide-react", () => {
  const iconFactory = (name: string) => {
    const Icon = (props: Record<string, unknown>) =>
      React.createElement("span", { "data-testid": `icon-${name}`, ...props });
    Icon.displayName = name;
    return Icon;
  };

  // All icons imported across pages + components
  const iconNames = [
    "Activity", "AlertCircle", "AlertTriangle", "ArrowLeft", "ArrowRight",
    "Bell", "Bot", "Brain", "Calendar", "Check", "CheckCircle", "CheckCircle2",
    "ChevronRight", "Clock", "Code2", "CreditCard", "Crown", "DollarSign",
    "ExternalLink", "FileText", "Github", "GraduationCap", "Hammer", "HandHelping",
    "Hash", "Headphones", "HelpCircle", "Inbox", "LayoutDashboard", "ListChecks",
    "ListTodo", "Loader2", "LogOut", "Mail", "MessageCircleQuestion",
    "MessageSquare", "Minus", "Pause", "Pencil", "Phone", "Play", "Plug",
    "Plus", "RefreshCw", "Rocket", "Search", "Settings", "Shield", "ShieldAlert",
    "ScrollText", "Sparkles", "Target", "ThumbsDown", "ThumbsUp",
    "Ticket", "Timer", "Trash2", "TrendingUp",
    "UserPlus", "Users", "Video", "Wrench", "X", "XCircle",
  ];

  const mocks: Record<string, unknown> = {};
  for (const name of iconNames) {
    mocks[name] = iconFactory(name);
  }
  // Re-export type helper (used by stat-card)
  mocks["type"] = undefined;
  return mocks;
});

// ─── UI component mocks ─────────────────────────────────────────────────────
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("span", { "data-testid": "badge", ...props }, children),
  badgeVariants: vi.fn(),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("div", { "data-testid": "tabs", ...props }, children),
  TabsList: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tabs-list" }, children),
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement("button", { "data-testid": `tab-${value}` }, children),
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement("div", { "data-testid": `tab-content-${value}` }, children),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("div", { "data-testid": "card", ...props }, children),
  CardContent: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("div", props, children),
  CardHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  CardTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h3", null, children),
  CardDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("p", null, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: {
    children: React.ReactNode;
    asChild?: boolean;
    [k: string]: unknown;
  }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, props as any);
    }
    return React.createElement("button", props, children);
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("input", props),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => React.createElement("hr"),
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value }: { value: number }) =>
    React.createElement("div", { role: "progressbar", "aria-valuenow": value }),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement("label", props, children),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "select" }, children),
  SelectTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("button", { "data-testid": "select-trigger" }, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder || ""),
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement("option", { value }, children),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "dialog" }, children),
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    React.createElement("p", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  DialogTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

// ─── App component mocks ────────────────────────────────────────────────────
vi.mock("@/components/header", () => ({
  Header: ({ title }: { title?: string }) =>
    React.createElement("header", { "data-testid": "header" }, title || ""),
}));

vi.mock("@/components/status-badge", () => ({
  StatusBadge: ({ status }: { status: string }) =>
    React.createElement("span", { "data-testid": "status-badge" }, status),
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: () => React.createElement("aside", { "data-testid": "sidebar" }, "Sidebar"),
}));

vi.mock("@/components/onboarding-wizard", () => ({
  OnboardingWizard: ({ onComplete }: { onComplete: () => void }) =>
    React.createElement("div", { "data-testid": "onboarding-wizard" }, "Wizard"),
}));

vi.mock("@/components/stat-card", () => ({
  StatCard: ({ title, value }: { title: string; value: number; [k: string]: unknown }) =>
    React.createElement("div", { "data-testid": "stat-card" }, `${title}: ${value}`),
}));

vi.mock("@/components/getting-started", () => ({
  GettingStarted: () =>
    React.createElement("div", { "data-testid": "getting-started" }, "Getting Started"),
}));

vi.mock("@/components/roi-card", () => ({
  ROICard: ({ data }: { data: Record<string, unknown> }) =>
    React.createElement("div", { "data-testid": "roi-card" }, `Hours saved: ${data.hoursSavedThisWeek}`),
}));

// ─── Static page imports ────────────────────────────────────────────────────

import DashboardPage from "@/app/(dashboard)/dashboard/page";
import MeetingsPage from "@/app/(dashboard)/meetings/page";
import PrdsPage from "@/app/(dashboard)/prds/page";
import TasksPage from "@/app/(dashboard)/tasks/page";
import EngagementsPage from "@/app/(dashboard)/engagements/page";
import SettingsPage from "@/app/(dashboard)/settings/page";
import TeamPage from "@/app/(dashboard)/team/page";
import AnalyticsPage from "@/app/(dashboard)/analytics/page";
import PrdDetailPage from "@/app/(dashboard)/prds/[id]/page";
import LoginPage from "@/app/login/page";
import SignupPage from "@/app/signup/page";
import ForgotPasswordPage from "@/app/forgot-password/page";
import ResetPasswordPage from "@/app/reset-password/page";

// ─── Helper ─────────────────────────────────────────────────────────────────

function emptyApiResponse(data: unknown = []) {
  return Promise.resolve({ success: true, data, meta: {} });
}

// ─── Global setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Set default return values for ALL API calls to prevent unresolved promises
  Object.values(mockApi).forEach((fn) => {
    (fn as ReturnType<typeof vi.fn>).mockReturnValue(emptyApiResponse([]));
  });
  mockGetUser.mockReturnValue({
    email: "test@example.com",
    name: "Test User",
    organizationName: "Test Org",
    tenantId: "tenant-123",
  });
  // Provide a working localStorage for dashboard onboarding checks.
  // jsdom's localStorage may be broken after vi.restoreAllMocks() in setup.ts,
  // so we stub a minimal implementation on window.
  const store: Record<string, string> = {
    wf0_onboarding_complete: "true",
    wf0_checklist_dismissed: "true",
  };
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    },
    writable: true,
    configurable: true,
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Dashboard Page", () => {
  beforeEach(() => {
    mockApi.getDashboardStats.mockReturnValue(
      emptyApiResponse({
        overview: {
          meetings: { total: 5, completed: 3, active: 2 },
          prds: { total: 2, approved: 1, pending: 1 },
          tasks: { total: 10, active: 3, pendingClarifications: 1 },
          tickets: { total: 8 },
        },
        recent: { meetings: [], prds: [] },
      })
    );
  });

  it("renders without crashing", async () => {
    render(<DashboardPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });

  it("calls getDashboardStats on mount", async () => {
    render(<DashboardPage />);
    await waitFor(() => {
      expect(mockApi.getDashboardStats).toHaveBeenCalled();
    });
  });
});

describe("Meetings Page", () => {
  beforeEach(() => {
    mockApi.getMeetings.mockReturnValue(emptyApiResponse([]));
  });

  it("renders without crashing", () => {
    render(<MeetingsPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });

  it("shows empty state when no meetings", async () => {
    render(<MeetingsPage />);
    expect(await screen.findByText(/no meetings yet/i)).toBeInTheDocument();
  });
});

describe("PRDs Page", () => {
  beforeEach(() => {
    mockApi.getPrds.mockReturnValue(emptyApiResponse([]));
  });

  it("renders without crashing", () => {
    render(<PrdsPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });
});

describe("Tasks Page", () => {
  beforeEach(() => {
    mockApi.getTasks.mockReturnValue(emptyApiResponse([]));
  });

  it("renders without crashing", () => {
    render(<TasksPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });

  it("shows empty state with CTA to schedule meeting", async () => {
    render(<TasksPage />);
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.getByText(/schedule a meeting/i)).toBeInTheDocument();
  });
});

describe("Engagements Page", () => {
  beforeEach(() => {
    mockApi.getEngagements.mockReturnValue(emptyApiResponse([]));
  });

  it("renders without crashing", () => {
    render(<EngagementsPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });

  it("shows empty state with CTA", async () => {
    render(<EngagementsPage />);
    expect(
      await screen.findByText(/no engagements yet/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /schedule a meeting/i })).toBeInTheDocument();
  });
});

describe("Settings Page", () => {
  beforeEach(() => {
    mockApi.getSettings.mockReturnValue(
      emptyApiResponse({
        account: {
          name: "Test User",
          email: "test@example.com",
          organizationName: "Test Org",
        },
        integrations: {
          jiraBaseUrl: "",
          jiraEmail: "",
          jiraApiToken: "",
          jiraConnected: false,
          gchatWebhookUrl: "",
          gchatConnected: false,
          googleServiceAccountKey: "",
          googleDriveFolderId: "",
          googleDocsConnected: false,
        },
        spending: {
          currentSpend: 12.50,
          monthlyCap: 100,
          percentUsed: 12.5,
          remaining: 87.50,
        },
        notifications: {
          notifyOnMeetingEnd: true,
          notifyOnPrdGenerated: true,
          notifyOnApprovalNeeded: true,
          notifyOnTicketsCreated: true,
          notifyOnAgentErrors: true,
        },
      })
    );
  });

  it("renders without crashing", () => {
    render(<SettingsPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });

  it("shows Required and Optional integration sections", async () => {
    render(<SettingsPage />);
    expect(
      await screen.findByText(/required to get started/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/optional integrations/i)).toBeInTheDocument();
  });

  it("shows audit log tab for admin/owner users", async () => {
    mockGetUser.mockReturnValue({
      email: "admin@example.com",
      name: "Admin User",
      organizationName: "Test Org",
      tenantId: "tenant-123",
      role: "owner",
    });
    render(<SettingsPage />);
    expect(await screen.findByTestId("tab-audit")).toBeInTheDocument();
  });

  it("shows webhooks tab for admin users", async () => {
    mockGetUser.mockReturnValue({
      email: "admin@example.com",
      name: "Admin User",
      organizationName: "Test Org",
      tenantId: "tenant-123",
      role: "owner",
    });
    render(<SettingsPage />);
    expect(await screen.findByTestId("tab-webhooks")).toBeInTheDocument();
  });

  it("hides audit log tab for non-admin users", async () => {
    mockGetUser.mockReturnValue({
      email: "member@example.com",
      name: "Member User",
      organizationName: "Test Org",
      tenantId: "tenant-123",
      role: "member",
    });
    render(<SettingsPage />);
    await screen.findByTestId("tab-integrations");
    expect(screen.queryByTestId("tab-audit")).not.toBeInTheDocument();
  });
});

describe("Team Page", () => {
  beforeEach(() => {
    mockApi.getTeam.mockReturnValue(emptyApiResponse([]));
  });

  it("renders without crashing", () => {
    render(<TeamPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });
});

describe("Analytics Page", () => {
  beforeEach(() => {
    mockApi.getAnalytics.mockReturnValue(
      emptyApiResponse({
        costByAgent: [],
        totals: { costUSD: 0, inputTokens: 0, outputTokens: 0 },
        engagementsByPhase: [],
        meetingsByStatus: [],
        dailyCosts: [],
      })
    );
    mockApi.getDashboardROI.mockReturnValue(
      emptyApiResponse({
        hoursSavedThisWeek: 0,
        meetingsThisWeek: 0,
        prdsThisWeek: 0,
        approvalRate: 0,
        weekOverWeekChange: 0,
      })
    );
    mockApi.getMeetingAnalytics.mockReturnValue(
      emptyApiResponse({
        summary: {
          totalMeetings: 0,
          completedMeetings: 0,
          failedMeetings: 0,
          completionRate: 0,
          avgDurationSeconds: 0,
          totalWords: 0,
          totalActionItems: 0,
          totalDecisions: 0,
        },
        sentimentDistribution: { positive: 0, neutral: 0, concerned: 0 },
        meetingsByDayOfWeek: [],
        topTopics: [],
        recentMeetings: [],
      })
    );
  });

  it("renders without crashing", () => {
    render(<AnalyticsPage />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
  });

  it("shows empty state when no data", async () => {
    render(<AnalyticsPage />);
    expect(await screen.findByText(/no analytics data yet/i)).toBeInTheDocument();
  });

  it("shows meetings tab", async () => {
    render(<AnalyticsPage />);
    expect(await screen.findByTestId("tab-meetings")).toBeInTheDocument();
  });

  it("calls getMeetingAnalytics on mount", async () => {
    render(<AnalyticsPage />);
    await waitFor(() => {
      expect(mockApi.getMeetingAnalytics).toHaveBeenCalled();
    });
  });
});

describe("PRD Detail Page", () => {
  beforeEach(() => {
    mockApi.getPrd.mockReturnValue(
      emptyApiResponse({
        id: "test-123",
        title: "Test Brief",
        summary: "A test brief summary",
        status: "approved",
        confidence: 0.85,
        objectives: ["Objective 1"],
        requirements: [
          { id: "REQ-1", title: "Req 1", description: "Desc", priority: "high", type: "functional", acceptanceCriteria: [] },
        ],
        acceptanceCriteria: [],
        outOfScope: [],
        assumptions: [],
        risks: [],
        tickets: [],
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      })
    );
    mockApi.getPrdCouncil.mockReturnValue(emptyApiResponse(null));
  });

  it("renders without crashing and shows title", async () => {
    render(<PrdDetailPage />);
    expect(await screen.findByText("Test Brief")).toBeInTheDocument();
  });

  it("shows AI Council tab", async () => {
    render(<PrdDetailPage />);
    expect(await screen.findByTestId("tab-council")).toBeInTheDocument();
  });
});

describe("Login Page", () => {
  it("renders login form", () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText(/you@company\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument();
  });
});

describe("Forgot Password Page", () => {
  it("renders email input and send button", () => {
    render(<ForgotPasswordPage />);
    expect(screen.getByPlaceholderText(/you@company\.com/i)).toBeInTheDocument();
    expect(screen.getByText("Send Reset Link")).toBeInTheDocument();
  });
});

describe("Reset Password Page", () => {
  it("shows missing token message when no token provided", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByText(/invalid or missing reset token/i)).toBeInTheDocument();
  });
});

describe("Signup Page", () => {
  it("renders signup form", () => {
    render(<SignupPage />);
    expect(screen.getByPlaceholderText(/jane@acme\.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/at least 6 characters/i)).toBeInTheDocument();
  });
});
