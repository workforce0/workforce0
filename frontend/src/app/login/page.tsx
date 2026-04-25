"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { login } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { api } from "@/lib/api";
import { setToken, setUser } from "@/lib/auth";
import { ArrowRight, Loader2, Shield } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-ink-tertiary" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  // Handle SSO callback (redirected back with ?code=...)
  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) return;

    async function handleSSOCallback(ssoCode: string) {
      setSsoLoading(true);
      try {
        const res = await api.ssoCallback(ssoCode);
        if (res.data) {
          setToken(res.data.token);
          setUser(res.data.user);
          router.push("/dashboard");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "SSO authentication failed";
        setError(message);
      } finally {
        setSsoLoading(false);
      }
    }
    handleSSOCallback(code);
  }, [searchParams, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed. Please check your credentials.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel — cinematic branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-[#07070a] flex-col justify-between p-12 text-white">
        {/* Mesh gradient backdrop */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(1200px 800px at 10% 10%, rgba(99, 102, 241, 0.28), transparent 55%),
              radial-gradient(900px 700px at 90% 90%, rgba(139, 92, 246, 0.22), transparent 55%),
              radial-gradient(600px 400px at 50% 50%, rgba(14, 165, 233, 0.10), transparent 60%)
            `,
          }}
        />
        {/* Subtle grid overlay */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse 60% 60% at 50% 40%, black 0%, transparent 80%)",
          }}
        />

        <div className="relative flex items-center gap-3 animate-fade-in">
          <BrandMark size={40} priority className="glow" />
          <span className="text-xl font-semibold tracking-tight font-display">Workforce0</span>
        </div>

        <div className="relative space-y-7 max-w-md animate-fade-in-up delay-2">
          <h2 className="text-5xl font-semibold leading-[1.02] tracking-[-0.035em] font-display">
            Meetings go in.
            <br />
            <span className="bg-gradient-to-r from-white via-white/80 to-white/40 bg-clip-text text-transparent">
              Shipped work comes out.
            </span>
          </h2>
          <p className="text-lg text-white/60 leading-relaxed">
            Your AI workforce turns conversations into briefs, tickets, and pull requests —
            while you approve from anywhere.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            {[
              { stat: "20s",  label: "Meeting to brief",     delay: "delay-3" },
              { stat: "90%+", label: "First-pass approval",  delay: "delay-4" },
              { stat: "4×",   label: "Fewer review loops",   delay: "delay-5" },
              { stat: "3×",   label: "Faster delivery",      delay: "delay-6" },
            ].map((item) => (
              <div
                key={item.label}
                className={`p-4 rounded-2xl glass-dark animate-fade-in-up ${item.delay}`}
              >
                <p className="text-3xl font-semibold text-white tabular font-display">{item.stat}</p>
                <p className="text-sm text-white/50 mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/30 animate-fade-in delay-8 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald dot-pulse" />
          Open source · MIT · v0.1
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-canvas">
        <div className="w-full max-w-md animate-fade-in-up">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <BrandMark size={36} className="shadow-[0_0_16px_rgba(124,58,237,0.25)]" />
            <span className="text-xl font-bold text-ink">Workforce0</span>
          </div>

          <Card>
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-2xl">Welcome back</CardTitle>
              <CardDescription>Sign in to your AI workforce dashboard</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="p-3 text-sm text-rose bg-rose-light rounded-xl animate-fade-in">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-ink-secondary" htmlFor="email">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-ink-secondary" htmlFor="password">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>

                <div className="flex justify-end">
                  <Link href="/forgot-password" className="text-xs text-ink-tertiary hover:text-accent transition-colors">
                    Forgot password?
                  </Link>
                </div>

                <Button type="submit" variant="accent" className="w-full" size="lg" disabled={loading}>
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>

              {/* SSO Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-ink/[0.08]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-slate-900 px-3 text-ink-faint">or</span>
                </div>
              </div>

              {/* SSO Button */}
              <Button
                variant="outline"
                className="w-full"
                size="lg"
                disabled={ssoLoading}
                onClick={async () => {
                  setSsoLoading(true);
                  setError("");
                  try {
                    const redirectUri = `${window.location.origin}/login?sso=callback`;
                    const res = await api.ssoAuthorize(redirectUri, {
                      loginHint: email || undefined,
                    });
                    if (res.data?.authUrl) {
                      window.location.href = res.data.authUrl;
                    }
                  } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : "SSO is not available";
                    setError(message);
                  } finally {
                    setSsoLoading(false);
                  }
                }}
              >
                {ssoLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    Sign in with SSO
                  </>
                )}
              </Button>

              <div className="mt-6 text-center">
                <p className="text-sm text-ink-tertiary">
                  Don&apos;t have an account?{" "}
                  <Link href="/signup" className="font-medium text-ink hover:text-accent transition-colors">
                    Get started free
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
