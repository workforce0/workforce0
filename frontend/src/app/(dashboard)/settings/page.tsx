"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { Header } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { AgentSetupWizard } from "@/components/agent-setup-wizard";
import { AgentDashboard } from "@/components/agent-dashboard";
import {
  Plug,
  CheckCircle,
  XCircle,
  ExternalLink,
  Loader2,
  Video,
  MessageSquare,
  Ticket,
  FileText,
  Bell,
  Shield,
  HelpCircle,
  Phone,
  Hash,
  GitPullRequest,
  Mail,
  Users,
  CreditCard,
  ArrowRight,
  ScrollText,
  DollarSign,
  AlertTriangle,
  Brain,
  Cloud,
  Key,
  Cpu,
} from "lucide-react";

interface IntegrationConfig {
  name: string;
  testKey: string;
  description: string;
  icon: typeof Video;
  fields: Array<{
    key: string;
    label: string;
    placeholder: string;
    type?: string;
    helpText?: string;
    helpUrl?: string;
  }>;
  connectedKey: string;
  required?: boolean;
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    name: "Jira",
    testKey: "jira",
    description: "Automatically create tickets from approved product briefs.",
    icon: Ticket,
    connectedKey: "jiraConnected",
    required: true,
    fields: [
      {
        key: "jiraBaseUrl",
        label: "Jira URL",
        placeholder: "https://your-team.atlassian.net",
        helpText: "Your Jira instance URL",
      },
      {
        key: "jiraEmail",
        label: "Email",
        placeholder: "you@company.com",
        helpText: "The email associated with your Jira account",
      },
      {
        key: "jiraApiToken",
        label: "API Token",
        placeholder: "Enter your Jira API token",
        type: "password",
        helpText: "Generate a token from your Atlassian account settings",
        helpUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
      },
    ],
  },
  {
    name: "Google Chat",
    testKey: "gchat",
    description: "Get updates and answer questions from your AI team via Google Chat.",
    icon: MessageSquare,
    connectedKey: "gchatConnected",
    fields: [
      {
        key: "gchatWebhookUrl",
        label: "Webhook URL",
        placeholder: "https://chat.googleapis.com/v1/spaces/...",
        helpText: "Create an incoming webhook in your Google Chat space",
        helpUrl: "https://developers.google.com/chat/how-tos/webhooks",
      },
    ],
  },
  {
    name: "Google Docs",
    testKey: "gdocs",
    description: "Automatically save product briefs to Google Docs for easy sharing.",
    icon: FileText,
    connectedKey: "googleDocsConnected",
    fields: [
      {
        key: "googleServiceAccountKey",
        label: "Service Account Key (JSON)",
        placeholder: '{"type": "service_account", ...}',
        helpText: "Paste the full JSON key from Google Cloud Console",
        helpUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
      },
      {
        key: "googleDriveFolderId",
        label: "Drive Folder ID",
        placeholder: "Folder ID from Google Drive URL",
        helpText: "The folder where briefs will be saved",
      },
    ],
  },
  {
    name: "Slack",
    testKey: "slack",
    description: "Send notifications and updates to your team's Slack channels.",
    icon: Hash,
    connectedKey: "slackConnected",
    fields: [
      {
        key: "slackBotToken",
        label: "Bot Token",
        placeholder: "xoxb-...",
        type: "password",
        helpText: "Create a Slack app and install it to your workspace to get a bot token",
        helpUrl: "https://api.slack.com/apps",
      },
      {
        key: "slackDefaultChannel",
        label: "Default Channel",
        placeholder: "#general or C01ABCDEFGH",
        helpText: "Channel where notifications are sent by default",
      },
    ],
  },
  {
    name: "Twilio Voice Dial-In",
    testKey: "twilio",
    description: "AI joins your calls via phone and participates in real-time — transcribing, capturing requirements, and asking clarifying questions.",
    icon: Phone,
    connectedKey: "twilioConnected",
    fields: [
      {
        key: "twilioAccountSid",
        label: "Account SID",
        placeholder: "AC...",
        type: "password",
        helpText: "Find this on your Twilio Console dashboard",
        helpUrl: "https://console.twilio.com/",
      },
      {
        key: "twilioAuthToken",
        label: "Auth Token",
        placeholder: "Enter your Twilio auth token",
        type: "password",
        helpText: "Found next to your Account SID on the Console",
      },
      {
        key: "twilioPhoneNumber",
        label: "Phone Number",
        placeholder: "+1234567890",
        helpText: "Your Twilio phone number the AI dials in from (must be a voice-capable number)",
        helpUrl: "https://console.twilio.com/us1/develop/phone-numbers/manage/active",
      },
    ],
  },
  {
    name: "GitHub",
    testKey: "github",
    description: "Connect your code repository so your AI dev agent can create PRs.",
    icon: GitPullRequest,
    connectedKey: "githubConnected",
    fields: [
      {
        key: "githubToken",
        label: "Personal Access Token",
        placeholder: "ghp_...",
        type: "password",
        helpText: "Generate a fine-grained token with repo access",
        helpUrl: "https://github.com/settings/tokens?type=beta",
      },
      {
        key: "githubOwner",
        label: "Owner / Organization",
        placeholder: "your-org",
        helpText: "The GitHub user or organization that owns the repo",
      },
      {
        key: "githubRepo",
        label: "Repository",
        placeholder: "your-repo",
        helpText: "The repository your AI team will work in",
      },
    ],
  },
  {
    name: "SendGrid",
    testKey: "sendgrid",
    description: "Send email notifications and reports to your team.",
    icon: Mail,
    connectedKey: "sendgridConnected",
    fields: [
      {
        key: "sendgridApiKey",
        label: "API Key",
        placeholder: "SG...",
        type: "password",
        helpText: "Create an API key with Mail Send permissions",
        helpUrl: "https://app.sendgrid.com/settings/api_keys",
      },
      {
        key: "emailFrom",
        label: "From Email",
        placeholder: "notifications@yourcompany.com",
        helpText: "Must be a verified sender in your SendGrid account",
      },
    ],
  },
  {
    name: "Microsoft Teams",
    testKey: "teams",
    description: "Get updates and alerts in your Teams channels.",
    icon: Users,
    connectedKey: "teamsConnected",
    fields: [
      {
        key: "teamsWebhookUrl",
        label: "Incoming Webhook URL",
        placeholder: "https://...webhook.office.com/...",
        helpText: "Create an incoming webhook connector in your Teams channel",
        helpUrl: "https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook",
      },
    ],
  },
];

