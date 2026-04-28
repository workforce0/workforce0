"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  LayoutDashboard,
  Activity,
  Video,
  FileText,
  ListTodo,
  Settings,
  Users,
  LogOut,
  X,
  TrendingUp,
  Cpu,
  Sparkles,
  Timer,
  Inbox,
  Target,
  Bot,
  BookOpen,
  FolderKanban,
  Network,
  HeartPulse,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { logout } from "@/lib/auth";
import { ProjectSwitcher } from "@/components/project-switcher";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Projects", href: "/projects", icon: FolderKanban },
  { name: "Goals", href: "/goals", icon: Target },
  { name: "Engagements", href: "/engagements", icon: Activity },
  { name: "Meetings", href: "/meetings", icon: Video },
  { name: "Briefs", href: "/prds", icon: FileText },
  { name: "Approvals", href: "/approvals", icon: Inbox },
  { name: "Activity", href: "/tasks", icon: ListTodo },
  { name: "Agent Jobs", href: "/agent-jobs", icon: Cpu },
  { name: "Roles", href: "/settings/roles", icon: Bot },
  { name: "Skills", href: "/skills", icon: Sparkles },
  { name: "Library", href: "/library", icon: BookOpen },
  { name: "Code Graph", href: "/graph", icon: Network },
  { name: "Schedules", href: "/schedules", icon: Timer },
  { name: "Analytics", href: "/analytics", icon: TrendingUp },
  { name: "Team", href: "/team", icon: Users },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "System Status", href: "/settings/system-status", icon: HeartPulse },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function fetchPendingCount() {
      try {
        const res = await api.getNotifications('pending', 50);
        if (mounted && res.data) {
          setPendingCount(res.data.length);
        }
      } catch {
        // Silently fail — badge just won't show
      }
    }

    function startPolling() {
      fetchPendingCount();
      interval = setInterval(fetchPendingCount, 30_000);
    }

    function stopPolling() {
      if (interval) { clearInterval(interval); interval = null; }
    }

    function handleVisibility() {
      if (document.hidden) { stopPolling(); }
      else { startPolling(); }
    }

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mounted = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-50 w-[260px] bg-sidebar-bg flex flex-col transition-transform duration-300 ease-[var(--ease-spring)]",
      "lg:translate-x-0",
      mobileOpen ? "translate-x-0" : "-translate-x-full"
    )}>
      {/* Logo */}
      <div className="flex items-center justify-between px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <BrandMark size={36} className="shadow-[0_0_20px_rgba(124,58,237,0.25)]" />
          <div>
            <span className="text-[15px] font-bold text-white tracking-tight">Workforce0</span>
          </div>
        </div>
        {onMobileClose && (
          <button
            onClick={onMobileClose}
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 text-white/50"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* P1: Project scope switcher */}
      <div className="px-3 pb-3">
        <ProjectSwitcher />
      </div>

      {/* Navigation */}
      <nav data-tour="sidebar-nav" aria-label="Main navigation" className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navigation.map((item) => {
          // Pick the deepest matching nav entry as active so parents (e.g. /settings)
          // don't also light up when on a child route (e.g. /settings/system-status).
          const matches = navigation
            .filter((n) => pathname === n.href || pathname.startsWith(n.href + "/"))
            .sort((a, b) => b.href.length - a.href.length);
          const isActive = matches.length > 0 && matches[0].href === item.href;
          const showBadge = item.href === "/dashboard" && pendingCount > 0;
          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
                isActive
                  ? "bg-white/[0.1] text-white"
                  : "text-white/50 hover:bg-white/[0.05] hover:text-white/80"
              )}
            >
              <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200",
                isActive
                  ? "bg-accent/20 text-accent-light"
                  : "text-inherit"
              )}>
                <item.icon className="w-[18px] h-[18px]" />
              </div>
              {item.name}
              {showBadge && (
                <span className="ml-auto flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-[11px] font-bold text-white shadow-[0_0_8px_rgba(245,158,11,0.4)] animate-fade-in">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
              {isActive && !showBadge && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent dot-pulse" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/[0.06]">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-white/40 hover:bg-rose/10 hover:text-rose-light transition-all w-full cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
