/**
 * =============================================================================
 * TWILIO INBOUND VOICE WEBHOOKS (Voice Intake — Pipecat plan)
 * =============================================================================
 *
 * Two endpoints in one file:
 *   - POST /inbound — initial inbound call routing.
 *   - POST /pin     — DTMF gather callback (PIN verification).
 *
 * Both return TwiML (XML).
 *
 * Security:
 *   - Twilio signature verification is enforced when `TWILIO_AUTH_TOKEN` is
 *     configured. When the token is unset (BYO Twilio is optional during
 *     install), requests are allowed through with a `bypass` warning log so
 *     a self-hoster setting things up for the first time isn't blocked. This
 *     mirrors the pattern in `routes/twilio.routes.ts::verifyTwilioWebhook`.
 *   - Per-route rate limiting at 60 req/min/IP (CodeQL finding). Twilio
 *     itself doesn't dial faster than this for a single phone number; the
 *     limit exists to protect the endpoint from external abuse if the URL
 *     leaks.
 *   - Body validated against a zod schema (rejects 400 if `From`/`To`/
 *     `CallSid` are missing or empty).
 *
 * The route depends on services on `fastify.services`:
 *   - callerAuthService: checks caller-ID allowlist + verifies PIN attempts.
 *   - tenantResolver:    maps the inbound DID (To) to a tenantId.
 *   - callContextStore:  optional — when present, stash {fromNumber, toNumber}
 *                        keyed by CallSid so the media-stream WS handler can
 *                        recover the caller's E.164 number on upgrade.
 *
 * Wired in `routes/index.ts` under prefix `/webhooks/twilio/voice`.
 *
 * @module routes/webhooks/twilio-inbound.routes
 */

import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import { z } from 'zod';
import twilio from 'twilio';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'TwilioInbound' });

const twilioBodySchema = z.object({
  From: z.string().min(1, 'From is required'),
  To: z.string().min(1, 'To is required'),
  CallSid: z.string().min(1, 'CallSid is required'),
  Digits: z.string().optional(),
});

type TwilioBody = z.infer<typeof twilioBodySchema>;

interface ServicesShape {
  callerAuthService: {
    checkCallerId(
      tenantId: string,
      fromNumber: string,
    ): Promise<'allowed' | 'needs_pin' | 'not_configured'>;
    verifyPin(tenantId: string, pin: string, fromNumber: string): Promise<boolean>;
  };
  tenantResolver: {
    resolveTenantByDID(toNumber: string): Promise<string>;
  };
  callContextStore?: {
    set(
      callSid: string,
      ctx: { fromNumber: string; toNumber: string; acceptedAt: number },
    ): void;
  };
  /**
   * Live source-of-truth for the Twilio auth token used by signature
   * verification. Reads from `IntegrationConnection` first, env fallback.
   * Returning null = unconfigured, in which case production rejects unsigned
   * requests; non-prod allows them through with a warning (dev install path).
   */
  twilioVoiceProvider: {
    getAuthToken(): string | null;
  };
}

/**
 * Strip a leading scheme (`http://` / `https://`) from `WEBHOOK_BASE_HOST`
 * so we don't accidentally produce `wss://https://example.com/...`. Trailing
 * slashes are also stripped because they would produce a double slash in the
 * stream URL.
 */
function normalizeHost(raw: string | undefined): string {
  if (!raw) return 'localhost';
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Build TwiML that hands the call off to our media-stream WebSocket.
 *
 * The WebSocket path is `/media-stream/inbound/<callSid>` and the host is
 * `WEBHOOK_BASE_HOST` (set during install). Twilio requires `wss://` here.
 */
function streamTwiML(callId: string): string {
  const host = normalizeHost(process.env.WEBHOOK_BASE_HOST);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/media-stream/inbound/${callId}" />
  </Connect>
</Response>`;
}

function gatherTwiML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="4" timeout="10" action="/webhooks/twilio/voice/pin">
    <Say>Welcome to Workforce0. Please enter your PIN, then press pound.</Say>
  </Gather>
  <Say>No PIN entered. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

function hangupTwiML(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>${message}</Say><Hangup/></Response>`;
}

/**
 * Pre-handler factory: verify the X-Twilio-Signature header against the
 * current Twilio auth token (DB → env fallback, via the provider).
 *
 * Built per-route as a closure so the auth-token getter is captured
 * lazily — every call re-reads from the provider, picking up wizard
 * settings changes without a backend restart.
 *
 * Bypass policy:
 *   - In production with no token, REJECT with 503 — a forged unsigned
 *     webhook would otherwise trigger meeting creation / PIN prompts.
 *   - In dev/test with no token, allow through with a warning so a
 *     first-time installer can complete the wizard against a tunnel
 *     before pasting the auth token. Mirrors the dev-only bypass in
 *     `routes/twilio.routes.ts::verifyTwilioWebhook`.
 */
function makeVerifyTwilioSignature(
  getAuthToken: () => string | null,
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authToken = getAuthToken();
    if (!authToken) {
      if (config.NODE_ENV === 'production') {
        logger.error(
          { url: request.url },
          'No Twilio auth token (DB or env) in production — rejecting unsigned voice webhook',
        );
        return reply.status(503).send({ error: 'voice intake not configured' });
      }
      logger.warn(
        { url: request.url, nodeEnv: config.NODE_ENV },
        'Twilio auth token unset — bypassing signature verification (non-production only). Configure Twilio in the integrations UI before exposing this endpoint to the public internet.',
      );
      return; // Allow through (dev/test only).
    }

    const signature = request.headers['x-twilio-signature'];
    const signatureStr = Array.isArray(signature) ? signature[0] : signature;
    if (!signatureStr) {
      logger.warn({ url: request.url }, 'Missing X-Twilio-Signature header');
      return reply.status(401).send({ error: 'Missing Twilio signature' });
    }

    // Reconstruct the URL Twilio used to sign the request. Honour the
    // X-Forwarded-Proto/Host headers because reverse proxies (Caddy, Cloudflare
    // Tunnel) terminate TLS and the inner Fastify only sees `http`.
    const protoHeader = request.headers['x-forwarded-proto'];
    const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ?? 'https';
    const hostHeader = request.headers['host'];
    const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ?? 'localhost';
    const url = `${proto}://${host}${request.url}`;
    const params =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, string>)
        : {};

    const valid = twilio.validateRequest(authToken, signatureStr, url, params);
    if (!valid) {
      logger.warn({ url }, 'Invalid Twilio signature');
      return reply.status(401).send({ error: 'Invalid Twilio signature' });
    }
  };
}

