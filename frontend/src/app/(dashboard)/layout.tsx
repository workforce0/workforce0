"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { AgentJobNotifier } from "@/components/agent-job-notifier";
import { ProjectProvider } from "@/lib/project-context";
import { BrandMark } from "@/components/brand-mark";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <BrandMark size={40} priority className="shadow-[0_0_24px_rgba(124,58,237,0.20)]" />
          <div className="w-6 h-6 rounded-full border-2 border-ink-faint border-t-accent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <ProjectProvider>
    <div className="flex min-h-screen bg-canvas">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <AgentJobNotifier />
      <Sidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />
      <main id="main-content" className="flex-1 lg:ml-[260px]">
        {/* Mobile header */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center h-14 glass border-b border-ink/[0.04] px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-ink/[0.04] -ml-2"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="ml-3 text-[15px] font-bold text-ink tracking-tight">Workforce0</span>
        </div>
        <div className="animate-fade-in">
          {children}
        </div>
      </main>
    </div>
    </ProjectProvider>
  );
}
