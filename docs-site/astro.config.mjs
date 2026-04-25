import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://workforce0.com",
  integrations: [
    starlight({
      title: "Workforce0",
      description:
        "Self-hosted AI workforce — BYOK, open-source. Meetings in, shipped work out.",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/workforce0/workforce0",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/workforce0/workforce0/edit/main/docs-site/",
      },
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
      expressiveCode: {
        themes: ["github-dark", "github-light"],
      },
      components: {
        // Slot overrides can go here later.
      },
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Quickstart (5 min)", slug: "getting-started/quickstart" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Your first brief", slug: "getting-started/first-brief" },
          ],
        },
        {
          label: "Usage",
          items: [
            { label: "Overview", slug: "usage/overview" },
            { label: "Uploading meetings", slug: "usage/meetings" },
            { label: "Voice dial-in", slug: "usage/voice" },
            { label: "Approvals in Slack", slug: "usage/approvals" },
            { label: "Projects & goals", slug: "usage/projects" },
            { label: "Daily workflow", slug: "usage/daily-workflow" },
          ],
        },
        {
          label: "Self-hosting",
          items: [
            { label: "Docker Compose", slug: "self-hosting/docker-compose" },
            { label: "Kubernetes", slug: "self-hosting/kubernetes" },
            { label: "Cloud platforms", slug: "self-hosting/cloud-platforms" },
            { label: "Environment variables", slug: "self-hosting/env-vars" },
            { label: "Security checklist", slug: "self-hosting/security" },
            { label: "Backups & restore", slug: "self-hosting/backups" },
            { label: "Observability", slug: "self-hosting/observability" },
          ],
        },
        {
          label: "BYOK (bring your own keys)",
          items: [
            { label: "Overview", slug: "byok/overview" },
            { label: "Anthropic (Claude)", slug: "byok/anthropic" },
            { label: "OpenAI (GPT)", slug: "byok/openai" },
            { label: "Google (Gemini)", slug: "byok/google" },
            { label: "Local models (Ollama)", slug: "byok/local-ollama" },
            { label: "Cost caps", slug: "byok/cost-caps" },
          ],
        },
        {
          label: "Integrations",
          items: [
            { label: "Jira", slug: "integrations/jira" },
            { label: "Google Chat", slug: "integrations/google-chat" },
            { label: "Google Drive", slug: "integrations/google-drive" },
            { label: "Slack", slug: "integrations/slack" },
            { label: "GitHub", slug: "integrations/github" },
            { label: "Twilio (voice)", slug: "integrations/twilio" },
            { label: "WhatsApp", slug: "integrations/whatsapp" },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "AI Council", slug: "features/ai-council" },
            { label: "Chief of Staff", slug: "features/chief-of-staff" },
            { label: "Specialist agents", slug: "features/specialist-agents" },
            { label: "Project Graph", slug: "features/project-graph" },
            { label: "Voice & meetings", slug: "features/voice-meetings" },
            { label: "Brief generation", slug: "features/brief-generation" },
            { label: "Ticket orchestration", slug: "features/ticket-orchestration" },
            { label: "Skills & subagents", slug: "features/skills-subagents" },
            { label: "Audit & approvals", slug: "features/audit-approvals" },
            { label: "Metric harness", slug: "features/metric-harness" },
          ],
        },
        {
          label: "Technical architecture",
          items: [
            { label: "System overview", slug: "architecture/overview" },
            { label: "Backend (Fastify + Prisma)", slug: "architecture/backend" },
            { label: "Frontend (Next.js)", slug: "architecture/frontend" },
            { label: "Agent daemon", slug: "architecture/agent-daemon" },
            { label: "Queue & BullMQ", slug: "architecture/queue-bullmq" },
            { label: "RLS middleware", slug: "architecture/rls-middleware" },
            { label: "Database schema", slug: "architecture/database-schema" },
            { label: "Model registry", slug: "architecture/model-registry" },
          ],
        },
        {
          label: "API reference",
          items: [
            { label: "Authentication", slug: "reference/api-auth" },
            { label: "REST endpoints", slug: "reference/api-rest" },
            { label: "Webhook payloads", slug: "reference/api-webhooks" },
          ],
        },
        {
          label: "Contributing",
          items: [
            { label: "Development setup", slug: "contributing/development" },
            { label: "Testing", slug: "contributing/testing" },
            { label: "Adding an agent role", slug: "contributing/adding-agent" },
            { label: "Adding an integration", slug: "contributing/adding-integration" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Environment variables", slug: "reference/env-vars" },
            { label: "Troubleshooting", slug: "reference/troubleshooting" },
            { label: "FAQ", slug: "reference/faq" },
            { label: "Glossary", slug: "reference/glossary" },
          ],
        },
      ],
    }),
  ],
});