/**
 * Platform-level integrations (super admin only).
 * These power the AI engine and storage — shared across all users.
 */
const PLATFORM_INTEGRATIONS: IntegrationConfig[] = [
  {
    name: "OpenAI",
    testKey: "openai",
    description: "Powers meeting transcription (Whisper) and AI analysis. Required for transcription to work.",
    icon: Brain,
    connectedKey: "openaiConnected",
    required: true,
    fields: [
      {
        key: "openaiApiKey",
        label: "API Key",
        placeholder: "sk-...",
        type: "password",
        helpText: "Get your API key from the OpenAI dashboard",
        helpUrl: "https://platform.openai.com/api-keys",
      },
    ],
  },
  {
    name: "Google AI (Gemini)",
    testKey: "gemini",
    description: "Powers AI agents — Business Analyst, Dev Agent, QA Agent. Required for brief generation.",
    icon: Cpu,
    connectedKey: "geminiConnected",
    required: true,
    fields: [
      {
        key: "geminiApiKey",
        label: "API Key",
        placeholder: "AI...",
        type: "password",
        helpText: "Get your API key from Google AI Studio",
        helpUrl: "https://aistudio.google.com/apikey",
      },
    ],
  },
  {
    name: "AWS S3",
    testKey: "s3",
    description: "Stores meeting audio recordings for transcription. Required for upload and Google Meet ingestion.",
    icon: Cloud,
    connectedKey: "s3Connected",
    required: true,
    fields: [
      {
        key: "awsS3Bucket",
        label: "Bucket Name",
        placeholder: "my-company-meetings",
        helpText: "The S3 bucket where audio files will be stored",
      },
      {
        key: "awsS3Region",
        label: "Region",
        placeholder: "us-east-1",
        helpText: "AWS region where your bucket is located",
      },
      {
        key: "awsAccessKeyId",
        label: "Access Key ID",
        placeholder: "AKIA...",
        type: "password",
        helpText: "IAM user access key with S3 PutObject/GetObject permissions",
        helpUrl: "https://console.aws.amazon.com/iam/",
      },
      {
        key: "awsSecretAccessKey",
        label: "Secret Access Key",
        placeholder: "Enter your AWS secret key",
        type: "password",
        helpText: "Found alongside the Access Key ID",
      },
    ],
  },
  {
    name: "Google OAuth App",
    testKey: "google_oauth",
    description: "Allows users to connect their Google accounts for automatic Meet recording detection.",
    icon: Key,
    connectedKey: "googleOAuthAppConnected",
    fields: [
      {
        key: "googleClientId",
        label: "Client ID",
        placeholder: "123456789.apps.googleusercontent.com",
        helpText: "Create an OAuth 2.0 Client ID in Google Cloud Console",
        helpUrl: "https://console.cloud.google.com/apis/credentials",
      },
      {
        key: "googleClientSecret",
        label: "Client Secret",
        placeholder: "GOCSPX-...",
        type: "password",
        helpText: "Found on the OAuth Client credentials page",
      },
      {
        key: "googleRedirectUri",
        label: "Redirect URI",
        placeholder: "https://your-domain.com/api/integrations/google/callback",
        helpText: "Must match exactly what you set in Google Cloud Console",
      },
    ],
  },
];

