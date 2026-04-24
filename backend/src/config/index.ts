import 'dotenv/config';
import { z } from 'zod';
import { deriveKey } from '../lib/encryption.js';

// Helper to treat empty strings as undefined (for optional fields)
const optionalString = z.string().optional().transform(v => v === '' ? undefined : v);
const optionalEmail = z.string().email().optional().or(z.literal('')).transform(v => v === '' ? undefined : v);
const optionalUrl = z.string().url().optional().or(z.literal('')).transform(v => v === '' ? undefined : v);

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_SENTINEL_HOSTS: optionalString,      // Comma-separated host:port pairs (e.g. "sentinel1:26379,sentinel2:26379")
  REDIS_SENTINEL_MASTER: optionalString,      // Sentinel master name (default: "mymaster")
  REDIS_PASSWORD: optionalString,             // Password for Redis auth (used in Sentinel mode)
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),  // Redis database index

  // AI Models
  GEMINI_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,  // For OpenAI critique in AI Council
  ANTHROPIC_API_KEY: optionalString,  // Reserved: Dev Agent Claude integration (Sprint 2)

  // Webhook configuration
  WEBHOOK_BASE_URL: optionalUrl,  // Base URL for webhooks (e.g., ngrok tunnel)

  // Public-facing URL (for links in notifications, emails, etc.)
  PUBLIC_URL: optionalString,

  // Integrations
  JIRA_API_TOKEN: optionalString,
  JIRA_EMAIL: optionalEmail,
  JIRA_BASE_URL: optionalUrl,

  GCHAT_WEBHOOK_URL: optionalUrl,

  // Google Workspace
  GOOGLE_SERVICE_ACCOUNT_KEY: optionalString,  // JSON string of service account credentials
  GOOGLE_DRIVE_FOLDER_ID: optionalString,  // Default folder for PRD exports

  // Webhook secrets
  JIRA_WEBHOOK_SECRET: optionalString,
  GCHAT_WEBHOOK_TOKEN: optionalString,  // Bearer token for Google Chat webhook verification

  // Auth
  JWT_SECRET: z.string().min(32),

  // Encryption (optional — derived from JWT_SECRET if not set)
  ENCRYPTION_KEY: optionalString,

  // Tenant defaults
  DEFAULT_TENANT_ID: z.string().default('default'),  // Reserved: fallback tenant for service-to-service calls

  // Storage — local filesystem by default, S3 opt-in.
  // Set STORAGE_DRIVER=s3 (with AWS_S3_BUCKET) to force S3; set STORAGE_DRIVER=local
  // to force local even if AWS vars happen to be present.
  STORAGE_DRIVER: optionalString,                    // 's3' | 'local' (optional, auto-picks)
  STORAGE_ROOT: z.string().default('./data/uploads'),// Where the local driver writes files

  // S3 (audio storage for meeting uploads — opt-in)
  AWS_S3_BUCKET: optionalString,
  AWS_S3_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,

  // Google OAuth (Google Meet integration)
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalUrl,

  // Twilio Voice (for dial-in voice bot)
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_PHONE_NUMBER: optionalString,

  // GitHub (for Dev Agent + QA Agent)
  GITHUB_TOKEN: optionalString,         // PAT or GitHub App installation token
  GITHUB_DEFAULT_OWNER: optionalString,  // Default repo owner (org or user)
  GITHUB_DEFAULT_REPO: optionalString,   // Default repo name

  // Communication Channels
  SLACK_BOT_TOKEN: optionalString,       // Slack Bot OAuth token (xoxb-...)
  SLACK_SIGNING_SECRET: optionalString,  // Slack app signing secret (verifies webhook payloads)
  EMAIL_WEBHOOK_SECRET: optionalString,  // Shared secret for inbound email → approval webhook

  // Honcho (external memory provider — "agent that grows with you")
  HONCHO_API_KEY: optionalString,
  HONCHO_BASE_URL: optionalString,
  HONCHO_APP_ID: optionalString,        // the Honcho app id that groups users

  // AI Council — multi-model consensus (BA generates, critic model reviews)
  // Default: off (single-model, faster + cheaper). Set to 'true' to enable.
  AI_COUNCIL_ENABLED: optionalString,

  // Opt-in LLM fallback for @mention routing. When the regex finds no
  // @agent in an inbound message, ask Gemini which agent (if any) should
  // handle it. Costs one extra small Gemini call per ambiguous message.
  // Default: off (regex-only, deterministic + free).
  LLM_MENTION_CLASSIFIER_ENABLED: optionalString,
  SENDGRID_API_KEY: optionalString,      // SendGrid API key for email delivery
  EMAIL_FROM: optionalString,            // Sender email address (default: noreply@workforce0.ai)
  TEAMS_WEBHOOK_URL: optionalUrl,        // Microsoft Teams Incoming Webhook URL

  // WorkOS SSO
  WORKOS_API_KEY: optionalString,
  WORKOS_CLIENT_ID: optionalString,

  // OpenTelemetry (optional — standard OTel env vars, read by SDK directly)
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,  // e.g. http://localhost:4318
  OTEL_SERVICE_NAME: optionalString,          // defaults to "workforce0-api"
  OTEL_ENABLED: optionalString,               // set to "false" to disable

  // CORS
  ALLOWED_ORIGINS: optionalString, // Comma-separated list of allowed origins
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

/**
 * Returns the 64-char hex encryption key for AES-256-GCM.
 *
 * Priority:
 * 1. ENCRYPTION_KEY env var (must be 64 hex chars / 32 bytes)
 * 2. Derived from JWT_SECRET via scrypt (works in dev without extra config)
 */
export function getEncryptionKey(): string {
  if (config.ENCRYPTION_KEY) {
    return config.ENCRYPTION_KEY;
  }
  return deriveKey(config.JWT_SECRET).toString('hex');
}
