"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signup } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AuthShell } from "@/components/auth-shell";
import { ArrowRight, Loader2 } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", organizationName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signup(form);
      toast.success("Account created", "Welcome to Workforce0!");
      router.push("/dashboard");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setError("An account with this email already exists. Try signing in instead.");
      } else if (err instanceof ApiError && err.code === "NETWORK_ERROR") {
        setError("Unable to reach the server. Please check your connection.");
      } else {
        const message = err instanceof Error ? err.message : "Signup failed. Please try again.";
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <Card className="glass-strong">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="font-display text-2xl font-semibold tracking-[-0.025em]">
            Create your account
          </CardTitle>
          <CardDescription>
            Start your AI workforce in under 5 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                htmlFor="name"
              >
                Your name
              </label>
              <Input
                id="name"
                type="text"
                placeholder="Jane Smith"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                required
                autoFocus
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-ink-secondary"
                htmlFor="org"
              >
                Organization
              </label>
              <Input
                id="org"
                type="text"
                placeholder="Acme Corp"
                value={form.organizationName}
                onChange={(e) => update("organizationName", e.target.value)}
                required
                autoComplete="organization"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-ink-secondary"
                htmlFor="email"
              >
                Work email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="jane@acme.com"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-ink-secondary"
                htmlFor="password"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
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
                <>
                  Create account
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-ink-tertiary">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-ink transition-colors hover:text-accent"
              >
                Sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
