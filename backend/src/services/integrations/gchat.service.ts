/**
 * =============================================================================
 * GOOGLE CHAT INTEGRATION SERVICE
 * =============================================================================
 *
 * Integration with Google Chat for sending notifications and interactive messages.
 *
 * Why Google Chat?
 * ----------------
 * 1. Tight integration with Google Workspace (same as Google Meet)
 * 2. Support for rich cards and interactive buttons
 * 3. Threaded conversations for context
 * 4. Easy webhook setup (no OAuth required for basic messages)
 *
 * Message Types:
 * --------------
 * 1. Simple Text: Plain notifications
 * 2. Cards: Rich formatted messages with sections
 * 3. Interactive: Messages with buttons for user actions
 *
 * Delivery Methods:
 * -----------------
 * 1. Incoming Webhooks: Simple, no auth required (we use this)
 * 2. Chat API: Full API access, requires OAuth/service account
 *
 * Use Cases in Workforce0:
 * ------------------------
 * - Notify when meeting transcription is complete
 * - Share PRD summary for approval
 * - Ask clarifying questions (with response buttons)
 * - Alert on errors or issues
 *
 * Card Builder Pattern:
 * ---------------------
 * We use a builder pattern for constructing Google Chat cards.
 * This makes it easy to create consistent, well-formatted messages.
 *
 * ```typescript
 * const card = new CardBuilder()
 *   .setHeader('PRD Generated', 'User Authentication Feature')
 *   .addSection('Summary', prd.summary)
 *   .addButtonSection([
 *     { text: 'Approve', url: approveUrl },
 *     { text: 'Review', url: reviewUrl },
 *   ])
 *   .build();
 * ```
 *
 * @module services/integrations/gchat
 */

import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';

/**
 * Google Chat webhook configuration.
 */
export interface GoogleChatConfig {
  /** Webhook URL from Google Chat space settings */
  webhookUrl: string;
  /** Optional default thread key for grouping messages */
  defaultThreadKey?: string;
}

/**
 * Simple text message input.
 */
export interface TextMessageInput {
  text: string;
  threadKey?: string;
}

/**
 * Card message components.
 */
export interface CardSection {
  header?: string;
  widgets: CardWidget[];
}

export interface CardWidget {
  type: 'textParagraph' | 'keyValue' | 'buttons' | 'image';
  data: Record<string, unknown>;
}

export interface CardButton {
  text: string;
  url?: string;
  onClick?: {
    action: string;
    parameters?: Record<string, string>;
  };
}

/**
 * Card message input.
 */
export interface CardMessageInput {
  header?: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
  };
  sections: CardSection[];
  threadKey?: string;
}

/**
 * Google Chat Service for sending notifications.
 *
 * @example
 * ```typescript
 * const gchat = new GoogleChatService({
 *   webhookUrl: 'https://chat.googleapis.com/v1/spaces/xxx/messages?key=xxx',
 * });
 *
 * // Send simple notification
 * await gchat.sendText({
 *   text: 'Meeting transcription complete!',
 * });
 *
 * // Send rich card
 * await gchat.sendCard({
 *   header: { title: 'New PRD', subtitle: 'User Authentication' },
 *   sections: [{
 *     header: 'Summary',
 *     widgets: [{ type: 'textParagraph', data: { text: prd.summary } }],
 *   }],
 * });
 * ```
 */
export class GoogleChatService {
  private readonly logger = createChildLogger({ service: 'GoogleChatService' });
  private readonly webhookUrl?: string;
  private readonly defaultThreadKey?: string;
  private readonly enabled: boolean;

  /** Request timeout */
  private readonly timeout = 10000;

  constructor(config: Partial<GoogleChatConfig>) {
    if (!config.webhookUrl) {
      this.enabled = false;
      this.logger.warn('Google Chat service disabled - missing webhookUrl');
      return;
    }

    this.enabled = true;
    this.webhookUrl = config.webhookUrl;
    this.defaultThreadKey = config.defaultThreadKey;

    this.logger.info('Google Chat service initialized');
  }

