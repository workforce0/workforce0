import type { ReactNode } from "react";
import Link from "next/link";

interface AuthShellProps {
  children: ReactNode;
  /** Show the cinematic branding panel on the left (defaults to true on lg+). Pages that need the form to fill the width can pass `minimal`. */
  minimal?: boolean;
}

/**
 * Shared cinematic shell for /login /signup /forgot-password /reset-password.
 *
 * Provides the Aperture-tokened mesh + grid backdrop and a glass card on the
 * right. Pages pass the form (and copy) as children; the shell handles the
 * branding panel, dark background, and responsive layout.
 */
export function AuthShell({ children, minimal = false }: AuthShellProps) {
  return (
    <div className="flex min-h-screen">
      {!minimal && (
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#07070a] p-12 text-white lg:flex lg:w-1/2">
          <div className="bg-mesh-cool absolute inset-0" aria-hidden />
          <div className="bg-grid absolute inset-0 opacity-[0.08]" aria-hidden />

          <Link
            href="/"
            className="relative flex items-center gap-3"
            aria-label="Workforce0 home"
          >
            <div className="glow flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-accent to-violet">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <span className="font-display text-xl font-semibold tracking-tight">
              Workforce0
            </span>
          </Link>

          <div className="relative max-w-md space-y-6">
            <h2 className="font-display text-5xl font-semibold leading-[1.02] tracking-[-0.035em]">
              Meetings go in.
              <br />
              <span className="bg-gradient-to-r from-white via-white/80 to-white/40 bg-clip-text text-transparent">
                Shipped work comes out.
              </span>
            </h2>
            <p className="text-lg leading-relaxed text-white/60">
              Your AI workforce turns conversations into briefs, tickets, and
              pull requests — while you approve from anywhere.
            </p>
          </div>

          <p className="relative flex items-center gap-2 text-xs text-white/30">
            <span className="dot-pulse" aria-hidden />
            Open source · MIT · v0.1
          </p>
        </aside>
      )}

      <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-canvas p-6">
        <div className="bg-mesh-cool absolute inset-0 -z-10 opacity-30" aria-hidden />
        <div className="bg-grid absolute inset-0 -z-10 opacity-40" aria-hidden />
        <div className="relative w-full max-w-md">
          <Link
            href="/"
            className={`mb-8 flex items-center justify-center gap-2.5 ${minimal ? "" : "lg:hidden"}`}
            aria-label="Workforce0 home"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-accent to-violet shadow-[0_0_16px_var(--color-accent-glow)]">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <span className="font-display text-xl font-semibold tracking-tight text-ink">
              Workforce0
            </span>
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