interface NotificationItem {
  key: string;
  label: string;
  desc: string;
}

const NOTIFICATION_ITEMS: NotificationItem[] = [
  { key: "notifyOnMeetingEnd", label: "Meeting completed", desc: "When a meeting ends and transcript is ready" },
  { key: "notifyOnPrdGenerated", label: "Brief generated", desc: "When a new brief is created from a meeting" },
  { key: "notifyOnApprovalNeeded", label: "Approval needed", desc: "When a brief needs your review and approval" },
  { key: "notifyOnTicketsCreated", label: "Jira tickets created", desc: "When tickets are synced to Jira" },
  { key: "notifyOnAgentErrors", label: "System issues", desc: "When something fails or needs your attention" },
];

export default function SettingsPage() {
  const toast = useToast();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const [integrationValues, setIntegrationValues] = useState<Record<string, string>>({});
  const [connectedState, setConnectedState] = useState<Record<string, boolean>>({});
  const [maskedFields, setMaskedFields] = useState<Set<string>>(new Set());

  const [notifications, setNotifications] = useState<Record<string, boolean>>({});

  const [accountName, setAccountName] = useState("");
  const [accountOrg, setAccountOrg] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountTenantId, setAccountTenantId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<Array<{
    id: string; action: string; resource: string; resourceId?: string;
    userId?: string; before?: unknown; after?: unknown;
    ipAddress?: string; createdAt: string;
  }>>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilter, setAuditFilter] = useState("");

  // Webhooks state
  const [webhooks, setWebhooks] = useState<Array<{
    id: string; url: string; events: string[]; active: boolean;
    description?: string; createdAt: string;
  }>>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [webhookDesc, setWebhookDesc] = useState("");
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  // Google Meet OAuth state
  const [googleStatus, setGoogleStatus] = useState<{ available: boolean; connected: boolean; email?: string } | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleStatusLoading, setGoogleStatusLoading] = useState(true);

  // AI Agent state
  const [agentConnected, setAgentConnected] = useState(false);
  const [checkingAgent, setCheckingAgent] = useState(true);

  // Spending cap state
  const [spendingCap, setSpendingCap] = useState<string>("");
  const [currentSpend, setCurrentSpend] = useState(0);
  const [percentUsed, setPercentUsed] = useState(0);
  const [savingCap, setSavingCap] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const currentUser = getUser();
      const res = await api.getSettings();
      if (res.data) {
        const { account, integrations, notifications: notifs, spending } = res.data;

        // Spending cap
        if (spending) {
          setCurrentSpend(spending.currentSpend ?? 0);
          setPercentUsed(spending.percentUsed ?? 0);
          setSpendingCap(spending.monthlyCap != null ? String(spending.monthlyCap) : "");
        }

        setAccountName(account.name);
        setAccountOrg(account.organizationName);
        setAccountEmail(account.email);
        setAccountTenantId(currentUser?.tenantId || "");

        const vals: Record<string, string> = {};
        const connected: Record<string, boolean> = {};
        const masked = new Set<string>();
        const sensitiveKeys = new Set(
          INTEGRATIONS.flatMap((i) => i.fields.filter((f) => f.type === "password").map((f) => f.key))
        );
        for (const [key, val] of Object.entries(integrations)) {
          if (typeof val === "string") {
            if (sensitiveKeys.has(key) && val.startsWith("****")) {
              vals[key] = "";
              masked.add(key);
            } else {
              vals[key] = val;
            }
          }
          if (typeof val === "boolean") connected[key] = val;
        }
        setIntegrationValues(vals);
        setMaskedFields(masked);
        setConnectedState(connected);

        const notifVals: Record<string, boolean> = {};
        for (const [key, val] of Object.entries(notifs)) {
          notifVals[key] = val as boolean;
        }
        setNotifications(notifVals);
      }
    } catch {
      setLoadError("Unable to load settings. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUser(getUser());
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Load Google Meet connection status and handle OAuth callback redirect
  useEffect(() => {
    api.getGoogleStatus().then((res) => {
      if (res.data) setGoogleStatus(res.data);
    }).catch(() => {}).finally(() => setGoogleStatusLoading(false));

    // Check for OAuth callback query params (?google=connected or ?google=error)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const googleParam = params.get("google");
      if (googleParam === "connected") {
        toast.success("Google account connected", "Your Google Meet integration is now active.");
        // Refresh status after successful OAuth
        api.getGoogleStatus().then((res) => {
          if (res.data) setGoogleStatus(res.data);
        }).catch(() => {});
        // Clean URL params
        window.history.replaceState({}, "", window.location.pathname);
      } else if (googleParam === "error") {
        toast.error("Google connection failed", "Unable to connect your Google account. Please try again.");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.getAgentStatus()
      .then((res) => {
        setAgentConnected((res.data?.connected || 0) > 0);
        setCheckingAgent(false);
      })
      .catch(() => setCheckingAgent(false));
  }, []);

  async function handleGoogleConnect() {
    setGoogleLoading(true);
    try {
      const res = await api.getGoogleAuthUrl();
      if (res.data?.authUrl) {
        window.location.href = res.data.authUrl;
      } else {
        toast.error("Unable to start Google sign-in", "Could not get authorization URL.");
      }
    } catch (err) {
      toast.error("Connection failed", (err as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleGoogleDisconnect() {
    setGoogleLoading(true);
    try {
      await api.disconnectGoogle();
      setGoogleStatus({ available: true, connected: false });
      toast.success("Google account disconnected");
    } catch (err) {
      toast.error("Disconnect failed", (err as Error).message);
    } finally {
      setGoogleLoading(false);
    }
  }

  function setFieldValue(key: string, value: string) {
    setIntegrationValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveIntegration(integration: IntegrationConfig) {
    setSaving(integration.name);
    try {
      const data: Record<string, string> = {};
      for (const field of integration.fields) {
        const val = integrationValues[field.key];
        if (val !== undefined) data[field.key] = val;
      }

      await api.updateIntegrations(data);

      setTesting(integration.name);
      const testRes = await api.testIntegration(integration.testKey);
      if (testRes.data) {
        setConnectedState((prev) => ({ ...prev, [integration.connectedKey]: testRes.data!.connected }));
        if (testRes.data.connected) {
          toast.success(`${integration.name} connected`, testRes.data.message);
        } else {
          toast.warning(`${integration.name} not connected`, testRes.data.message);
        }
      }
    } catch (err) {
      toast.error("Save failed", (err as Error).message);
    } finally {
      setSaving(null);
      setTesting(null);
    }
  }

  async function handleDisconnect(integration: IntegrationConfig) {
    setSaving(integration.name);
    try {
      const data: Record<string, string> = {};
      for (const field of integration.fields) {
        data[field.key] = "";
      }
      await api.updateIntegrations(data);
      setConnectedState((prev) => ({ ...prev, [integration.connectedKey]: false }));
      for (const field of integration.fields) {
        setFieldValue(field.key, "");
      }
      toast.success(`${integration.name} disconnected`);
    } catch (err) {
      toast.error("Disconnect failed", (err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function handleNotificationToggle(key: string, value: boolean) {
    setNotifications((prev) => ({ ...prev, [key]: value }));
    try {
      await api.updateNotifications({ [key]: value });
    } catch {
      setNotifications((prev) => ({ ...prev, [key]: !value }));
      toast.error("Failed to update notification preference");
    }
  }

  async function handleSaveAccount() {
    setSaving("account");
    try {
      await api.updateAccount({ name: accountName, organizationName: accountOrg });
      toast.success("Account updated");
    } catch (err) {
      toast.error("Save failed", (err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveSpendingCap() {
    setSavingCap(true);
    try {
      const cap = spendingCap.trim() === "" ? null : parseFloat(spendingCap);
      if (cap !== null && (isNaN(cap) || cap < 0)) {
        toast.error("Invalid amount", "Enter a positive number or leave blank for no cap.");
        return;
      }
      const res = await api.updateSpendingCap(cap);
      if (res.data) {
        setCurrentSpend(res.data.currentSpend);
        setPercentUsed(res.data.percentUsed);
        setSpendingCap(res.data.monthlyCap != null ? String(res.data.monthlyCap) : "");
      }
      toast.success(cap ? `Spending cap set to $${cap}/mo` : "Spending cap removed");
    } catch (err) {
      toast.error("Save failed", (err as Error).message);
    } finally {
      setSavingCap(false);
    }
  }

  const isAdmin = user?.role === "owner" || user?.role === "admin";

  async function loadWebhooks() {
    setWebhooksLoading(true);
    try {
      const res = await api.getWebhooks();
      if (res.data) setWebhooks(res.data);
    } catch {
      // Ignore
    } finally {
      setWebhooksLoading(false);
    }
  }

  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl || webhookEvents.length === 0) return;
    setCreatingWebhook(true);
    try {
      const res = await api.createWebhook({ url: webhookUrl, events: webhookEvents, description: webhookDesc || undefined });
      if (res.data) {
        setWebhookSecret(res.data.secret);
        setWebhookUrl("");
        setWebhookEvents([]);
        setWebhookDesc("");
        await loadWebhooks();
        toast.success("Webhook created", "Copy the signing secret — it won't be shown again.");
      }
    } catch (err) {
      toast.error("Failed to create webhook", (err as Error).message);
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function handleDeleteWebhook(id: string) {
    try {
      await api.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      toast.success("Webhook deleted");
    } catch {
      toast.error("Failed to delete webhook");
    }
  }

  async function handleToggleWebhook(id: string, active: boolean) {
    try {
      await api.updateWebhook(id, { active: !active });
      setWebhooks((prev) => prev.map((w) => w.id === id ? { ...w, active: !active } : w));
    } catch {
      toast.error("Failed to update webhook");
    }
  }

  async function handleTestWebhook(id: string) {
    try {
      await api.testWebhook(id);
      toast.success("Test event sent");
    } catch {
      toast.error("Test failed");
    }
  }

  async function loadAuditLog(filter?: string) {
    setAuditLoading(true);
    try {
      const res = await api.getAuditLog({
        action: filter || undefined,
        limit: 50,
      });
      if (res.data) {
        setAuditEntries(res.data);
        setAuditTotal((res.meta as Record<string, number>)?.total ?? res.data.length);
      }
    } catch {
      // Non-admin users will get 403 — silently ignore
    } finally {
      setAuditLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header title="Settings" />
        <div className="p-6 lg:p-8 max-w-5xl space-y-4">
          <div className="skeleton h-10 w-80" />
          <div className="skeleton h-48" />
          <div className="skeleton h-48" />
          <div className="skeleton h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header title="Settings" />

      <div className="max-w-5xl space-y-8 p-6 lg:p-8">
        <div className="space-y-2">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-ink">
            Settings
          </h2>
          <p className="max-w-[60ch] text-sm text-ink-secondary">
            Integrations, notifications, account details, and platform keys —
            all in one place.
          </p>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-amber/25 bg-amber-light p-4 text-sm text-amber">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">Warning:</span> {loadError}
            </span>
          </div>
        )}
        <Tabs defaultValue="integrations">
          <TabsList className="mb-6">
            <TabsTrigger value="integrations">
              <Plug className="w-4 h-4 mr-1.5" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="w-4 h-4 mr-1.5" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="account">
              <Shield className="w-4 h-4 mr-1.5" />
              Account
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="audit" onClick={() => { if (auditEntries.length === 0) loadAuditLog(); }}>
                <ScrollText className="w-4 h-4 mr-1.5" />
                Audit Log
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="webhooks" onClick={() => { if (webhooks.length === 0 && !webhooksLoading) loadWebhooks(); }}>
                <Plug className="w-4 h-4 mr-1.5" />
                Webhooks
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="platform">
                <Key className="w-4 h-4 mr-1.5" />
                Platform
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="integrations" className="space-y-4 animate-fade-in">
            <div>
              <h2 className="text-lg font-semibold text-ink">Required to Get Started</h2>
              <p className="text-sm text-ink-tertiary mt-1">
                Connect these first to start using your AI team.
              </p>
            </div>

            {INTEGRATIONS.filter((i) => i.required).map((integration) => {
              const isConnected = connectedState[integration.connectedKey] ?? false;
              const isSaving = saving === integration.name;
              const isTesting = testing === integration.name;

              return (
                <Card key={integration.name}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-surface-sunken">
                          <integration.icon className="w-5 h-5 text-ink-secondary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base">{integration.name}</CardTitle>
                            {isConnected ? (
                              <Badge variant="success">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Connected
                              </Badge>
                            ) : (
                              <Badge variant="default">
                                <XCircle className="w-3 h-3 mr-1" />
                                Not Connected
                              </Badge>
                            )}
                          </div>
                          <CardDescription className="mt-1">{integration.description}</CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {integration.fields.map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label htmlFor={`field-${field.key}`} className="text-sm font-medium text-ink-secondary">{field.label}</label>
                          {field.helpUrl && (
                            <a
                              href={field.helpUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-accent hover:underline flex items-center gap-1"
                            >
                              Get {field.label}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <Input
                          id={`field-${field.key}`}
                          type={field.type || "text"}
                          placeholder={maskedFields.has(field.key) ? "Enter new value to change" : field.placeholder}
                          value={integrationValues[field.key] || ""}
                          onChange={(e) => setFieldValue(field.key, e.target.value)}
                        />
                        {field.helpText && (
                          <p className="text-xs text-ink-faint flex items-center gap-1">
                            <HelpCircle className="w-3 h-3" />
                            {field.helpText}
                          </p>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        size="sm"
                        disabled={isSaving}
                        onClick={() => handleSaveIntegration(integration)}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {isTesting ? "Testing..." : "Saving..."}
                          </>
                        ) : (
                          "Save & Test Connection"
                        )}
                      </Button>
                      {isConnected && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => handleDisconnect(integration)}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Google Meet — OAuth-based integration (not API key) */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-surface-sunken">
                      <Video className="w-5 h-5 text-ink-secondary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">Google Meet</CardTitle>
                        {googleStatusLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-ink-faint" />
                        ) : googleStatus?.connected ? (
                          <Badge variant="success">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Connected
                          </Badge>
                        ) : googleStatus && !googleStatus.available ? (
                          <Badge variant="default">
                            <XCircle className="w-3 h-3 mr-1" />
                            Not Configured
                          </Badge>
                        ) : (
                          <Badge variant="default">
                            <XCircle className="w-3 h-3 mr-1" />
                            Not Connected
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="mt-1">
                        Connect your Google account to automatically detect and import Google Meet recordings.
                      </CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {googleStatusLoading ? (
                  <div className="flex items-center gap-2 text-sm text-ink-faint">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking connection status...
                  </div>
                ) : googleStatus?.connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-ink-secondary">
                      <CheckCircle className="w-4 h-4 text-emerald" />
                      <span>
                        Connected as <span className="font-medium text-ink">{googleStatus.email}</span>
                      </span>
                    </div>
                    <p className="text-xs text-ink-faint">
                      Your Google Drive is being monitored for new Meet recordings. They will be automatically imported and transcribed.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={googleLoading}
                      onClick={handleGoogleDisconnect}
                    >
                      {googleLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Disconnecting...
                        </>
                      ) : (
                        "Disconnect"
                      )}
                    </Button>
                  </div>
                ) : googleStatus && !googleStatus.available ? (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-tertiary">
                      Google Meet integration is not configured on this instance.
                    </p>
                    <p className="text-xs text-ink-faint flex items-center gap-1">
                      <HelpCircle className="w-3 h-3" />
                      Your administrator needs to set up Google OAuth credentials under the Platform tab to enable this feature.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-ink-tertiary">
                      Sign in with Google to allow your AI team to automatically detect and import Google Meet recordings from your Drive.
                    </p>
                    <Button
                      size="sm"
                      disabled={googleLoading}
                      onClick={handleGoogleConnect}
                    >
                      {googleLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Redirecting to Google...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                          </svg>
                          Connect Google Meet
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="pt-4">
              <h2 className="text-lg font-semibold text-ink">Optional Integrations</h2>
              <p className="text-sm text-ink-tertiary mt-1">
                Enhance your AI team with additional tools and notification channels.
              </p>
            </div>

            {INTEGRATIONS.filter((i) => !i.required).map((integration) => {
              const isConnected = connectedState[integration.connectedKey] ?? false;
              const isSaving = saving === integration.name;
              const isTesting = testing === integration.name;

              return (
                <Card key={integration.name}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-surface-sunken">
                          <integration.icon className="w-5 h-5 text-ink-secondary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base">{integration.name}</CardTitle>
                            {isConnected ? (
                              <Badge variant="success">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Connected
                              </Badge>
                            ) : (
                              <Badge variant="default">
                                <XCircle className="w-3 h-3 mr-1" />
                                Not Connected
                              </Badge>
                            )}
                          </div>
                          <CardDescription className="mt-1">{integration.description}</CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {integration.fields.map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label htmlFor={`field-${field.key}`} className="text-sm font-medium text-ink-secondary">{field.label}</label>
                          {field.helpUrl && (
                            <a
                              href={field.helpUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-accent hover:underline flex items-center gap-1"
                            >
                              Get {field.label}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <Input
                          id={`field-${field.key}`}
                          type={field.type || "text"}
                          placeholder={maskedFields.has(field.key) ? "Enter new value to change" : field.placeholder}
                          value={integrationValues[field.key] || ""}
                          onChange={(e) => setFieldValue(field.key, e.target.value)}
                        />
                        {field.helpText && (
                          <p className="text-xs text-ink-faint flex items-center gap-1">
                            <HelpCircle className="w-3 h-3" />
                            {field.helpText}
                          </p>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        size="sm"
                        disabled={isSaving}
                        onClick={() => handleSaveIntegration(integration)}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {isTesting ? "Testing..." : "Saving..."}
                          </>
                        ) : (
                          "Save & Test Connection"
                        )}
                      </Button>
                      {isConnected && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => handleDisconnect(integration)}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* AI Agent Section */}
            <div className="pt-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">AI Agent</h2>
                <p className="text-sm text-ink-tertiary">
                  Connect an AI agent to automatically build features from approved briefs.
                </p>
              </div>

              {checkingAgent ? (
                <Card>
                  <CardContent className="p-8 flex justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-ink-faint" />
                  </CardContent>
                </Card>
              ) : agentConnected ? (
                <AgentDashboard onDisconnected={() => setAgentConnected(false)} />
              ) : (
                <AgentSetupWizard onAgentConnected={() => setAgentConnected(true)} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-4 animate-fade-in">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notification Preferences</CardTitle>
                <CardDescription>Choose when and how you receive notifications.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {NOTIFICATION_ITEMS.map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-2">
                    <div>
                      <label htmlFor={`notif-${item.key}`} className="text-sm font-medium text-ink cursor-pointer">{item.label}</label>
                      <p className="text-xs text-ink-tertiary">{item.desc}</p>
                    </div>
                    <label htmlFor={`notif-${item.key}`} className="relative inline-flex items-center cursor-pointer">
                      <input
                        id={`notif-${item.key}`}
                        type="checkbox"
                        checked={notifications[item.key] ?? true}
                        onChange={(e) => handleNotificationToggle(item.key, e.target.checked)}
                        className="sr-only peer"
                        aria-label={item.label}
                      />
                      <div className="w-9 h-5 bg-ink-faint peer-focus:ring-2 peer-focus:ring-accent/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ink-faint after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent" />
                    </label>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="account" className="space-y-4 animate-fade-in">
            {/* Spending Cap */}
            {isAdmin && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-accent" />
                    Monthly Spending Cap
                  </CardTitle>
                  <CardDescription>
                    Set a maximum monthly budget for AI usage. Agents will pause when the cap is reached.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Current usage bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink-secondary">Current month spend</span>
                      <span className="font-semibold text-ink">
                        ${currentSpend.toFixed(2)}
                        {spendingCap && ` / $${parseFloat(spendingCap).toFixed(2)}`}
                      </span>
                    </div>
                    {spendingCap && (
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-border"
                        role="progressbar"
                        aria-valuenow={Math.min(percentUsed, 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-[420ms] ${
                            percentUsed >= 90
                              ? "bg-rose"
                              : percentUsed >= 70
                                ? "bg-amber"
                                : "bg-[var(--color-emerald)]"
                          }`}
                          style={{ width: `${Math.min(percentUsed, 100)}%` }}
                        />
                      </div>
                    )}
                    {percentUsed >= 80 && spendingCap && (
                      <div className="flex items-center gap-2 text-xs text-amber">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {percentUsed >= 100
                          ? "Spending cap reached — agents are paused"
                          : `${percentUsed.toFixed(0)}% of budget used`}
                      </div>
                    )}
                  </div>

                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label htmlFor="spending-cap" className="text-sm font-medium text-ink-secondary">
                        Monthly cap (USD)
                      </label>
                      <Input
                        id="spending-cap"
                        type="number"
                        min="0"
                        step="10"
                        placeholder="No limit"
                        value={spendingCap}
                        onChange={(e) => setSpendingCap(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <Button
                      size="sm"
                      disabled={savingCap}
                      onClick={handleSaveSpendingCap}
                    >
                      {savingCap ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Save Cap"
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-ink-faint">
                    Leave blank for no limit. Common values: $50 (starter), $200 (team), $1000 (business).
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Account Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="account-name" className="text-sm font-medium text-ink-secondary">Name</label>
                    <Input
                      id="account-name"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label htmlFor="account-org" className="text-sm font-medium text-ink-secondary">Organization</label>
                    <Input
                      id="account-org"
                      value={accountOrg}
                      onChange={(e) => setAccountOrg(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label htmlFor="account-email" className="text-sm font-medium text-ink-secondary">Email</label>
                    <Input id="account-email" value={accountEmail} className="mt-1" disabled />
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={saving === "account"}
                  onClick={handleSaveAccount}
                >
                  {saving === "account" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="audit" className="space-y-4 animate-fade-in">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Audit Log</CardTitle>
                      <CardDescription>Track who changed what and when. {auditTotal > 0 && `${auditTotal} total entries.`}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Filter by action..."
                        value={auditFilter}
                        onChange={(e) => setAuditFilter(e.target.value)}
                        className="w-48 h-8 text-xs"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadAuditLog(auditFilter)}
                        disabled={auditLoading}
                      >
                        {auditLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {auditLoading && auditEntries.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-ink-tertiary text-sm">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading audit log...
                    </div>
                  ) : auditEntries.length === 0 ? (
                    <div className="text-center py-8 text-ink-tertiary text-sm">
                      No audit entries yet. Actions like settings changes, PRD approvals, and logins will appear here.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {auditEntries.map((entry) => (
                        <div key={entry.id} className="py-3 flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={
                                entry.action.includes("approve") ? "success" :
                                entry.action.includes("reject") ? "error" :
                                entry.action.includes("login") || entry.action.includes("signup") ? "info" :
                                "default"
                              }>
                                {entry.action}
                              </Badge>
                              <span className="text-xs text-ink-faint">{entry.resource}</span>
                              {entry.resourceId && (
                                <span className="text-xs text-ink-faint truncate max-w-[120px]" title={entry.resourceId}>
                                  {entry.resourceId}
                                </span>
                              )}
                            </div>
                            {entry.after != null && (
                              <p className="text-xs text-ink-tertiary mt-1 truncate">
                                {typeof entry.after === "string" ? entry.after : JSON.stringify(entry.after as Record<string, unknown>)}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-ink-faint">
                              {new Date(entry.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </p>
                            <p className="text-xs text-ink-faint">
                              {new Date(entry.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="webhooks" className="space-y-4 animate-fade-in">
              {/* Create Webhook Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Create Webhook Endpoint</CardTitle>
                  <CardDescription>Receive HTTP callbacks when events happen in your workspace.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateWebhook} className="space-y-3">
                    <Input
                      placeholder="https://your-server.com/webhook"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      required
                    />
                    <Input
                      placeholder="Description (optional)"
                      value={webhookDesc}
                      onChange={(e) => setWebhookDesc(e.target.value)}
                    />
                    <div>
                      <p className="text-xs font-medium text-ink-tertiary mb-2">Events to subscribe to:</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          "meeting.completed", "meeting.failed", "prd.generated",
                          "prd.approved", "prd.rejected", "tickets.created",
                          "engagement.phase_changed", "clarification.requested",
                        ].map((evt) => (
                          <Badge
                            key={evt}
                            variant={webhookEvents.includes(evt) ? "purple" : "default"}
                            className="cursor-pointer select-none"
                            onClick={() =>
                              setWebhookEvents((prev) =>
                                prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]
                              )
                            }
                          >
                            {evt}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" type="submit" disabled={creatingWebhook || !webhookUrl || webhookEvents.length === 0}>
                      {creatingWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Webhook"}
                    </Button>
                  </form>

                  {webhookSecret && (
                    <div className="mt-4 p-3 bg-emerald-light rounded-lg">
                      <p className="text-xs font-medium text-emerald mb-1">Signing Secret (copy now — won&apos;t be shown again):</p>
                      <code className="text-xs font-mono text-ink break-all">{webhookSecret}</code>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Existing Webhooks */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Active Endpoints</CardTitle>
                </CardHeader>
                <CardContent>
                  {webhooksLoading ? (
                    <div className="flex items-center justify-center py-8 text-ink-tertiary text-sm">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading webhooks...
                    </div>
                  ) : webhooks.length === 0 ? (
                    <p className="text-sm text-ink-tertiary text-center py-8">No webhook endpoints configured yet.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {webhooks.map((wh) => (
                        <div key={wh.id} className="py-3 flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={wh.active ? "success" : "default"}>
                                {wh.active ? "Active" : "Paused"}
                              </Badge>
                              <span className="text-sm font-mono text-ink-secondary truncate">{wh.url}</span>
                            </div>
                            {wh.description && <p className="text-xs text-ink-tertiary">{wh.description}</p>}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {wh.events.map((evt) => (
                                <Badge key={evt} variant="default" className="text-[10px]">{evt}</Badge>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button variant="ghost" size="sm" onClick={() => handleTestWebhook(wh.id)} title="Send test event">
                              Test
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleWebhook(wh.id, wh.active)}
                            >
                              {wh.active ? "Pause" : "Resume"}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-rose" onClick={() => handleDeleteWebhook(wh.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="platform" className="space-y-6 animate-fade-in">
              <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-amber/25 bg-amber-light p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Platform configuration
                  </p>
                  <p className="mt-0.5 text-sm text-ink-secondary">
                    These settings power the AI engine and storage for your
                    entire workspace. Only admins can change them.
                  </p>
                </div>
              </div>

              {PLATFORM_INTEGRATIONS.map((integration) => {
                const Icon = integration.icon;
                const connected = connectedState[integration.connectedKey];
                const isSaving = saving === integration.name;
                const isTesting = testing === integration.name;

                return (
                  <Card key={integration.testKey}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${connected ? "bg-emerald-light" : "bg-surface-sunken"}`}>
                            <Icon className={`w-5 h-5 ${connected ? "text-emerald" : "text-ink-tertiary"}`} />
                          </div>
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {integration.name}
                              {integration.required && <Badge variant="warning">Required</Badge>}
                              {connected ? (
                                <Badge variant="success">Connected</Badge>
                              ) : (
                                <Badge variant="default">Not Connected</Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="mt-0.5">{integration.description}</CardDescription>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {integration.fields.map((field) => (
                        <div key={field.key} className="space-y-1.5">
                          <label className="text-sm font-medium text-ink-secondary flex items-center gap-1.5">
                            {field.label}
                            {field.helpUrl && (
                              <a href={field.helpUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </label>
                          <Input
                            type={field.type === "password" && maskedFields.has(field.key) ? "password" : "text"}
                            placeholder={field.placeholder}
                            value={integrationValues[field.key] || ""}
                            onChange={(e) => setFieldValue(field.key, e.target.value)}
                          />
                          {field.helpText && (
                            <p className="text-xs text-ink-faint flex items-center gap-1">
                              <HelpCircle className="w-3 h-3" />
                              {field.helpText}
                            </p>
                          )}
                        </div>
                      ))}
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          disabled={isSaving}
                          onClick={() => handleSaveIntegration(integration)}
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              {isTesting ? "Testing..." : "Saving..."}
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4" />
                              Save & Test
                            </>
                          )}
                        </Button>
                        {connected && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDisconnect(integration)}
                          >
                            <XCircle className="w-4 h-4" />
                            Disconnect
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