  /** Check if service is enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Send a simple text message.
   *
   * @param input - Text message input
   */
  async sendText(input: TextMessageInput): Promise<void> {
    this.logger.info('Sending text message to Google Chat', {
      textLength: input.text.length,
      hasThread: !!input.threadKey,
    });

    const payload: Record<string, unknown> = {
      text: input.text,
    };

    // Add thread key if provided (for threaded conversations)
    const threadKey = input.threadKey || this.defaultThreadKey;
    if (threadKey) {
      payload.thread = { threadKey };
    }

    await this.send(payload);
  }

  /**
   * Send a rich card message.
   *
   * @param input - Card message input
   */
  async sendCard(input: CardMessageInput): Promise<void> {
    this.logger.info('Sending card message to Google Chat', {
      hasHeader: !!input.header,
      sectionCount: input.sections.length,
    });

    const card: Record<string, unknown> = {
      sections: input.sections.map((section) => ({
        header: section.header,
        widgets: section.widgets.map((widget) => this.buildWidget(widget)),
      })),
    };

    if (input.header) {
      card.header = {
        title: input.header.title,
        subtitle: input.header.subtitle,
        imageUrl: input.header.imageUrl,
        imageType: input.header.imageUrl ? 'CIRCLE' : undefined,
      };
    }

    const payload: Record<string, unknown> = {
      cards: [card],
    };

    const threadKey = input.threadKey || this.defaultThreadKey;
    if (threadKey) {
      payload.thread = { threadKey };
    }

    await this.send(payload);
  }

  /**
   * Send a PRD notification with approval buttons.
   *
   * Convenience method for sending PRD-related notifications.
   *
   * @param prd - PRD summary data
   * @param urls - Action URLs
   */
  async sendPRDNotification(
    prd: {
      title: string;
      summary: string;
      confidence: number;
      requirementsCount: number;
    },
    urls: {
      viewUrl: string;
      approveUrl?: string;
      rejectUrl?: string;
    }
  ): Promise<void> {
    this.logger.info('Sending PRD notification', { title: prd.title });

    const confidenceEmoji = prd.confidence >= 0.9 ? '[HIGH]' : prd.confidence >= 0.7 ? '[MED]' : '[LOW]';
    const confidenceText = `${(prd.confidence * 100).toFixed(0)}%`;

    const sections: CardSection[] = [
      {
        widgets: [
          {
            type: 'textParagraph',
            data: { text: prd.summary.substring(0, 500) + (prd.summary.length > 500 ? '...' : '') },
          },
        ],
      },
      {
        widgets: [
          {
            type: 'keyValue',
            data: {
              topLabel: 'Requirements',
              content: prd.requirementsCount.toString(),
            },
          },
          {
            type: 'keyValue',
            data: {
              topLabel: 'Confidence',
              content: `${confidenceEmoji} ${confidenceText}`,
            },
          },
        ],
      },
    ];

    // Add action buttons
    const buttons: CardButton[] = [{ text: 'View PRD', url: urls.viewUrl }];

    if (urls.approveUrl) {
      buttons.push({ text: 'Approve', url: urls.approveUrl });
    }
    if (urls.rejectUrl) {
      buttons.push({ text: 'Reject', url: urls.rejectUrl });
    }

    sections.push({
      widgets: [{ type: 'buttons', data: { buttons } }],
    });

    await this.sendCard({
      header: {
        title: 'New PRD Generated',
        subtitle: prd.title,
      },
      sections,
    });
  }

  /**
   * Send a clarification request with response options.
   *
   * @param question - The clarifying question
   * @param options - Possible answers (if any)
   * @param responseUrl - URL to submit response
   */
  async sendClarificationRequest(
    question: {
      id: string;
      text: string;
      context?: string;
    },
    options?: string[],
    responseUrl?: string
  ): Promise<void> {
    this.logger.info('Sending clarification request', { questionId: question.id });

    const sections: CardSection[] = [
      {
        header: 'Clarification Needed',
        widgets: [
          {
            type: 'textParagraph',
            data: { text: question.text },
          },
        ],
      },
    ];

    // Add context if provided
    if (question.context) {
      sections.push({
        widgets: [
          {
            type: 'textParagraph',
            data: { text: `_Context: ${question.context}_` },
          },
        ],
      });
    }

    // Add suggested options as buttons if provided
    if (options?.length && responseUrl) {
      const buttons: CardButton[] = options.map((option, index) => ({
        text: option,
        url: `${responseUrl}?q=${question.id}&a=${index}`,
      }));

      // Add "Other" option for custom response
      buttons.push({
        text: 'Other...',
        url: `${responseUrl}?q=${question.id}&custom=true`,
      });

      sections.push({
        widgets: [{ type: 'buttons', data: { buttons } }],
      });
    }

    await this.sendCard({
      header: {
        title: 'BA Agent',
        subtitle: 'Needs your input',
      },
      sections,
    });
  }

