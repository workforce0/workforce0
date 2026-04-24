import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ─── Hoisted mocks (available before vi.mock factory runs) ────────────────────
const { mockGetNotifications, mockLogout } = vi.hoisted(() => ({
  mockGetNotifications: vi.fn(),
  mockLogout: vi.fn(),
}));

// ─── Mock next/navigation ─────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  })),
}));

// ─── Mock next/link ───────────────────────────────────────────────────────────
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

// ─── Mock @/lib/api ───────────────────────────────────────────────────────────
vi.mock("@/lib/api", () => ({
  api: {
    getNotifications: mockGetNotifications,
  },
}));

// ─── Mock @/lib/auth ──────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  logout: mockLogout,
}));

// ─── Mock lucide-react icons ──────────────────────────────────────────────────
vi.mock("lucide-react", () => {
  const iconFactory = (name: string) => {
    const IconComponent = (props: Record<string, unknown>) =>
      React.createElement("span", { "data-testid": `icon-${name}`, ...props });
    IconComponent.displayName = name;
    return IconComponent;
  };

  return {
    LayoutDashboard: iconFactory("LayoutDashboard"),
    Activity: iconFactory("Activity"),
    Video: iconFactory("Video"),
    FileText: iconFactory("FileText"),
    ListTodo: iconFactory("ListTodo"),
    Settings: iconFactory("Settings"),
    Users: iconFactory("Users"),
    LogOut: iconFactory("LogOut"),
    TrendingUp: iconFactory("TrendingUp"),
    X: iconFactory("X"),
  };
});

// ─── Mock Badge component ─────────────────────────────────────────────────────
vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant,
    className,
    ...props
  }: {
    children: React.ReactNode;
    variant?: string;
    className?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "badge", "data-variant": variant || "default", className, ...props },
      children
    ),
  badgeVariants: vi.fn(),
}));

import { StatusBadge } from "@/components/status-badge";
import { Sidebar } from "@/components/sidebar";

// ─── StatusBadge Tests ────────────────────────────────────────────────────────

describe("StatusBadge", () => {
  const statusTests: Array<{
    status: string;
    expectedLabel: string;
    expectedVariant: string;
  }> = [
    { status: "scheduled", expectedLabel: "Scheduled", expectedVariant: "info" },
    { status: "joining", expectedLabel: "Joining", expectedVariant: "info" },
    { status: "in_progress", expectedLabel: "In Progress", expectedVariant: "purple" },
    { status: "transcribing", expectedLabel: "Transcribing", expectedVariant: "purple" },
    { status: "processing", expectedLabel: "Processing", expectedVariant: "warning" },
    { status: "completed", expectedLabel: "Completed", expectedVariant: "success" },
    { status: "failed", expectedLabel: "Failed", expectedVariant: "error" },
    { status: "cancelled", expectedLabel: "Cancelled", expectedVariant: "default" },
    { status: "draft", expectedLabel: "Draft", expectedVariant: "default" },
    { status: "review", expectedLabel: "Needs Review", expectedVariant: "warning" },
    { status: "pending_approval", expectedLabel: "Pending", expectedVariant: "warning" },
    { status: "approved", expectedLabel: "Approved", expectedVariant: "success" },
    { status: "rejected", expectedLabel: "Rejected", expectedVariant: "error" },
    { status: "needs_clarification", expectedLabel: "Needs Input", expectedVariant: "purple" },
    { status: "pending", expectedLabel: "Pending", expectedVariant: "default" },
    { status: "awaiting_clarification", expectedLabel: "Needs Input", expectedVariant: "purple" },
    { status: "awaiting_approval", expectedLabel: "Pending", expectedVariant: "warning" },
    { status: "created", expectedLabel: "Created", expectedVariant: "info" },
    { status: "synced", expectedLabel: "Synced", expectedVariant: "success" },
  ];

  statusTests.forEach(({ status, expectedLabel, expectedVariant }) => {
    it(`renders "${expectedLabel}" with variant "${expectedVariant}" for status "${status}"`, () => {
      render(<StatusBadge status={status} />);
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveTextContent(expectedLabel);
      expect(badge).toHaveAttribute("data-variant", expectedVariant);
    });
  });

  it("falls back to raw status text and default variant for unknown status", () => {
    render(<StatusBadge status="some_unknown_status" />);
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("some_unknown_status");
    expect(badge).toHaveAttribute("data-variant", "default");
  });
});