/**
 * Per-route rate-limit config: 60 requests/minute/IP. Matches the guidance
 * in the CodeQL "missing-rate-limiting" finding. When `@fastify/rate-limit`
 * isn't registered globally (e.g. unit tests), Fastify silently ignores the
 * `config.rateLimit` block, so this is safe to leave on every route.
 */
const inboundRateLimitConfig = {
  config: {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
    },
  },
};

export async function twilioInboundRoutes(fastify: FastifyInstance): Promise<void> {
  const services = (fastify as unknown as { services: ServicesShape }).services;
  const verifyTwilioSignature = makeVerifyTwilioSignature(() =>
    services.twilioVoiceProvider.getAuthToken(),
  );

  fastify.post(
    '/inbound',
    {
      ...inboundRateLimitConfig,
      preHandler: verifyTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = twilioBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        logger.warn(
          { issues: parsed.error.issues },
          'Inbound webhook payload failed validation',
        );
        return reply.status(400).send({
          error: 'Bad request',
          issues: parsed.error.issues.map((i) => i.message),
        });
      }
      const body: TwilioBody = parsed.data;
      const tenantId = await services.tenantResolver.resolveTenantByDID(body.To);
      const result = await services.callerAuthService.checkCallerId(tenantId, body.From);
      logger.info(
        { tenantId, from: body.From, callId: body.CallSid, result },
        'Inbound voice call',
      );

      // Stash caller metadata for the media-stream WS handler before we
      // return TwiML — Twilio will open the WS within milliseconds.
      services.callContextStore?.set(body.CallSid, {
        fromNumber: body.From,
        toNumber: body.To,
        acceptedAt: Date.now(),
      });

      let twiml: string;
      if (result === 'allowed') {
        twiml = streamTwiML(body.CallSid);
      } else if (result === 'needs_pin') {
        twiml = gatherTwiML();
      } else {
        twiml = hangupTwiML('Voice intake is not configured for this number. Goodbye.');
      }

      return reply.type('application/xml').send(twiml);
    },
  );

  fastify.post(
    '/pin',
    {
      ...inboundRateLimitConfig,
      preHandler: verifyTwilioSignature,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = twilioBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        logger.warn(
          { issues: parsed.error.issues },
          'PIN webhook payload failed validation',
        );
        return reply.status(400).send({
          error: 'Bad request',
          issues: parsed.error.issues.map((i) => i.message),
        });
      }
      const body: TwilioBody = parsed.data;
      const tenantId = await services.tenantResolver.resolveTenantByDID(body.To);
      const ok = body.Digits
        ? await services.callerAuthService.verifyPin(tenantId, body.Digits, body.From)
        : false;
      logger.info(
        { tenantId, from: body.From, callId: body.CallSid, ok },
        'PIN attempt',
      );
      // PIN succeeded → reuse the same context window the inbound webhook
      // opened so the WS handler still finds the caller number when the
      // stream connects.
      if (ok) {
        services.callContextStore?.set(body.CallSid, {
          fromNumber: body.From,
          toNumber: body.To,
          acceptedAt: Date.now(),
        });
      }
      const twiml = ok ? streamTwiML(body.CallSid) : hangupTwiML('Access denied. Goodbye.');
      return reply.type('application/xml').send(twiml);
    },
  );
}
