"use client";

/**
 * Integration connection wizard — the single-most-important non-dev UX
 * moment in Workforce0. Renders as a modal overlay that walks the user
 * through connecting any integration in three steps: URL/identifier →
 * token → test.
 *
 * Based on docs/stitch-prompts/05-integration-wizard.md. Same shell for
 * every integration (Jira, Slack, GitHub, Linear, Notion, etc.) — the
 * integration-specific schema lives in INTEGRATION_SPECS below.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  XCircle,
} from "lucide-react";

export type IntegrationName =
  | "jira"
  | "slack"
  | "github"
  | "linear"
  | "notion"
  | "gchat"
  | "twilio";

interface FieldSpec {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password";
  helper?: string;
}

interface IntegrationSpec {
  title: string;
  tokenPageUrl: string;
  tokenPageLabel: string;
  steps: {
    identifier?: {
      heading: string;
      subtitle: string;
      fields: FieldSpec[];
    };
    token: {
      heading: string;
      subtitle: string;
      fields: FieldSpec[];
      instructions: string[];
    };
  };
}

const INTEGRATION_SPECS: Record<IntegrationName, IntegrationSpec> = {
  jira: {
    title: "Connect Jira",
    tokenPageUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    tokenPageLabel: "Open Jira token page",
    steps: {
      identifier: {
        heading: "What's your Jira address?",
        subtitle: "The one you use in your browser.",
        fields: [
          {
            key: "baseUrl",
            label: "Jira URL",
            placeholder: "yourcompany.atlassian.net",
            type: "text",
            helper: "Paste everything between https:// and the first slash.",
          },
          {
            key: "email",
            label: "Your Jira email",
            placeholder: "you@company.com",
            type: "text",
            helper: "The email you log in to Jira with.",
          },
        ],
      },
      token: {
        heading: "Create a Jira API token",
        subtitle: "This lets Workforce0 create tickets on your behalf. Takes 30 seconds.",
        instructions: [
          "Click the button below to open Jira's token page.",
          'Click "Create API token", name it "Workforce0", and copy the token.',
          "Paste it here and click Test connection.",
        ],
        fields: [
          {
            key: "apiToken",
            label: "Paste your token here",
            placeholder: "ATATT3xFfGF0...",
            type: "password",
          },
        ],
      },
    },
  },
  slack: {
    title: "Connect Slack",
    tokenPageUrl: "https://api.slack.com/apps",
    tokenPageLabel: "Open Slack apps page",
    steps: {
      token: {
        heading: "Paste your Slack bot token",
        subtitle: "Workforce0 posts briefs, approvals, and alerts to your workspace.",
        instructions: [
          "Open api.slack.com/apps and create a new app for your workspace.",
          "Add OAuth scopes: chat:write, channels:read, reactions:read.",
          'Install to workspace, then copy the "Bot User OAuth Token" (starts with xoxb-).',
        ],
        fields: [
          {
            key: "botToken",
            label: "Bot User OAuth Token",
            placeholder: "xoxb-...",
            type: "password",
          },
          {
            key: "defaultChannel",
            label: "Default channel (optional)",
            placeholder: "#product-team",
            type: "text",
          },
        ],
      },
    },
  },
  github: {
    title: "Connect GitHub",
    tokenPageUrl: "https://github.com/settings/personal-access-tokens/new",
    tokenPageLabel: "Open GitHub token page",
    steps: {
      token: {
        heading: "Create a GitHub Personal Access Token",
        subtitle: "Fine-grained recommended. Scope it to just the repos you want to use.",
        instructions: [
          'Click the button to open GitHub\'s "New fine-grained token" page.',
          'Name it "Workforce0", pick the repos, grant Contents + Pull requests + Metadata.',
          "Copy the token (starts with github_pat_...).",
        ],
        fields: [
          {
            key: "pat",
            label: "GitHub token",
            placeholder: "github_pat_...",
            type: "password",
          },
          {
            key: "defaultRepo",
            label: "Default repository (optional)",
            placeholder: "owner/repo",
            type: "text",
          },
        ],
      },
    },
  },
  linear: {
    title: "Connect Linear",
    tokenPageUrl: "https://linear.app/settings/api",
    tokenPageLabel: "Open Linear API settings",
    steps: {
      token: {
        heading: "Paste your Linear API key",
        subtitle: "Workforce0 creates Linear issues from approved briefs.",
        instructions: [
          "Open Linear → Settings → API.",
          'Click "Create key", name it "Workforce0", copy it (starts with lin_api_).',
        ],
        fields: [
          {
            key: "apiKey",
            label: "Linear API key",
            placeholder: "lin_api_...",
            type: "password",
          },
        ],
      },
    },
  },
  notion: {
    title: "Connect Notion",
    tokenPageUrl: "https://www.notion.so/my-integrations",
    tokenPageLabel: "Open Notion integrations",
    steps: {
      token: {
        heading: "Paste your Notion integration secret",
        subtitle: "Workforce0 saves approved briefs to your Notion workspace.",
        instructions: [
          'Click "+ New integration", name it "Workforce0", pick your workspace.',
          "Enable: Read content, Update content, Insert content.",
          "Copy the Internal Integration Secret (starts with secret_).",
          "Important: share the parent page with this integration from Notion's … menu.",
        ],
        fields: [
          {
            key: "secret",
            label: "Internal integration secret",
            placeholder: "secret_...",
            type: "password",
          },
        ],
      },
    },
  },
  gchat: {
    title: "Connect Google Chat",
    tokenPageUrl: "https://support.google.com/chat/answer/7655820",
    tokenPageLabel: "How to create a webhook",
    steps: {
      token: {
        heading: "Paste your Google Chat webhook",
        subtitle: "Workforce0 posts updates to your team space.",
        instructions: [
          "Open the Google Chat space where you want updates.",
          'Click "Apps & integrations" → "Webhooks" → Add webhook.',
          "Name it Workforce0 and copy the URL.",
        ],
        fields: [
          {
            key: "webhookUrl",
            label: "Webhook URL",
            placeholder: "https://chat.googleapis.com/v1/spaces/...",
            type: "password",
          },
        ],
      },
    },
  },
  // Field `key`s here MUST match the credential keys the backend's
  // Twilio tester reads (see backend/src/lib/di-container.ts —
  // `integrationConnectionService.registerTester('twilio', …)`):
  // twilioAccountSid, twilioAuthToken, twilioPhoneNumber.
  twilio: {
    title: "Connect Twilio Voice",
    tokenPageUrl: "https://console.twilio.com",
    tokenPageLabel: "Open Twilio console",
    steps: {
      identifier: {
        heading: "What's your Twilio account?",
        subtitle: "Find these in your Twilio console — they take 30 seconds to copy.",
        fields: [
          {
            key: "twilioAccountSid",
            label: "Account SID",
            placeholder: "AC...",
            type: "text",
            helper: "Top-right of console.twilio.com — starts with AC.",
          },
          {
            key: "twilioPhoneNumber",
            label: "Twilio phone number",
            placeholder: "+15551234567",
            type: "text",
            helper:
              "The number people will dial to reach you (or that the AI will dial out from). Use E.164 format with the country code.",
          },
        ],
      },
      token: {
        heading: "Paste your Auth Token",
        subtitle:
          "This lets Workforce0 receive inbound calls and place outbound dial-ins. Stored encrypted; never logged.",
        instructions: [
          "Open the Twilio console — the link is the button below.",
          'Find "Auth Token" right under your Account SID, click "View".',
          "Copy the full token and paste it here.",
        ],
        fields: [
          {
            key: "twilioAuthToken",
            label: "Auth Token",
            placeholder: "32-character hex string",
            type: "password",
          },
        ],
      },
    },
  },
};

interface IntegrationWizardProps {
  integration: IntegrationName;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}

export function IntegrationWizard({
  integration,
  open,
  onOpenChange,
  onConnected,
}: IntegrationWizardProps) {
  const spec = INTEGRATION_SPECS[integration];
  const hasIdentifierStep = Boolean(spec.steps.identifier);
  const totalSteps = hasIdentifierStep ? 3 : 2;

  const [step, setStep] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const reset = () => {
    setStep(1);
    setValues({});
    setShowPasswords({});
    setError(null);
    setSubmitting(false);
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 200);
  };

  const identifierFields = spec.steps.identifier?.fields ?? [];
  const tokenFields = spec.steps.token.fields;

  const identifierStepValid = identifierFields.every((f) => (values[f.key] ?? "").trim().length > 0);
  const tokenStepValid = tokenFields.every(
    (f) => f.key === "defaultChannel" || f.key === "defaultRepo" || (values[f.key] ?? "").trim().length > 0,
  );

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.connectIntegration(integration, values);
      if (!res.success) {
        setError(res.error?.message ?? "Connection test failed");
        setSubmitting(false);
        return;
      }
      toast.success(`${spec.title.replace("Connect ", "")} connected`);
      onConnected?.();
      const testStep = hasIdentifierStep ? 3 : 2;
      setStep(testStep);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{spec.title}</DialogTitle>
          <div className="flex items-center gap-1.5 pt-2">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-6 rounded-full ${
                  i + 1 <= step ? "bg-accent" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </DialogHeader>

        {hasIdentifierStep && step === 1 && (
          <div className="space-y-4 py-2">
            <div>
              <h3 className="text-lg font-semibold">{spec.steps.identifier!.heading}</h3>
              <p className="text-sm text-muted-foreground mt-1">{spec.steps.identifier!.subtitle}</p>
            </div>
            {spec.steps.identifier!.fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type={f.type}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  autoFocus={f === spec.steps.identifier!.fields[0]}
                />
                {f.helper && <p className="text-xs text-muted-foreground">{f.helper}</p>}
              </div>
            ))}
          </div>
        )}

        {((hasIdentifierStep && step === 2) || (!hasIdentifierStep && step === 1)) && (
          <div className="space-y-4 py-2">
            <div>
              <h3 className="text-lg font-semibold">{spec.steps.token.heading}</h3>
              <p className="text-sm text-muted-foreground mt-1">{spec.steps.token.subtitle}</p>
            </div>

            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              {spec.steps.token.instructions.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>

            <Button variant="outline" size="sm" asChild>
              <a
                href={spec.tokenPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {spec.tokenPageLabel}
              </a>
            </Button>

            {spec.steps.token.fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <div className="relative">
                  <Input
                    id={f.key}
                    type={f.type === "password" && !showPasswords[f.key] ? "password" : "text"}
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  {f.type === "password" && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords((s) => ({ ...s, [f.key]: !s[f.key] }))
                      }
                      className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                    >
                      {showPasswords[f.key] ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
                {f.helper && <p className="text-xs text-muted-foreground">{f.helper}</p>}
              </div>
            ))}

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {((hasIdentifierStep && step === 3) || (!hasIdentifierStep && step === 2)) && (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Connected!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Workforce0 can now talk to {spec.title.replace("Connect ", "")}. You can change or
                disconnect this any time from Settings → Integrations.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t">
          {step === 1 ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={close}
            >
              Cancel
            </button>
          ) : step < (hasIdentifierStep ? 3 : 2) ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {step === 1 && hasIdentifierStep && (
            <Button disabled={!identifierStepValid} onClick={() => setStep(2)}>
              Continue
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          {((hasIdentifierStep && step === 2) || (!hasIdentifierStep && step === 1)) && (
            <Button disabled={!tokenStepValid || submitting} onClick={submit}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Test connection
            </Button>
          )}
          {((hasIdentifierStep && step === 3) || (!hasIdentifierStep && step === 2)) && (
            <Button onClick={close}>Done</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