  /**
   * Send multiple clarification questions for a PRD.
   *
   * This is the main method for the clarification loop. It sends all open
   * questions in a single, well-formatted message to Google Chat, with
   * instructions on how stakeholders should respond.
   *
   * @param request - Clarification request with questions
   * @returns Thread key for tracking responses
   *
   * @example
   * ```typescript
   * const threadKey = await gchat.sendClarificationQuestions({
   *   prdId: 'prd-123',
   *   title: 'User Authentication Feature',
   *   questions: [
   *     { id: 'Q1', text: 'Which authentication method should we use?' },
   *     { id: 'Q2', text: 'What is the target response time?' },
   *   ],
   *   documentUrl: 'https://docs.google.com/document/d/xxx',
   *   viewPrdUrl: 'https://app.workforce0.com/prds/123',
   * });
   * ```
   */
  async sendClarificationQuestions(request: {
    prdId: string;
    title: string;
    questions: Array<{ id: string; text: string }>;
    documentUrl?: string;
    viewPrdUrl?: string;
    confidence?: number;
  }): Promise<string> {
    const threadKey = `prd-clarify-${request.prdId}`;

    this.logger.info('Sending clarification questions', {
      prdId: request.prdId,
      questionCount: request.questions.length,
      threadKey,
    });

    // Build questions list
    const questionsText = request.questions
      .map((q) => `*${q.id}.* ${q.text}`)
      .join('\n\n');

    const sections: CardSection[] = [
      // Questions section
      {
        header: 'Questions Requiring Your Input',
        widgets: [
          {
            type: 'textParagraph',
            data: { text: questionsText },
          },
        ],
      },
      // Instructions section
      {
        header: 'How to Respond',
        widgets: [
          {
            type: 'textParagraph',
            data: {
              text: `Reply to this thread with your answers:\n\n` +
                    `*Format:* "Q1: [your answer]"\n` +
                    `*Example:* "Q1: Use OAuth2 with JWT tokens"\n\n` +
                    `_You can answer multiple questions in separate messages._`,
            },
          },
        ],
      },
    ];

    // Add confidence indicator if provided
    if (request.confidence !== undefined) {
      const confidencePercent = Math.round(request.confidence * 100);
      const confidenceText = confidencePercent >= 90 ? '[HIGH]' :
                            confidencePercent >= 70 ? '[MEDIUM]' : '[LOW]';
      sections.push({
        widgets: [
          {
            type: 'keyValue',
            data: {
              topLabel: 'AI Confidence',
              content: `${confidenceText} ${confidencePercent}%`,
            },
          },
        ],
      });
    }

    // Add action buttons
    const buttons: CardButton[] = [];
    if (request.documentUrl) {
      buttons.push({ text: 'View Document', url: request.documentUrl });
    }
    if (request.viewPrdUrl) {
      buttons.push({ text: 'View PRD', url: request.viewPrdUrl });
    }

    if (buttons.length > 0) {
      sections.push({
        widgets: [{ type: 'buttons', data: { buttons } }],
      });
    }

    await this.sendCard({
      header: {
        title: 'Clarification Needed',
        subtitle: request.title,
      },
      sections,
      threadKey,
    });

    return threadKey;
  }

  /**
   * Send a notification that clarification answers were received.
   *
   * @param request - Acknowledgment request
   */
  async sendClarificationReceived(request: {
    prdId: string;
    threadKey: string;
    answeredQuestions: Array<{ id: string; answer: string }>;
    remainingQuestions: number;
  }): Promise<void> {
    this.logger.info('Sending clarification received acknowledgment', {
      prdId: request.prdId,
      answeredCount: request.answeredQuestions.length,
      remaining: request.remainingQuestions,
    });

    const answersText = request.answeredQuestions
      .map((q) => `✅ *${q.id}*: ${q.answer.substring(0, 100)}${q.answer.length > 100 ? '...' : ''}`)
      .join('\n');

    const statusText = request.remainingQuestions > 0
      ? `⏳ ${request.remainingQuestions} question(s) still need answers.`
      : '🎉 All questions answered! Regenerating PRD...';

    await this.sendText({
      text: `*Answers Received*\n\n${answersText}\n\n${statusText}`,
      threadKey: request.threadKey,
    });
  }

