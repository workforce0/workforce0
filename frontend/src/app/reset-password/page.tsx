"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AuthShell } from "@/components/auth-shell";
import { ArrowLeft, Loader2, CheckCircle } from "lucide-react";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-canvas">
          <Loader2 className="h-8 w-8 animate-spin text-ink-tertiary" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Reset failed. The link may have expired.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell minimal>
        <Card className="glass-strong">
          <CardContent className="p-8 text-center">
            <p className="mb-4 text-sm text-ink-secondary">
              Invalid or missing reset token. Please request a new password
              reset link.
            </p>
            <Button variant="accent" className="glow" asChild>
              <Link href="/forgot-password">Request new link</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell minimal>
      <Card className="glass-strong">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="font-display text-2xl font-semibold tracking-[-0.025em]">
            Set new password
          </CardTitle>
          <CardDescription>
            {success
              ? "Your password has been updated."
              : "Choose a new password for your account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-transparent border-gradient bg-[color:var(--color-emerald-light)]/60 p-4">
                <CheckCircle className="h-5 w-5 shrink-0 text-[var(--color-emerald)]" />
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Password updated
                  </p>
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    Redirecting you to sign in…
                  </p>
                </div>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/login">
                  <ArrowLeft className="h-4 w-4" />
                  Sign in now
                </Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  className="rounded-[var(--radius-md)] border border-rose/20 bg-rose-light p-3 text-sm text-rose"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-ink-secondary"
                  htmlFor="password"
                >
                  New password
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoFocus
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-ink-secondary"
                  htmlFor="confirm"
                >
                  Confirm password
                </label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="Re-enter your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>

              <Button
                type="submit"
                variant="accent"
                className="glow w-full"
                size="lg"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Reset password"
                )}
              </Button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1 text-sm text-ink-tertiary transition-colors hover:text-accent"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
