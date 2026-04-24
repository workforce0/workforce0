"use client";

/**
 * ProjectContext — the active project scope, shared across the dashboard.
 *
 * Every list endpoint filters by the active project when X-Project-Id is set.
 *
 * Precedence for the initial scope:
 *   1. `?project=<slug-or-id>` query param (deep link) — overrides everything,
 *      lets a shared link target a specific project regardless of what the
 *      recipient had selected last.
 *   2. localStorage wf0_project_id — survives reloads.
 *   3. First active project in the list — fallback when nothing is stored.
 *
 * A "projectchange" CustomEvent lets list views refetch on switch without
 * subscribing through React context.
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api, type Project } from "@/lib/api";

interface ProjectContextValue {
  projects: Project[];
  current: Project | null;
  setCurrent: (projectId: string | null) => void;
  refresh: () => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "wf0_project_id";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listProjects();
      if (res.data) {
        setProjects(res.data);

        // Precedence: ?project= query param > localStorage > first active.
        const urlValue =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("project")
            : null;
        const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;

        const matchByUrl = urlValue
          ? res.data.find((p) => p.id === urlValue || p.slug === urlValue) ?? null
          : null;

        if (matchByUrl) {
          setCurrentId(matchByUrl.id);
          if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, matchByUrl.id);
        } else {
          const stillValid = stored && res.data.some((p) => p.id === stored);
          if (!stillValid && res.data.length > 0) {
            const fallback = res.data[0].id;
            setCurrentId(fallback);
            if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, fallback);
          } else if (stillValid) {
            setCurrentId(stored);
          }
        }
      }
    } catch {
      // Silently fail — user sees projects list empty, not a crash.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setCurrent = useCallback((projectId: string | null) => {
    setCurrentId(projectId);
    if (typeof window !== "undefined") {
      if (projectId) localStorage.setItem(STORAGE_KEY, projectId);
      else localStorage.removeItem(STORAGE_KEY);
      // Let list views know to refetch.
      window.dispatchEvent(new CustomEvent("projectchange", { detail: { projectId } }));
    }
  }, []);

  const current = currentId ? projects.find((p) => p.id === currentId) ?? null : null;

  return (
    <ProjectContext.Provider value={{ projects, current, setCurrent, refresh, loading }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used inside <ProjectProvider>");
  return ctx;
}
