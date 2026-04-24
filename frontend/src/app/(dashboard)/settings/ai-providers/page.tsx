"use client";

/**
 * AI Providers — BYOK credentials management.
 *
 * Pattern inspired by open-notebook: one row per provider, "Paste key →
 * Test connection → Save". Keys never returned to the client after save,
 * only a configured/not-configured status flag.
 */

import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  Sparkles,
} from "lucide-react";

interface Provider {
  name: string;
  label: string;
  getKeyUrl: string;
  docs: string;
  configured: boolean;
  updatedAt: string | null;
}

export default function AiProvidersPage() {
  const toast = useToast();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Provider[]>(`/api/providers`);
      if (res.success && res.data) setProviders(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(name: string) {
    const key = (pendingKey[name] ?? "").trim();
    if (!key) {
      toast.warning("Paste a key first");
      return;
    }
    setBusy((b) => ({ ...b, [name]: "saving" }));
    try {
      await api.put(`/api/providers/${name}`, { apiKey: key });
      toast.success(`${name} saved`);
      setPendingKey((p) => ({ ...p, [name]: "" }));
      await load();
    } catch (err) {
      toast.error("Save failed", (err as Error).message);
    } finally {
      setBusy((b) => ({ ...b, [name]: null }));
    }
  }

  async function test(name: string) {
    setBusy((b) => ({ ...b, [name]: "testing" }));
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(
        `/api/providers/${name}/test`,
      );
      if (res.success && res.data?.ok) {
        toast.success("Connection works", `${name} is reachable.`);
      } else {
        toast.error("Test failed", res.data?.error ?? res.error?.message ?? "Unknown error");
      }
    } finally {
      setBusy((b) => ({ ...b, [name]: null }));
    }
  }

  async function remove(name: string) {
    if (!confirm(`Remove the stored ${name} key? The app will fall back to the env var if set.`)) return;
    setBusy((b) => ({ ...b, [name]: "deleting" }));
    try {
      await api.delete(`/api/providers/${name}`);
      toast.success("Removed");
      await load();
    } finally {
      setBusy((b) => ({ ...b, [name]: null }));
    }
  }

  return (
    <div className="min-h-screen">
      <Header title="AI Providers" />
      <div className="max-w-5xl space-y-8 p-6 lg:p-8">
        <div className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            AI Providers
          </h2>
          <p className="max-w-[56ch] text-sm text-ink-secondary">
            Bring your own keys for Claude, Gemini, and OpenAI. Keys are
            encrypted at rest with AES-256-GCM — we never broker or bill
            inference, you pay your providers directly.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="skeleton h-32 rounded-[var(--radius-lg)]"
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => {
              const isBusy = busy[p.name];
              return (
                <div
                  key={p.name}
                  className={`rounded-[var(--radius-lg)] border bg-surface shadow-[var(--shadow-card)] transition-all duration-[160ms] ${
                    p.configured
                      ? "border-transparent border-gradient"
                      : "border-border"
                  }`}
                >
                  <div className="space-y-4 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-sm font-semibold ${
                            p.configured
                              ? "bg-accent text-white shadow-[0_0_12px_var(--color-accent-glow)]"
                              : "bg-accent-subtle text-accent"
                          }`}
                        >
                          {p.label[0]}
                        </span>
                        <span className="font-semibold text-ink">{p.label}</span>
                        {p.configured ? (
                          <Badge
                            variant="success"
                            className="gap-1 font-semibold uppercase tracking-[0.08em]"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Configured
                          </Badge>
                        ) : (
                          <Badge
                            variant="default"
                            className="gap-1 uppercase tracking-[0.08em] text-ink-tertiary"
                          >
                            <Circle className="h-3 w-3" /> Not configured
                          </Badge>
                        )}
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={p.getKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Get a key <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`${p.name}-key`}>
                        {p.configured ? "Replace key" : "Paste key"}
                      </Label>
                      <div className="relative">
                        <Input
                          id={`${p.name}-key`}
                          type={showKey[p.name] ? "text" : "password"}
                          placeholder={
                            p.name === "anthropic"
                              ? "sk-ant-api03-..."
                              : p.name === "google"
                                ? "AIza..."
                                : "sk-..."
                          }
                          value={pendingKey[p.name] ?? ""}
                          onChange={(e) =>
                            setPendingKey((prev) => ({
                              ...prev,
                              [p.name]: e.target.value,
                            }))
                          }
                          className="font-mono pr-10"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowKey((s) => ({ ...s, [p.name]: !s[p.name] }))
                          }
                          className="absolute inset-y-0 right-2 flex items-center text-ink-tertiary transition-colors hover:text-ink"
                          aria-label={showKey[p.name] ? "Hide key" : "Show key"}
                        >
                          {showKey[p.name] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {p.configured && (
                        <p className="text-[11px] text-ink-tertiary tabular">
                          Stored key last updated{" "}
                          {p.updatedAt
                            ? new Date(p.updatedAt).toLocaleString()
                            : "—"}
                          .
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="accent"
                        onClick={() => save(p.name)}
                        disabled={
                          Boolean(isBusy) || !(pendingKey[p.name] ?? "").trim()
                        }
                      >
                        {isBusy === "saving" && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        {p.configured ? "Replace key" : "Save"}
                      </Button>
                      {p.configured && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => test(p.name)}
                            disabled={Boolean(isBusy)}
                          >
                            {isBusy === "testing" ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            Test connection
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => remove(p.name)}
                            disabled={Boolean(isBusy)}
                            className="ml-auto text-ink-tertiary hover:bg-rose-light hover:text-rose"
                          >
                            {isBusy === "deleting" ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Card className="border-dashed bg-surface-sunken/50">
          <CardContent className="p-5">
            <p className="text-sm font-semibold text-ink">
              Model assignments live elsewhere
            </p>
            <p className="mt-1 text-xs text-ink-secondary leading-relaxed">
              This page is about credentials. To pick which model runs each
              agent (BA, Dev, QA, etc.), head to{" "}
              <a className="text-accent underline" href="/settings/models">
                Settings → Models
              </a>
              . Defaults are tuned for Claude Sonnet 4.6 across every agent;
              change per-agent from there if you want something else.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
