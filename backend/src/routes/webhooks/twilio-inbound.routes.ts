/**
 * =============================================================================
 * TWILIO INBOUND VOICE WEBHOOKS (Voice Intake — Pipecat plan)
 * =============================================================================
 *
 * Two endpoints in one file:
 *   - POST /inbound — initial inbound call routing.
 *   - POST /pin     — DTMF gather callback (PIN verification).
 *
 * Both return TwiML (XML). Twilio webhook signature validation is handled by
 * the existing twilio-signature plugin upstream; we don't re-verify here.
 *
 * The route depends on two services on `fastify.services`:
 *   - callerAuthService: checks caller-ID allowlist + verifies PIN attempts.
 *   - tenantResolver:    maps the inbound DID (To) to a tenantId.
 *
 * Wired in `routes/index.ts` under prefix `/webhooks/twilio/voice`.
 *
 * @module routes/webhooks/twilio-inbound.routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'TwilioInbound' });

interface TwilioBody {
  From: string;
  To: string;
  CallSid: string;
  Digits?: string;
}

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
}

/**
 * Build TwiML that hands the call off to our media-stream WebSocket.
 *
 * The WebSocket path is `/media-stream/inbound/<callSid>` and the host is
 * `WEBHOOK_BASE_HOST` (set during install). Twilio requires `wss://` here.
 */
function streamTwiML(callId: string): string {
  const host = process.env.WEBHOOK_BASE_HOST ?? 'localhost';
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

export async function twilioInboundRoutes(fastify: FastifyInstance): Promise<void> {
  const services = (fastify as unknown as { services: ServicesShape }).services;

  fastify.post('/inbound', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as TwilioBody;
    const tenantId = await services.tenantResolver.resolveTenantByDID(body.To);
    const result = await services.callerAuthService.checkCallerId(tenantId, body.From);
    logger.info(
      { tenantId, from: body.From, callId: body.CallSid, result },
      'Inbound voice call',
    );

    let twiml: string;
    if (result === 'allowed') {
      twiml = streamTwiML(body.CallSid);
    } else if (result === 'needs_pin') {
      twiml = gatherTwiML();
    } else {
      twiml = hangupTwiML('Voice intake is not configured for this number. Goodbye.');
    }

    return reply.type('application/xml').send(twiml);
  });

  fastify.post('/pin', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as TwilioBody;
    const tenantId = await services.tenantResolver.resolveTenantByDID(body.To);
    const ok = body.Digits
      ? await services.callerAuthService.verifyPin(tenantId, body.Digits, body.From)
      : false;
    logger.info(
      { tenantId, from: body.From, callId: body.CallSid, ok },
      'PIN attempt',
    );
    const twiml = ok ? streamTwiML(body.CallSid) : hangupTwiML('Access denied. Goodbye.');
    return reply.type('application/xml').send(twiml);
  });
}
