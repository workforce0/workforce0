"use client";

import { useEffect, useState } from "react";
import { getUser, type User } from "@/lib/auth";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function Header({ title }: { title?: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between glass border-b border-ink/[0.04] px-6 lg:px-8">
      <div className="flex items-center gap-4">
        {title && (
          <h1 className="text-lg font-semibold text-ink tracking-tight">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden lg:block text-right">
              <p className="text-[13px] font-medium text-ink leading-tight">{getGreeting()}, {user.name.split(" ")[0]}</p>
              <p className="text-[11px] text-ink-tertiary leading-tight">{user.organizationName}</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ink to-ink/80 flex items-center justify-center text-ink-inverse text-xs font-bold shadow-xs">
              {user.name.charAt(0).toUpperCase()}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