// ─── Sidebar Tests ────────────────────────────────────────────────────────────

describe("Sidebar", () => {
  beforeEach(() => {
    mockGetNotifications.mockReset();
  });

  it("renders all navigation items", async () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Engagements")).toBeInTheDocument();
    expect(screen.getByText("Meetings")).toBeInTheDocument();
    expect(screen.getByText("Briefs")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders correct hrefs for navigation links", () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar />);

    const expectedHrefs = [
      "/dashboard",
      "/engagements",
      "/meetings",
      "/prds",
      "/tasks",
      "/team",
      "/settings",
    ];

    expectedHrefs.forEach((href) => {
      const link = document.querySelector(`a[href="${href}"]`);
      expect(link).toBeTruthy();
    });
  });

  it("renders Sign Out button", () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar />);

    expect(screen.getByText("Sign Out")).toBeInTheDocument();
  });

  it("renders Workforce0 branding", () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar />);

    expect(screen.getByText("Workforce0")).toBeInTheDocument();
  });

  it("renders the main navigation landmark", () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar />);

    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    expect(nav).toBeInTheDocument();
  });

  it("shows notification badge when pending count > 0", async () => {
    const mockNotifications = [
      { id: "1", title: "Test", status: "pending" },
      { id: "2", title: "Test2", status: "pending" },
      { id: "3", title: "Test3", status: "pending" },
    ];
    mockGetNotifications.mockResolvedValue({ data: mockNotifications });

    render(<Sidebar />);

    const badge = await screen.findByText("3");
    expect(badge).toBeInTheDocument();
  });

  it("displays 9+ when pending count exceeds 9", async () => {
    const manyNotifications = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      title: `Notif ${i}`,
      status: "pending",
    }));
    mockGetNotifications.mockResolvedValue({ data: manyNotifications });

    render(<Sidebar />);

    const badge = await screen.findByText("9+");
    expect(badge).toBeInTheDocument();
  });

  it("does not show notification badge when pending count is 0", async () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar />);

    // Wait for the effect to settle
    await vi.waitFor(() => {
      expect(mockGetNotifications).toHaveBeenCalled();
    });

    // No badge number should be visible
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
  });

  it("does not show notification badge when API call fails", async () => {
    mockGetNotifications.mockRejectedValue(new Error("Network error"));

    render(<Sidebar />);

    // Wait for the effect to settle
    await vi.waitFor(() => {
      expect(mockGetNotifications).toHaveBeenCalled();
    });

    expect(screen.queryByText("9+")).not.toBeInTheDocument();
  });

  it("renders close button when onMobileClose is provided", () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar mobileOpen={true} onMobileClose={() => {}} />);

    const closeBtn = screen.getByLabelText("Close menu");
    expect(closeBtn).toBeInTheDocument();
  });

  it("does not render close button when onMobileClose is not provided", () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    render(<Sidebar />);

    expect(screen.queryByLabelText("Close menu")).not.toBeInTheDocument();
  });

  it("marks current route as active with aria-current='page'", () => {
    mockGetNotifications.mockResolvedValue({ data: [] });

    // usePathname mock returns "/dashboard" by default
    render(<Sidebar />);

    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink).toHaveAttribute("aria-current", "page");

    // Other links should not have aria-current
    const meetingsLink = screen.getByText("Meetings").closest("a");
    expect(meetingsLink).not.toHaveAttribute("aria-current");
  });
});
