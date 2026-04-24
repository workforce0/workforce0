"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AuthShell } from "@/components/auth-shell";
import { ArrowLeft, Loader2, CheckCircle, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell minimal>
      <Card className="glass-strong">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="font-display text-2xl font-semibold tracking-[-0.025em]">
            Reset your password
          </CardTitle>
          <CardDescription>
            {sent
              ? "Check your email for a reset link."
              : "Enter your email and we'll send you a link to reset your password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-transparent border-gradient bg-[color:var(--color-emerald-light)]/60 p-4">
                <CheckCircle className="h-5 w-5 shrink-0 text-[var(--color-emerald)]" />
                <div>
                  <p className="text-sm font-semibold text-ink">Email sent</p>
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    If an account exists for <strong className="font-mono">{email}</strong>,
                    you&apos;ll receive a password reset link shortly.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-sunken p-3">
                <Mail className="h-4 w-4 text-ink-tertiary" />
                <p className="text-xs text-ink-tertiary">
                  Didn&apos;t receive it? Check your spam folder or try again in a
                  few minutes.
                </p>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/login">
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
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
                  htmlFor="email"
                >
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="email"
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
                  "Send reset link"
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