  /**
   * Send notification that PRD has been updated with clarifications.
   *
   * @param request - Update notification request
   */
  async sendPRDUpdated(request: {
    prdId: string;
    threadKey: string;
    title: string;
    documentUrl?: string;
    newConfidence?: number;
    hasMoreQuestions: boolean;
  }): Promise<void> {
    this.logger.info('Sending PRD updated notification', {
      prdId: request.prdId,
      hasMoreQuestions: request.hasMoreQuestions,
    });

    let statusText: string;
    if (request.hasMoreQuestions) {
      statusText = '⚠️ The PRD has been updated, but additional questions have emerged. Please see the new questions above.';
    } else {
      statusText = '✅ The PRD has been updated with your feedback and is ready for review.';
    }

    const sections: CardSection[] = [
      {
        widgets: [
          {
            type: 'textParagraph',
            data: { text: statusText },
          },
        ],
      },
    ];

    if (request.newConfidence !== undefined) {
      sections.push({
        widgets: [
          {
            type: 'keyValue',
            data: {
              topLabel: 'New AI Confidence',
              content: `${Math.round(request.newConfidence * 100)}%`,
            },
          },
        ],
      });
    }

    if (request.documentUrl) {
      sections.push({
        widgets: [
          {
            type: 'buttons',
            data: {
              buttons: [{ text: 'View Updated Document', url: request.documentUrl }],
            },
          },
        ],
      });
    }

    await this.sendCard({
      header: {
        title: 'PRD Updated',
        subtitle: request.title,
      },
      sections,
      threadKey: request.threadKey,
    });
  }

  /**
   * Send an error notification.
   *
   * @param error - Error details
   * @param context - Additional context
   */
  async sendErrorNotification(
    error: {
      message: string;
      code?: string;
    },
    context?: {
      meetingId?: string;
      taskId?: string;
    }
  ): Promise<void> {
    this.logger.info('Sending error notification', { code: error.code });

    const sections: CardSection[] = [
      {
        widgets: [
          {
            type: 'textParagraph',
            data: { text: `*Error:* ${error.message}` },
          },
        ],
      },
    ];

    if (error.code) {
      sections.push({
        widgets: [
          {
            type: 'keyValue',
            data: {
              topLabel: 'Error Code',
              content: error.code,
            },
          },
        ],
      });
    }

    if (context?.meetingId || context?.taskId) {
      const contextWidgets: CardWidget[] = [];
      if (context.meetingId) {
        contextWidgets.push({
          type: 'keyValue',
          data: { topLabel: 'Meeting ID', content: context.meetingId },
        });
      }
      if (context.taskId) {
        contextWidgets.push({
          type: 'keyValue',
          data: { topLabel: 'Task ID', content: context.taskId },
        });
      }
      sections.push({ widgets: contextWidgets });
    }

    await this.sendCard({
      header: {
        title: 'Error Alert',
        subtitle: 'Workforce AI encountered an issue',
      },
      sections,
    });
  }

  /**
   * Send meeting status update.
   *
   * @param status - Meeting status
   */
  async sendMeetingStatus(
    status: 'joined' | 'transcribing' | 'completed' | 'failed',
    meeting: {
      id: string;
      title: string;
      platform?: string;
    }
  ): Promise<void> {
    const statusEmoji = {
      joined: '[JOINED]',
      transcribing: '[TRANSCRIBING]',
      completed: '[DONE]',
      failed: '[FAILED]',
    };

    const statusText = {
      joined: 'Bot joined the meeting',
      transcribing: 'Transcription in progress',
      completed: 'Meeting transcription complete',
      failed: 'Meeting capture failed',
    };

    await this.sendText({
      text: `${statusEmoji[status]} *${meeting.title}*\n${statusText[status]}`,
      threadKey: `meeting-${meeting.id}`,
    });
  }

