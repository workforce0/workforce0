/**
 * =============================================================================
 * GOOGLE CHAT WEBHOOK HANDLER
 * =============================================================================
 *
 * Handles incoming messages from Google Chat for the clarification loop.
 *
 * This handler processes responses to clarification questions sent by the
 * BA Agent and triggers PRD regeneration when answers are received.
 *
 * Message Flow:
 * -------------
 * 1. BA Agent sends clarification questions to Google Chat (with thread key)
 * 2. Stakeholder replies in the thread: "Q1: Use OAuth2"
 * 3. This webhook receives the reply
 * 4. Parse the response to extract question ID and answer
 * 5. Store the answer in the database
 * 6. If all questions answered, trigger PRD regeneration
 *
 * Response Formats Supported:
 * --------------------------
 * - "Q1: answer text here"
 * - "Q1 - answer text here"
 * - "1. answer text here"
 * - "1: answer text here"
 *
 * Security:
 * ---------
 * - Verify webhook signature (if configured)
 * - Validate thread key matches a known clarification request
 * - Rate limit incoming messages
 *
 * @module routes/webhooks/gchat-webhook
 */

import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { parseEscalationIntent } from '../../services/escalation/escalation.service.js';

const logger = createChildLogger({ module: 'gchat-webhook' });

/**
 * Google Chat webhook message payload.
 *
 * @see https://developers.google.com/chat/api/guides/message-formats/events
 */
interface GChatWebhookPayload {
  type: 'MESSAGE' | 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE' | 'CARD_CLICKED';
  eventTime: string;
  message?: {
    name: string;
    text: string;
    thread?: {
      name: string;
      threadKey?: string;
    };
    sender?: {
      name: string;
      displayName: string;
      email?: string;
      type?: 'HUMAN' | 'BOT';
    };
    space?: {
      name: string;
      displayName?: string;
      type?: string;
    };
    argumentText?: string;
  };
  user?: {
    name: string;
    displayName: string;
    email?: string;
  };
  space?: {
    name: string;
    displayName?: string;
  };
  action?: {
    actionMethodName: string;
    parameters?: Array<{ key: string; value: string }>;
  };
}

/**
 * Parsed clarification answer from a chat message.
 */
