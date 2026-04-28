"use client";

/**
 * Integrations grid (Stitch 06).
 *
 * Card grid showing every available integration with its connection status.
 * Connecting opens the unified IntegrationWizard modal.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Header } from "@/components/header";
import { api, IntegrationConnection } from "@/lib/api";
import {
  IntegrationWizard,
  IntegrationName,
} from "@/components/integration-wizard";
import {
  CheckCircle2,
  AlertTriangle,
  Circle,
  ExternalLink,
} from "lucide-react";

interface CatalogEntry {
  name: IntegrationName | "gdrive" | "gdocs" | "asana" | "salesforce";
  label: string;
  blurb: string;
  status: "available" | "coming_soon";
}

const CATALOG: CatalogEntry[] = [
  { name: "jira",    label: "Jira",          blurb: "Turn approved briefs into Jira tickets automatically.", status: "available" },
  { name: "slack",   label: "Slack",         blurb: "Post briefs, approvals, and alerts to your workspace.", status: "available" },
  { name: "github",  label: "GitHub",        blurb: "Open pull requests from approved briefs.",              status: "available" },
  { name: "linear",  label: "Linear",        blurb: "Create Linear issues from approved briefs.",            status: "available" },
  { name: "notion",  label: "Notion",        blurb: "Save briefs as pages or rows in your Notion workspace.", status: "available" },
  { name: "gchat",   label: "Google Chat",   blurb: "Post updates to a Google Chat space.",                  status: "available" },
  { name: "gdrive",  label: "Google Drive",  blurb: "Auto-pull Meet transcripts from a Drive folder.",       status: "available" },
  { name: "gdocs",   label: "Google Docs",   blurb: "Save approved briefs as Google Docs.",                  status: "available" },
  { name: "twilio",  label: "Twilio Voice",  blurb: "Let executives dial in to brief from any phone.",       status: "available" },
  { name: "asana",   label: "Asana",         blurb: "Turn briefs into Asana tasks.",                         status: "coming_soon" },
  { name: "salesforce", label: "Salesforce", blurb: "Sync customer conversations into Salesforce.",          status: "coming_soon" },
];

type Filter = "all" | "connected" | "available" | "coming_soon";

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [wizardOpen, setWizardOpen] = useState<IntegrationName | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const res = await api.listIntegrations();
    if (res.success && res.data) setConnections(res.data);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const statusFor = (name: string): IntegrationConnection["status"] => {
    return connections.find((c) => c.name === name)?.status ?? "disconnected";
  };

  const visibleEntries = CATALOG.filter((entry) => {
    const s = statusFor(entry.name);
    if (filter === "all") return true;
    if (filter === "connected") return s === "connected";
    if (filter === "available") return entry.status === "available" && s !== "connected";
    if (filter === "coming_soon") return entry.status === "coming_soon";
    return true;
  });

  const connectedCount = connections.filter((c) => c.status === "connected").length;

  return (
    <>
      <Header title="Integrations" />
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <header data-tour="integrations-header" className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
              Integrations
            </h1>
            <p className="max-w-[58ch] text-sm text-ink-secondary">
              Connect Workforce0 to the tools your team already uses. Everything
              runs on your instance with your keys — nothing is brokered.
            </p>
            {connectedCount > 0 && (
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary tabular">
                <span className="text-accent">{connectedCount}</span> connected
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://github.com/workforce0/workforce0/issues/new?labels=enhancement"
              target="_blank"
              rel="noopener noreferrer"
            >
              Request an integration
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </header>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="connected">Connected</TabsTrigger>
            <TabsTrigger value="available">Available</TabsTrigger>
            <TabsTrigger value="coming_soon">Coming soon</TabsTrigger>
          </TabsList>

          <TabsContent value={filter} className="mt-6">
            {loading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="skeleton h-40 rounded-[var(--radius-lg)]"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {visibleEntries.map((entry) => (
                  <IntegrationCard
                    key={entry.name}
                    entry={entry}
                    status={statusFor(entry.name)}
                    onConnect={() => {
                      if (entry.status === "available") {
                        const canWizard: IntegrationName[] = [
                          "jira",
                          "slack",
                          "github",
                          "linear",
                          "notion",
                          "gchat",
                          "twilio",
                        ];
                        if (canWizard.includes(entry.name as IntegrationName)) {
                          setWizardOpen(entry.name as IntegrationName);
                        }
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Card className="border-dashed bg-surface-sunken/50">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Looking for something else?
              </p>
              <p className="mt-1 text-xs text-ink-tertiary">
                Workforce0 is open source. Build your own integration and open
                a PR — we&apos;ll help you.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com/workforce0/workforce0/blob/main/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Contributor guide
              </a>
            </Button>
          </div>
        </Card>
      </div>

      {wizardOpen && (
        <IntegrationWizard
          integration={wizardOpen}
          open={Boolean(wizardOpen)}
          onOpenChange={(open) => !open && setWizardOpen(null)}
          onConnected={() => void refresh()}
        />
      )}
    </>
  );
}

function IntegrationCard({
  entry,
  status,
  onConnect,
}: {
  entry: CatalogEntry;
  status: IntegrationConnection["status"];
  onConnect: () => void;
}) {
  const comingSoon = entry.status === "coming_soon";
  const isConnected = !comingSoon && status === "connected";
  return (
    <div
      data-tour={`integration-card-${entry.name}`}
      className={`card-interactive relative flex flex-col gap-3 rounded-[var(--radius-lg)] border bg-surface p-5 shadow-[var(--shadow-card)] transition-all duration-[160ms] ${
        isConnected
          ? "border-transparent border-gradient"
          : "border-border hover:border-border-strong"
      } ${comingSoon ? "opacity-80" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-sm font-semibold ${
              isConnected ? "bg-accent text-white" : "bg-accent-subtle text-accent"
            }`}
          >
            {entry.label[0]}
          </span>
          <span className="font-semibold text-ink">{entry.label}</span>
        </div>
        <StatusPill status={comingSoon ? "coming_soon" : status} />
      </div>
      <p className="flex-1 text-xs leading-relaxed text-ink-secondary">
        {entry.blurb}
      </p>
      <div>
        {comingSoon ? (
          <Button variant="ghost" size="sm" disabled>
            Coming soon
          </Button>
        ) : isConnected ? (
          <Button variant="outline" size="sm" onClick={onConnect}>
            Manage
          </Button>
        ) : (
          <Button variant="accent" size="sm" onClick={onConnect}>
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: IntegrationConnection["status"] | "coming_soon" }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-emerald-light)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-emerald)]">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
  }
  if (status === "action_needed" || status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber">
        <AlertTriangle className="h-3 w-3" /> Action needed
      </span>
    );
  }
  if (status === "coming_soon") {
    return (
      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
        Soon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-tertiary">
      <Circle className="h-3 w-3" /> Not connected
    </span>
  );
}