  /**
   * Build a widget for the card payload.
   */
  private buildWidget(widget: CardWidget): Record<string, unknown> {
    switch (widget.type) {
      case 'textParagraph':
        return {
          textParagraph: {
            text: widget.data.text,
          },
        };

      case 'keyValue':
        return {
          keyValue: {
            topLabel: widget.data.topLabel,
            content: widget.data.content,
            contentMultiline: widget.data.multiline || false,
          },
        };

      case 'buttons':
        return {
          buttons: (widget.data.buttons as CardButton[]).map((btn) => ({
            textButton: {
              text: btn.text,
              onClick: btn.url
                ? { openLink: { url: btn.url } }
                : btn.onClick
                  ? { action: btn.onClick }
                  : undefined,
            },
          })),
        };

      case 'image':
        return {
          image: {
            imageUrl: widget.data.url,
            onClick: widget.data.linkUrl
              ? { openLink: { url: widget.data.linkUrl } }
              : undefined,
          },
        };

      default:
        return {};
    }
  }

  /**
   * Send payload to webhook.
   */
  private async send(payload: Record<string, unknown>): Promise<void> {
    if (!this.enabled || !this.webhookUrl) {
      this.logger.debug('Google Chat disabled - skipping message');
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error('Google Chat webhook error', {
          status: response.status,
          body: errorBody,
        });

        throw new AppError(
          `Google Chat webhook failed: ${response.status}`,
          response.status,
          'GCHAT_WEBHOOK_ERROR'
        );
      }

      this.logger.debug('Message sent successfully');

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new AppError('Google Chat request timeout', 504, 'GCHAT_TIMEOUT');
      }

      if (error instanceof AppError) {
        throw error;
      }

      this.logger.error('Failed to send Google Chat message', {
        error: (error as Error).message,
      });

      // Don't throw for notification failures - they shouldn't break the main flow
      // Just log the error
    }
  }
}

/**
 * Card builder for creating Google Chat card messages.
 *
 * Provides a fluent interface for building complex cards.
 *
 * @example
 * ```typescript
 * const card = new CardBuilder()
 *   .setHeader('My Card', 'Subtitle here')
 *   .addTextSection('This is some text content')
 *   .addKeyValueSection('Status', 'Active')
 *   .addButtons([
 *     { text: 'Action 1', url: 'https://...' },
 *     { text: 'Action 2', url: 'https://...' },
 *   ])
 *   .build();
 * ```
 */
export class CardBuilder {
  private header?: CardMessageInput['header'];
  private sections: CardSection[] = [];
  private threadKey?: string;

  /**
   * Set the card header.
   */
  setHeader(title: string, subtitle?: string, imageUrl?: string): this {
    this.header = { title, subtitle, imageUrl };
    return this;
  }

  /**
   * Add a text paragraph section.
   */
  addTextSection(text: string, header?: string): this {
    this.sections.push({
      header,
      widgets: [{ type: 'textParagraph', data: { text } }],
    });
    return this;
  }

  /**
   * Add a key-value pair section.
   */
  addKeyValueSection(label: string, value: string, header?: string): this {
    this.sections.push({
      header,
      widgets: [{ type: 'keyValue', data: { topLabel: label, content: value } }],
    });
    return this;
  }

  /**
   * Add multiple key-value pairs in one section.
   */
  addKeyValuePairs(pairs: Array<{ label: string; value: string }>, header?: string): this {
    this.sections.push({
      header,
      widgets: pairs.map((pair) => ({
        type: 'keyValue' as const,
        data: { topLabel: pair.label, content: pair.value },
      })),
    });
    return this;
  }

  /**
   * Add a buttons section.
   */
  addButtons(buttons: CardButton[], header?: string): this {
    this.sections.push({
      header,
      widgets: [{ type: 'buttons', data: { buttons } }],
    });
    return this;
  }

  /**
   * Set the thread key for message grouping.
   */
  setThreadKey(key: string): this {
    this.threadKey = key;
    return this;
  }

  /**
   * Build the final card message input.
   */
  build(): CardMessageInput {
    return {
      header: this.header,
      sections: this.sections,
      threadKey: this.threadKey,
    };
  }
}
