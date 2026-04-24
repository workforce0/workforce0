"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderKanban, Plus, Settings2 } from "lucide-react";
import { useProjectContext } from "@/lib/project-context";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function ProjectSwitcher() {
  const { projects, current, setCurrent, loading } = useProjectContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [open]);

  if (loading && projects.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-white/5 border border-white/10 text-[12px] text-white/40">
        <FolderKanban className="w-3.5 h-3.5" />
        <span>Loading...</span>
      </div>
    );
  }

  if (projects.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 px-3 h-9 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[12.5px] font-medium text-white/90 transition-colors min-w-[160px]"
      >
        <FolderKanban className="w-3.5 h-3.5 text-accent-light flex-shrink-0" />
        <span className="truncate flex-1 text-left">
          {current?.name ?? "All Projects"}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform flex-shrink-0", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 w-[260px] rounded-xl bg-sidebar-bg border border-white/10 shadow-2xl overflow-hidden z-50"
        >
          <div className="py-1 max-h-[280px] overflow-y-auto">
            {projects.map((p) => {
              const isActive = current?.id === p.id;
              return (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    setCurrent(p.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors",
                    isActive
                      ? "bg-accent/15 text-white"
                      : "text-white/75 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color ?? "#c2710c" }}
                  />
                  <span className="truncate flex-1">{p.name}</span>
                  {p.isArchived && (
                    <span className="text-[10px] uppercase tracking-wide text-white/40">archived</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-white/10 px-1 py-1 flex gap-1">
            <Link
              href="/projects"
              onClick={() => setOpen(false)}
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Manage
            </Link>
            <Link
              href="/projects?new=1"
              onClick={() => setOpen(false)}
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium text-accent-light hover:bg-accent/10 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