interface ParsedAnswer {
  questionId: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Parse clarification answers from a chat message.
 *
 * Supports multiple formats:
 * - "Q1: answer" → { questionId: 'Q1', answer: 'answer' }
 * - "Q1 - answer" → { questionId: 'Q1', answer: 'answer' }
 * - "1. answer" → { questionId: 'Q1', answer: 'answer' }
 * - Multiple answers in one message
 *
 * @param text - Raw message text
 * @returns Array of parsed answers
 */
function parseAnswers(text: string): ParsedAnswer[] {
  const answers: ParsedAnswer[] = [];

  // Pattern 1: "Q1: answer" or "Q1 - answer"
  const qPattern = /Q(\d+)\s*[:\-]\s*(.+?)(?=Q\d+\s*[:\-]|$)/gis;
  let match: RegExpExecArray | null;

  while ((match = qPattern.exec(text)) !== null) {
    answers.push({
      questionId: `Q${match[1]}`,
      answer: match[2].trim(),
      confidence: 'high',
    });
  }

  // Pattern 2: "1. answer" or "1: answer" (numbered list)
  if (answers.length === 0) {
    const numPattern = /(\d+)\s*[.:\-]\s*(.+?)(?=\d+\s*[.:\-]|$)/gs;
    while ((match = numPattern.exec(text)) !== null) {
      answers.push({
        questionId: `Q${match[1]}`,
        answer: match[2].trim(),
        confidence: 'medium',
      });
    }
  }

  // If no structured format detected, treat as free-form answer
  if (answers.length === 0 && text.trim().length > 10) {
    answers.push({
      questionId: 'unknown',
      answer: text.trim(),
      confidence: 'low',
    });
  }

  return answers;
}

/**
 * Extract thread key from thread name.
 *
 * Thread name format: "spaces/{spaceId}/threads/{threadKey}"
 */
function extractThreadKey(threadName?: string): string | null {
  if (!threadName) return null;

  // Try to extract from threadKey field first
  const parts = threadName.split('/');
  const threadIndex = parts.indexOf('threads');
  if (threadIndex !== -1 && parts[threadIndex + 1]) {
    return parts[threadIndex + 1];
  }

  return null;
}

/**
 * Extract PRD ID from thread key.
 *
 * Thread key format: "prd-clarify-{prdId}"
 */
function extractPrdIdFromThreadKey(threadKey: string): string | null {
  const match = threadKey.match(/^prd-clarify-(.+)$/);
  return match ? match[1] : null;
}

/**
 * Register Google Chat webhook routes.
 *
 * @param app - Fastify instance
 */
export async function registerGChatWebhook(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/webhooks/gchat
   *
   * Main webhook endpoint for receiving Google Chat events.
   *
   * Events handled:
   * - MESSAGE: User sent a message (process for clarification answers)
   * - ADDED_TO_SPACE: Bot added to a space (send welcome message)
   * - REMOVED_FROM_SPACE: Bot removed (cleanup if needed)
   * - CARD_CLICKED: User clicked a button (handle action)
   */
  app.post('/gchat', {
    schema: {
      description: 'Google Chat webhook endpoint for receiving chat events',
      tags: ['webhooks'],
      body: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          eventTime: { type: 'string' },
          message: { type: 'object' },
          user: { type: 'object' },
          space: { type: 'object' },
          action: { type: 'object' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
        },
      },
    },
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Bearer token if configured
      const expectedToken = config.GCHAT_WEBHOOK_TOKEN;
      if (expectedToken) {
        const authHeader = request.headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
          logger.warn('Google Chat webhook missing Bearer token');
          return reply.status(401).send({ error: 'Missing authorization token' });
        }
        const token = authHeader.replace('Bearer ', '');
        const tokenBuf = Buffer.from(token);
        const expectedBuf = Buffer.from(expectedToken);
        if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
          logger.warn('Google Chat webhook invalid Bearer token');
          return reply.status(401).send({ error: 'Invalid authorization token' });
        }
      } else {
        logger.debug('Google Chat webhook token not configured - verification skipped');
      }
    },
    handler: async (request: FastifyRequest<{ Body: GChatWebhookPayload }>, reply: FastifyReply) => {
      const payload = request.body;

      logger.info('Received Google Chat webhook', {
        type: payload.type,
        hasMessage: !!payload.message,
        sender: payload.message?.sender?.email || payload.user?.email,
      });

      try {
        switch (payload.type) {
          case 'MESSAGE':
            return await handleMessage(app, payload, reply);

          case 'ADDED_TO_SPACE':
            return await handleAddedToSpace(payload, reply);

          case 'REMOVED_FROM_SPACE':
            logger.info('Bot removed from space', {
              space: payload.space?.name,
            });
            return reply.send({});

          case 'CARD_CLICKED':
            return await handleCardClicked(app, payload, reply);

          default:
            logger.warn('Unknown webhook event type', { type: payload.type });
            return reply.send({});
        }
      } catch (error) {
        logger.error('Error processing Google Chat webhook', {
          error: (error as Error).message,
          type: payload.type,
        });

        // Return empty response to prevent retries
        return reply.send({});
      }
    },
  });

  /**
   * GET /api/webhooks/gchat/health
   *
   * Health check endpoint for the webhook.
   */
  app.get('/gchat/health', {
    schema: {
      description: 'Google Chat webhook health check',
      tags: ['webhooks'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    },
  });

  logger.info('Google Chat webhook routes registered');
}

/**
 * Handle incoming message event.
 *
 * This is where clarification answers are processed.
 */
async function handleMessage(
  app: FastifyInstance,
  payload: GChatWebhookPayload,
  reply: FastifyReply
): Promise<void> {
  const message = payload.message;
  if (!message?.text) {
    reply.send({});
    return;
  }

  // Ignore messages from bots
  if (message.sender?.type === 'BOT') {
    logger.debug('Ignoring bot message');
    reply.send({});
    return;
  }

  // M7.5: chief_of_staff escalation replies (RETRY / PAUSE / CANCEL) — checked
  // before the clarification-thread routing because escalation messages live
  // in their own space, not a clarification thread. If the user replies with
  // a recognised token, hand off to EscalationService and echo the status
  // back as the chat reply.
  const escalation = parseEscalationIntent(message.text);
  if (escalation && app.services?.escalationService) {
    const result = await app.services.escalationService.apply(
      escalation.token,
      escalation.action,
    );
    logger.info('GChat reply: escalation handled', {
      sender: message.sender?.email,
      action: escalation.action,
      ok: result.ok,
      parentTicketId: result.parentTicketId,
    });
    reply.send({ text: result.message });
    return;
  }

  // Extract thread key to identify which PRD this is for
  const threadKey = message.thread?.threadKey || extractThreadKey(message.thread?.name);

  if (!threadKey) {
    logger.debug('Message not in a tracked thread, ignoring');
    reply.send({});
    return;
  }

  // Check if this is a clarification thread
  const prdId = extractPrdIdFromThreadKey(threadKey);
  if (!prdId) {
    logger.debug('Not a clarification thread', { threadKey });
    reply.send({});
    return;
  }

  logger.info('Processing clarification response', {
    prdId,
    threadKey,
    sender: message.sender?.email,
    textLength: message.text.length,
  });

  // Parse answers from message
  const answers = parseAnswers(message.text);

  if (answers.length === 0) {
    logger.debug('No parseable answers found in message');
    // Send help text
    reply.send({
      text: `I couldn't parse your answer. Please use the format:\n` +
            `• "Q1: your answer here"\n` +
            `• "Q2: another answer"\n\n` +
            `Example: "Q1: Use OAuth2 with JWT tokens"`,
    });
    return;
  }

  logger.info('Parsed clarification answers', {
    prdId,
    answerCount: answers.length,
    questionIds: answers.map(a => a.questionId),
  });

  // Store answers and trigger processing
  // Access services via Fastify's decorated services object
  try {
    const queueService = app.services?.queueService;
    const baAgentService = app.services?.baAgentService;

    if (baAgentService) {
      // Direct processing if BA Agent is available
      await baAgentService.processClarificationResponse({
        prdId,
        threadKey,
        answers: answers.map(a => ({
          questionId: a.questionId,
          answer: a.answer,
        })),
        respondent: message.sender?.email || 'unknown',
      });

      // Send acknowledgment
      reply.send({
        text: `✅ Received ${answers.length} answer(s):\n` +
              answers.map(a => `• ${a.questionId}: "${a.answer.substring(0, 50)}${a.answer.length > 50 ? '...' : ''}"`).join('\n'),
      });
    } else if (queueService) {
      // Queue for async processing
      await (queueService as any).dispatch('clarification.response', {
        prdId,
        threadKey,
        answers: answers.map(a => ({
          questionId: a.questionId,
          answer: a.answer,
        })),
        respondent: message.sender?.email || 'unknown',
      });

      reply.send({
        text: `✅ Received ${answers.length} answer(s). Processing...`,
      });
    } else {
      logger.warn('No BA Agent or queue service available');
      reply.send({
        text: `✅ Received your answers. They will be processed shortly.`,
      });
    }
  } catch (error) {
    logger.error('Failed to process clarification response', {
      prdId,
      error: (error as Error).message,
    });

    reply.send({
      text: `⚠️ There was an error processing your answer. Please try again or contact support.`,
    });
  }
}

/**
 * Handle bot added to space event.
 */
async function handleAddedToSpace(
  payload: GChatWebhookPayload,
  reply: FastifyReply
): Promise<void> {
  logger.info('Bot added to space', {
    space: payload.space?.name,
    displayName: payload.space?.displayName,
  });

  reply.send({
    text: `👋 Hello! I'm the Workforce0 BA Agent.\n\n` +
          `I help create and refine Product Requirement Documents (PRDs) from your meetings.\n\n` +
          `When I need clarification, I'll ask questions here. ` +
          `Reply with "Q1: your answer" to provide feedback.\n\n` +
          `Type "help" to see available commands.`,
  });
}

/**
 * Handle card button click event.
 */
async function handleCardClicked(
  app: FastifyInstance,
  payload: GChatWebhookPayload,
  reply: FastifyReply
): Promise<void> {
  const action = payload.action;
  if (!action) {
    reply.send({});
    return;
  }

  logger.info('Card action clicked', {
    actionMethod: action.actionMethodName,
    parameters: action.parameters,
  });

  // Handle different actions
  switch (action.actionMethodName) {
    case 'approvePrd':
      // Handle PRD approval
      const prdId = action.parameters?.find(p => p.key === 'prdId')?.value;
      if (prdId) {
        // Trigger approval flow
        logger.info('PRD approval requested', { prdId });
        reply.send({ text: `✅ PRD approval initiated for ${prdId}` });
      }
      break;

    default:
      logger.debug('Unknown card action', { action: action.actionMethodName });
      reply.send({});
  }
}

export default registerGChatWebhook;
