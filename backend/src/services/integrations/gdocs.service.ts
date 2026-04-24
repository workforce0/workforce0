/**
 * =============================================================================
 * GOOGLE DOCS SERVICE
 * =============================================================================
 *
 * Integration with Google Docs API for exporting PRDs.
 *
 * Features:
 * ---------
 * - Create new Google Doc from PRD content
 * - Format PRD with proper headings, lists, tables
 * - Share document with specified users
 * - Store in configurable Google Drive folder
 *
 * Authentication:
 * ---------------
 * Uses Google Service Account credentials (JSON key file).
 * The service account must have:
 * - Google Docs API enabled
 * - Google Drive API enabled
 * - Access to the target Drive folder (if specified)
 *
 * @module services/integrations/gdocs
 */

import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'GoogleDocsService' });

/**
 * PRD content structure for export.
 * This matches the comprehensive GeneratedPRD interface from gemini.service.ts
 */
export interface PRDExportContent {
  metadata: {
    version: string;
    generatedAt: string;
    meetingDate?: string;
    participants?: string[];
  };
  title: string;
  executiveSummary: {
    overview: string;
    valueProposition: string[];
    coreCapabilities: string[];
    keyDifferentiators?: string[];
  };
  problemStatement: {
    currentState: string;
    problems: string[];
    marketOpportunity?: string;
  };
  goals: {
    vision: string;
    objectives: Array<{
      objective: string;
      metric: string;
      target: string;
    }>;
    successCriteria: string[];
  };
  scope: {
    inScope: string[];
    outOfScope: string[];
    futureConsiderations?: string[];
  };
  userStories: Array<{
    id: string;
    persona: string;
    story: string;
    priority: 'must-have' | 'should-have' | 'nice-to-have';
    acceptanceCriteria: string[];
  }>;
  functionalRequirements: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    priority: 'must-have' | 'should-have' | 'nice-to-have';
  }>;
  nonFunctionalRequirements: {
    performance?: string[];
    security?: string[];
    scalability?: string[];
    usability?: string[];
    reliability?: string[];
  };
  successMetrics: Array<{
    name: string;
    description: string;
    target: string;
    measurement: string;
  }>;
  risks: Array<{
    description: string;
    impact: 'high' | 'medium' | 'low';
    probability: 'high' | 'medium' | 'low';
    mitigation: string;
  }>;
  assumptions: string[];
  openQuestions: string[];
  timeline?: {
    estimatedDuration?: string;
    phases?: Array<{
      name: string;
      duration: string;
      deliverables: string[];
    }>;
  };
  confidence: number;
  reasoning?: string;
}

/**
 * Result of creating a Google Doc.
 */
export interface CreateDocResult {
  documentId: string;
  documentUrl: string;
  title: string;
}

/**
 * Google Docs service configuration.
 */
export interface GoogleDocsConfig {
  credentials?: {
    client_email: string;
    private_key: string;
    project_id: string;
  };
  credentialsPath?: string;
  defaultFolderId?: string;
}

/**
 * Google Docs Service for PRD export.
 *
 * @example
 * ```typescript
 * const gdocs = new GoogleDocsService({
 *   credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
 *   defaultFolderId: 'folder_id_from_drive',
 * });
 *
 * const result = await gdocs.createPRDDocument({
 *   title: 'User Authentication PRD',
 *   summary: 'Implement OAuth...',
 *   // ... rest of PRD content
 * });
 *
 * console.log(`Created: ${result.documentUrl}`);
 * ```
 */
export class GoogleDocsService {
  private docs: any = null;
  private drive: any = null;
  private readonly config: GoogleDocsConfig;
  private initialized = false;

  constructor(config: GoogleDocsConfig) {
    this.config = config;

    if (!config.credentials && !config.credentialsPath) {
      logger.warn('GoogleDocsService: No credentials provided, service will be disabled');
      return;
    }

    logger.info('GoogleDocsService initialized', {
      hasCredentials: !!config.credentials,
      hasCredentialsPath: !!config.credentialsPath,
      hasFolderId: !!config.defaultFolderId,
    });
  }

  /**
   * Check if the service is available (credentials configured).
   */
  isAvailable(): boolean {
    return !!(this.config.credentials || this.config.credentialsPath);
  }

  /**
   * Initialize Google API clients lazily.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (!this.isAvailable()) {
      throw new Error('GoogleDocsService not configured');
    }

    try {
      // Dynamic import to avoid loading googleapis if not needed
      const { google } = await import('googleapis');

      let auth;
      if (this.config.credentials) {
        auth = new google.auth.GoogleAuth({
          credentials: this.config.credentials,
          scopes: [
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/drive.file',
          ],
        });
      } else if (this.config.credentialsPath) {
        auth = new google.auth.GoogleAuth({
          keyFile: this.config.credentialsPath,
          scopes: [
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/drive.file',
          ],
        });
      }

      this.docs = google.docs({ version: 'v1', auth });
      this.drive = google.drive({ version: 'v3', auth });
      this.initialized = true;

      logger.info('Google APIs initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Google APIs', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create a Google Doc from PRD content.
   *
   * @param content - PRD content to export
   * @param options - Additional options
   * @returns Created document info
   */
  async createPRDDocument(
    content: PRDExportContent,
    options: {
      folderId?: string;
      shareWith?: string[];
    } = {}
  ): Promise<CreateDocResult> {
    await this.ensureInitialized();

    const docTitle = `PRD: ${content.title}`;

    logger.info('Creating PRD document', {
      title: docTitle,
      hasFolder: !!(options.folderId || this.config.defaultFolderId),
    });

    try {
      // Step 1: Create document in a Shared Drive using Drive API
      // IMPORTANT: Service Accounts cannot create files in regular Google Drive folders
      // (even if shared with them) because they have no storage quota.
      // The folderId MUST be a Shared Drive ID or a folder within a Shared Drive.
      // See: https://developers.google.com/drive/api/guides/about-shareddrives
      const folderId = options.folderId || this.config.defaultFolderId;

      const createResponse = await this.drive.files.create({
        requestBody: {
          name: docTitle,
          mimeType: 'application/vnd.google-apps.document',
          parents: folderId ? [folderId] : undefined,
        },
        fields: 'id',
        supportsAllDrives: true,
      });

      const documentId = createResponse.data.id;
      if (!documentId) {
        throw new Error('Failed to create document - no ID returned');
      }

      // Step 2: Add content with formatting using Docs API
      const requests = this.buildDocumentRequests(content);

      if (requests.length > 0) {
        await this.docs.documents.batchUpdate({
          documentId,
          requestBody: { requests },
        });
      }

      // Step 3: Share with specified users
      if (options.shareWith && options.shareWith.length > 0) {
        await this.shareDocument(documentId, options.shareWith);
      }

      const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;

      logger.info('PRD document created successfully', {
        documentId,
        documentUrl,
      });

      return {
        documentId,
        documentUrl,
        title: docTitle,
      };
    } catch (error) {
      logger.error('Failed to create PRD document', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Update an existing PRD document with new content.
   *
   * This is used when the PRD is regenerated after receiving clarification
   * responses. The document is cleared and replaced with the updated content,
   * and a revision note is added to track the update history.
   *
   * @param documentId - The Google Docs document ID to update
   * @param content - Updated PRD content
   * @param options - Update options
   * @returns Updated document info
   */
  async updatePRDDocument(
    documentId: string,
    content: PRDExportContent,
    options: {
      revisionNote?: string;
      answeredQuestions?: Array<{ questionId: string; answer: string }>;
    } = {}
  ): Promise<CreateDocResult> {
    await this.ensureInitialized();

    logger.info('Updating PRD document', {
      documentId,
      title: content.title,
      hasRevisionNote: !!options.revisionNote,
      answeredQuestionsCount: options.answeredQuestions?.length || 0,
    });

    try {
      // Step 1: Get current document to find content length
      const docResponse = await this.docs.documents.get({
        documentId,
      });

      const doc = docResponse.data;
      const endIndex = doc.body?.content?.[doc.body.content.length - 1]?.endIndex || 1;

      // Step 2: Delete all content except the first character (required by API)
      if (endIndex > 2) {
        await this.docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: [
              {
                deleteContentRange: {
                  range: {
                    startIndex: 1,
                    endIndex: endIndex - 1,
                  },
                },
              },
            ],
          },
        });
      }

      // Step 3: Build and insert new content with revision header
      const requests = this.buildDocumentRequestsWithRevision(
        content,
        options.revisionNote,
        options.answeredQuestions
      );

      if (requests.length > 0) {
        await this.docs.documents.batchUpdate({
          documentId,
          requestBody: { requests },
        });
      }

      const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
      const docTitle = `PRD: ${content.title}`;

      logger.info('PRD document updated successfully', {
        documentId,
        documentUrl,
        revisionNote: options.revisionNote,
      });

      return {
        documentId,
        documentUrl,
        title: docTitle,
      };
    } catch (error) {
      logger.error('Failed to update PRD document', {
        documentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Build document requests with an optional revision header.
   *
   * Adds a "Revision History" section at the top if this is an update
   * from clarification responses.
   */
  private buildDocumentRequestsWithRevision(
    content: PRDExportContent,
    revisionNote?: string,
    answeredQuestions?: Array<{ questionId: string; answer: string }>
  ): any[] {
    const requests: any[] = [];
    let currentIndex = 1;

    // Color definitions
    const colors = {
      primary: { red: 0.2, green: 0.4, blue: 0.7 },
      success: { red: 0.2, green: 0.6, blue: 0.3 },
      warning: { red: 0.9, green: 0.6, blue: 0.1 },
      danger: { red: 0.8, green: 0.2, blue: 0.2 },
      muted: { red: 0.5, green: 0.5, blue: 0.5 },
      dark: { red: 0.2, green: 0.2, blue: 0.2 },
      purple: { red: 0.5, green: 0.3, blue: 0.7 },
    };

    // Helper to add text
    const addText = (text: string, paragraphStyle?: any) => {
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text,
        },
      });

      if (paragraphStyle) {
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + text.length,
            },
            paragraphStyle: paragraphStyle,
            fields: Object.keys(paragraphStyle).join(','),
          },
        });
      }

      currentIndex += text.length;
    };

    // Helper to add formatted text
    const addFormattedText = (
      text: string,
      options: {
        bold?: boolean;
        italic?: boolean;
        color?: { red: number; green: number; blue: number };
        fontSize?: number;
        paragraphStyle?: any;
      } = {}
    ) => {
      const startIndex = currentIndex;
      addText(text, options.paragraphStyle);

      const textStyle: any = {};
      if (options.bold) textStyle.bold = true;
      if (options.italic) textStyle.italic = true;
      if (options.color) textStyle.foregroundColor = { color: { rgbColor: options.color } };
      if (options.fontSize) textStyle.fontSize = { magnitude: options.fontSize, unit: 'PT' };

      if (Object.keys(textStyle).length > 0) {
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: startIndex,
              endIndex: startIndex + text.length,
            },
            textStyle: textStyle,
            fields: Object.keys(textStyle).join(','),
          },
        });
      }
    };

    // If there's a revision note or answered questions, add revision header
    if (revisionNote || (answeredQuestions && answeredQuestions.length > 0)) {
      addFormattedText('📝 REVISION UPDATE\n', { bold: true, color: colors.purple, fontSize: 12 });
      addFormattedText(`Updated: ${new Date().toISOString()}\n`, { color: colors.muted, italic: true });

      if (revisionNote) {
        addFormattedText(`Reason: ${revisionNote}\n`, { color: colors.dark });
      }

      if (answeredQuestions && answeredQuestions.length > 0) {
        addFormattedText('\nClarifications Incorporated:\n', { bold: true, color: colors.muted });
        for (const qa of answeredQuestions) {
          addFormattedText(`  ${qa.questionId}: `, { bold: true, color: colors.primary });
          addFormattedText(`${qa.answer}\n`, { italic: true });
        }
      }

      // Divider after revision header
      addFormattedText('\n' + '━'.repeat(60) + '\n\n', { color: colors.muted });
    }

    // Now add the main document content using the existing builder
    // We need to continue from currentIndex, so we'll inline the main content building
    const mainRequests = this.buildDocumentRequests(content);

    // Offset all indexes in mainRequests by current position
    for (const req of mainRequests) {
      if (req.insertText) {
        req.insertText.location.index += currentIndex - 1;
      }
      if (req.updateParagraphStyle) {
        req.updateParagraphStyle.range.startIndex += currentIndex - 1;
        req.updateParagraphStyle.range.endIndex += currentIndex - 1;
      }
      if (req.updateTextStyle) {
        req.updateTextStyle.range.startIndex += currentIndex - 1;
        req.updateTextStyle.range.endIndex += currentIndex - 1;
      }
      requests.push(req);
    }

    return requests;
  }

  /**
   * Build Google Docs API requests for comprehensive PRD content.
   *
   * Creates an executive-quality document with proper formatting:
   * - Document header with metadata
   * - Executive Summary
   * - Problem Statement
   * - Goals & Objectives
   * - Scope
   * - User Stories
   * - Functional Requirements
   * - Non-Functional Requirements
   * - Success Metrics
   * - Risks
   * - Assumptions
   * - Open Questions
   * - Timeline
   */
  private buildDocumentRequests(content: PRDExportContent): any[] {
    const requests: any[] = [];
    let currentIndex = 1; // Google Docs index starts at 1

    // Color definitions
    const colors = {
      primary: { red: 0.2, green: 0.4, blue: 0.7 },      // Blue
      success: { red: 0.2, green: 0.6, blue: 0.3 },      // Green
      warning: { red: 0.9, green: 0.6, blue: 0.1 },      // Orange
      danger: { red: 0.8, green: 0.2, blue: 0.2 },       // Red
      muted: { red: 0.5, green: 0.5, blue: 0.5 },        // Gray
      dark: { red: 0.2, green: 0.2, blue: 0.2 },         // Dark gray
    };

    // Helper to add text with optional paragraph style
    const addText = (text: string, paragraphStyle?: any) => {
      requests.push({
        insertText: {
          location: { index: currentIndex },
          text: text,
        },
      });

      if (paragraphStyle) {
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: currentIndex,
              endIndex: currentIndex + text.length,
            },
            paragraphStyle: paragraphStyle,
            fields: Object.keys(paragraphStyle).join(','),
          },
        });
      }

      currentIndex += text.length;
    };

    // Helper to add text with character formatting (bold, italic, color)
    const addFormattedText = (
      text: string,
      options: {
        bold?: boolean;
        italic?: boolean;
        color?: { red: number; green: number; blue: number };
        fontSize?: number;
        paragraphStyle?: any;
      } = {}
    ) => {
      const startIndex = currentIndex;
      addText(text, options.paragraphStyle);

      const textStyle: any = {};
      if (options.bold) textStyle.bold = true;
      if (options.italic) textStyle.italic = true;
      if (options.color) textStyle.foregroundColor = { color: { rgbColor: options.color } };
      if (options.fontSize) textStyle.fontSize = { magnitude: options.fontSize, unit: 'PT' };

      if (Object.keys(textStyle).length > 0) {
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: startIndex,
              endIndex: startIndex + text.length,
            },
            textStyle: textStyle,
            fields: Object.keys(textStyle).join(','),
          },
        });
      }
    };

    // Helper to add heading with color
    const addHeading = (
      text: string,
      level: 'HEADING_1' | 'HEADING_2' | 'HEADING_3',
      color?: { red: number; green: number; blue: number }
    ) => {
      const startIndex = currentIndex;
      addText(text + '\n', { namedStyleType: level });

      if (color) {
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: startIndex,
              endIndex: startIndex + text.length,
            },
            textStyle: {
              foregroundColor: { color: { rgbColor: color } },
            },
            fields: 'foregroundColor',
          },
        });
      }
    };

    // Helper to add a styled label (bold with color)
    const addLabel = (label: string, value: string, labelColor?: { red: number; green: number; blue: number }) => {
      addFormattedText(label, { bold: true, color: labelColor || colors.muted });
      addText(` ${value}\n`);
    };

    // Helper to add bullet list with optional styling
    const addBulletList = (items: string[], bulletColor?: { red: number; green: number; blue: number }) => {
      for (const item of items) {
        if (bulletColor) {
          addFormattedText('• ', { color: bulletColor, bold: true });
          addText(`${item}\n`);
        } else {
          addText(`• ${item}\n`);
        }
      }
    };

    // Helper to add a horizontal divider
    const addDivider = () => {
      addFormattedText('━'.repeat(60) + '\n\n', { color: colors.muted });
    };

    // Helper to add section spacing
    const addSectionBreak = () => {
      addText('\n');
    };

    // =========================================================================
    // DOCUMENT HEADER
    // =========================================================================
    addText('Product Requirements Document\n', { namedStyleType: 'TITLE' });
    addFormattedText(`${content.title}\n\n`, { fontSize: 14, color: colors.dark });

    // Metadata section with styled labels
    addLabel('Version:', content.metadata.version);
    addLabel('Generated:', new Date(content.metadata.generatedAt).toLocaleDateString());
    if (content.metadata.meetingDate) {
      addLabel('Meeting Date:', new Date(content.metadata.meetingDate).toLocaleDateString());
    }
    if (content.metadata.participants && content.metadata.participants.length > 0) {
      addLabel('Participants:', content.metadata.participants.join(', '));
    }

    // Confidence indicator with color coding
    const confidencePercent = content.confidence * 100;
    const confidenceColor = confidencePercent >= 90 ? colors.success :
                           confidencePercent >= 70 ? colors.warning : colors.danger;
    addFormattedText('AI Confidence: ', { bold: true, color: colors.muted });
    addFormattedText(`${confidencePercent.toFixed(0)}%\n\n`, { bold: true, color: confidenceColor });

    addDivider();

    // =========================================================================
    // 1. EXECUTIVE SUMMARY
    // =========================================================================
    addHeading('1. Executive Summary', 'HEADING_1', colors.primary);

    addHeading('1.1 Overview', 'HEADING_2');
    addText(content.executiveSummary.overview + '\n\n');

    if (content.executiveSummary.valueProposition.length > 0) {
      addHeading('1.2 Value Proposition', 'HEADING_2');
      addBulletList(content.executiveSummary.valueProposition, colors.success);
      addSectionBreak();
    }

    if (content.executiveSummary.coreCapabilities.length > 0) {
      addHeading('1.3 Core Capabilities', 'HEADING_2');
      addBulletList(content.executiveSummary.coreCapabilities, colors.primary);
      addSectionBreak();
    }

    if (content.executiveSummary.keyDifferentiators && content.executiveSummary.keyDifferentiators.length > 0) {
      addHeading('1.4 Key Differentiators', 'HEADING_2');
      addBulletList(content.executiveSummary.keyDifferentiators, colors.warning);
      addSectionBreak();
    }

    // =========================================================================
    // 2. PROBLEM STATEMENT
    // =========================================================================
    addHeading('2. Problem Statement', 'HEADING_1', colors.primary);

    addHeading('2.1 Current State', 'HEADING_2');
    addText(content.problemStatement.currentState + '\n\n');

    if (content.problemStatement.problems.length > 0) {
      addHeading('2.2 Problems to Solve', 'HEADING_2');
      addBulletList(content.problemStatement.problems, colors.danger);
      addSectionBreak();
    }

    if (content.problemStatement.marketOpportunity) {
      addHeading('2.3 Market Opportunity', 'HEADING_2');
      addFormattedText(content.problemStatement.marketOpportunity + '\n\n', { italic: true });
    }

    // =========================================================================
    // 3. GOALS & OBJECTIVES
    // =========================================================================
    addHeading('3. Goals & Objectives', 'HEADING_1', colors.primary);

    addHeading('3.1 Vision', 'HEADING_2');
    addFormattedText(content.goals.vision + '\n\n', { italic: true, color: colors.dark });

    if (content.goals.objectives.length > 0) {
      addHeading('3.2 Measurable Objectives', 'HEADING_2');
      for (const obj of content.goals.objectives) {
        addFormattedText(`${obj.objective}\n`, { bold: true });
        addLabel('    Metric:', obj.metric, colors.primary);
        addLabel('    Target:', obj.target, colors.success);
        addText('\n');
      }
    }

    if (content.goals.successCriteria.length > 0) {
      addHeading('3.3 Success Criteria', 'HEADING_2');
      for (const criterion of content.goals.successCriteria) {
        addFormattedText('☐ ', { color: colors.primary, bold: true });
        addText(`${criterion}\n`);
      }
      addSectionBreak();
    }

    // =========================================================================
    // 4. SCOPE
    // =========================================================================
    addHeading('4. Scope', 'HEADING_1', colors.primary);

    if (content.scope.inScope.length > 0) {
      addHeading('4.1 In Scope', 'HEADING_2');
      for (const item of content.scope.inScope) {
        addFormattedText('✓ ', { color: colors.success, bold: true });
        addText(`${item}\n`);
      }
      addSectionBreak();
    }

    if (content.scope.outOfScope.length > 0) {
      addHeading('4.2 Out of Scope', 'HEADING_2');
      for (const item of content.scope.outOfScope) {
        addFormattedText('✗ ', { color: colors.danger, bold: true });
        addText(`${item}\n`);
      }
      addSectionBreak();
    }

    if (content.scope.futureConsiderations && content.scope.futureConsiderations.length > 0) {
      addHeading('4.3 Future Considerations', 'HEADING_2');
      addBulletList(content.scope.futureConsiderations, colors.muted);
      addSectionBreak();
    }

    // =========================================================================
    // 5. USER STORIES
    // =========================================================================
    if (content.userStories.length > 0) {
      addHeading('5. User Stories', 'HEADING_1', colors.primary);

      // Group by priority
      const mustHave = content.userStories.filter(s => s.priority === 'must-have');
      const shouldHave = content.userStories.filter(s => s.priority === 'should-have');
      const niceToHave = content.userStories.filter(s => s.priority === 'nice-to-have');

      if (mustHave.length > 0) {
        addHeading('5.1 Must Have (P0)', 'HEADING_2');
        for (const story of mustHave) {
          addFormattedText(`[${story.id}] `, { bold: true, color: colors.danger });
          addFormattedText(`${story.persona}\n`, { bold: true });
          addText(`${story.story}\n`);
          if (story.acceptanceCriteria.length > 0) {
            addFormattedText('Acceptance Criteria:\n', { bold: true, color: colors.muted });
            for (const ac of story.acceptanceCriteria) {
              addFormattedText('  ✓ ', { color: colors.success });
              addText(`${ac}\n`);
            }
          }
          addText('\n');
        }
      }

      if (shouldHave.length > 0) {
        addHeading('5.2 Should Have (P1)', 'HEADING_2');
        for (const story of shouldHave) {
          addFormattedText(`[${story.id}] `, { bold: true, color: colors.warning });
          addFormattedText(`${story.persona}\n`, { bold: true });
          addText(`${story.story}\n\n`);
        }
      }

      if (niceToHave.length > 0) {
        addHeading('5.3 Nice to Have (P2)', 'HEADING_2');
        for (const story of niceToHave) {
          addFormattedText(`[${story.id}] `, { bold: true, color: colors.success });
          addFormattedText(`${story.persona}\n`, { bold: true });
          addText(`${story.story}\n\n`);
        }
      }
    }

    // =========================================================================
    // 6. FUNCTIONAL REQUIREMENTS
    // =========================================================================
    if (content.functionalRequirements.length > 0) {
      addHeading('6. Functional Requirements', 'HEADING_1', colors.primary);

      // Group by category
      const categories = [...new Set(content.functionalRequirements.map(r => r.category))];
      let catIndex = 1;
      for (const category of categories) {
        addHeading(`6.${catIndex} ${category}`, 'HEADING_2');
        const reqs = content.functionalRequirements.filter(r => r.category === category);
        for (const req of reqs) {
          const priorityColor = req.priority === 'must-have' ? colors.danger :
                               req.priority === 'should-have' ? colors.warning : colors.success;
          addFormattedText(`[${req.id}] `, { bold: true, color: priorityColor });
          addFormattedText(`${req.title}\n`, { bold: true });
          addText(`   ${req.description}\n\n`);
        }
        catIndex++;
      }
    }

    // =========================================================================
    // 7. NON-FUNCTIONAL REQUIREMENTS
    // =========================================================================
    const nfr = content.nonFunctionalRequirements;
    const hasNFR = (nfr.performance?.length || 0) + (nfr.security?.length || 0) +
                   (nfr.scalability?.length || 0) + (nfr.usability?.length || 0) +
                   (nfr.reliability?.length || 0) > 0;

    if (hasNFR) {
      addHeading('7. Non-Functional Requirements', 'HEADING_1', colors.primary);

      if (nfr.performance && nfr.performance.length > 0) {
        addHeading('7.1 Performance', 'HEADING_2');
        addBulletList(nfr.performance, colors.warning);
        addSectionBreak();
      }

      if (nfr.security && nfr.security.length > 0) {
        addHeading('7.2 Security', 'HEADING_2');
        addBulletList(nfr.security, colors.danger);
        addSectionBreak();
      }

      if (nfr.scalability && nfr.scalability.length > 0) {
        addHeading('7.3 Scalability', 'HEADING_2');
        addBulletList(nfr.scalability, colors.primary);
        addSectionBreak();
      }

      if (nfr.usability && nfr.usability.length > 0) {
        addHeading('7.4 Usability', 'HEADING_2');
        addBulletList(nfr.usability, colors.success);
        addSectionBreak();
      }

      if (nfr.reliability && nfr.reliability.length > 0) {
        addHeading('7.5 Reliability', 'HEADING_2');
        addBulletList(nfr.reliability, colors.primary);
        addSectionBreak();
      }
    }

    // =========================================================================
    // 8. SUCCESS METRICS
    // =========================================================================
    if (content.successMetrics.length > 0) {
      addHeading('8. Success Metrics', 'HEADING_1', colors.primary);
      for (const metric of content.successMetrics) {
        addFormattedText(`${metric.name}\n`, { bold: true, color: colors.dark });
        addText(`   ${metric.description}\n`);
        addLabel('   Target:', metric.target, colors.success);
        addLabel('   Measurement:', metric.measurement, colors.primary);
        addText('\n');
      }
    }

    // =========================================================================
    // 9. RISKS & MITIGATIONS
    // =========================================================================
    if (content.risks.length > 0) {
      addHeading('9. Risks & Mitigations', 'HEADING_1', colors.primary);
      for (const risk of content.risks) {
        const impactColor = risk.impact === 'high' ? colors.danger :
                           risk.impact === 'medium' ? colors.warning : colors.success;
        addFormattedText(`${risk.description}\n`, { bold: true });
        addFormattedText('   Impact: ', { color: colors.muted });
        addFormattedText(`${risk.impact.toUpperCase()}`, { bold: true, color: impactColor });
        addFormattedText(' | Probability: ', { color: colors.muted });
        addFormattedText(`${risk.probability.toUpperCase()}\n`, { bold: true });
        addFormattedText('   Mitigation: ', { color: colors.muted, italic: true });
        addText(`${risk.mitigation}\n\n`);
      }
    }

    // =========================================================================
    // 10. ASSUMPTIONS
    // =========================================================================
    if (content.assumptions.length > 0) {
      addHeading('10. Assumptions', 'HEADING_1', colors.primary);
      addBulletList(content.assumptions, colors.muted);
      addSectionBreak();
    }

    // =========================================================================
    // 11. OPEN QUESTIONS (ACTION REQUIRED)
    // =========================================================================
    if (content.openQuestions.length > 0) {
      addHeading('11. Open Questions', 'HEADING_1', colors.danger);
      addFormattedText('⚠️ ACTION REQUIRED: ', { bold: true, color: colors.danger });
      addText('The following items need clarification from stakeholders.\n');
      addFormattedText('Reply to these questions in Google Chat to update this PRD.\n\n', { italic: true, color: colors.muted });
      for (let i = 0; i < content.openQuestions.length; i++) {
        addFormattedText(`Q${i + 1}. `, { bold: true, color: colors.danger });
        addText(`${content.openQuestions[i]}\n`);
        addFormattedText('    Answer: ', { color: colors.muted, italic: true });
        addText('_________________________________\n\n');
      }
    }

    // =========================================================================
    // 12. TIMELINE
    // =========================================================================
    if (content.timeline) {
      addHeading('12. Timeline', 'HEADING_1', colors.primary);

      if (content.timeline.estimatedDuration) {
        addFormattedText('Estimated Duration: ', { bold: true, color: colors.muted });
        addFormattedText(`${content.timeline.estimatedDuration}\n\n`, { bold: true, color: colors.dark });
      }

      if (content.timeline.phases && content.timeline.phases.length > 0) {
        for (const phase of content.timeline.phases) {
          addHeading(`Phase: ${phase.name}`, 'HEADING_2');
          addLabel('Duration:', phase.duration, colors.primary);
          addFormattedText('Deliverables:\n', { bold: true, color: colors.muted });
          addBulletList(phase.deliverables, colors.success);
          addSectionBreak();
        }
      }
    }

    // =========================================================================
    // FOOTER
    // =========================================================================
    addDivider();
    addFormattedText('Generated by Workforce0 AI\n', { italic: true, color: colors.muted });
    addFormattedText(`${new Date().toISOString()}\n`, { color: colors.muted });
    if (content.reasoning) {
      addSectionBreak();
      addFormattedText('AI Analysis Notes:\n', { bold: true, color: colors.muted });
      addFormattedText(`${content.reasoning}\n`, { italic: true, color: colors.muted });
    }

    return requests;
  }

  /**
   * Move document to a specific Drive folder.
   */
  private async moveToFolder(documentId: string, folderId: string): Promise<void> {
    try {
      // Get current parents
      const file = await this.drive.files.get({
        fileId: documentId,
        fields: 'parents',
      });

      const previousParents = file.data.parents?.join(',') || '';

      // Move to new folder
      await this.drive.files.update({
        fileId: documentId,
        addParents: folderId,
        removeParents: previousParents,
        fields: 'id, parents',
      });

      logger.debug('Document moved to folder', { documentId, folderId });
    } catch (error) {
      logger.warn('Failed to move document to folder', {
        documentId,
        folderId,
        error: (error as Error).message,
      });
      // Don't throw - document is still created
    }
  }

  /**
   * Share document with specified email addresses.
   */
  private async shareDocument(documentId: string, emails: string[]): Promise<void> {
    for (const email of emails) {
      try {
        await this.drive.permissions.create({
          fileId: documentId,
          requestBody: {
            type: 'user',
            role: 'writer',
            emailAddress: email,
          },
          sendNotificationEmail: true,
        });

        logger.debug('Document shared', { documentId, email });
      } catch (error) {
        logger.warn('Failed to share document', {
          documentId,
          email,
          error: (error as Error).message,
        });
        // Continue with other emails
      }
    }
  }

  /**
   * Get document metadata.
   */
  async getDocument(documentId: string): Promise<{
    title: string;
    url: string;
    lastModified: Date;
  } | null> {
    await this.ensureInitialized();

    try {
      const response = await this.docs.documents.get({
        documentId,
      });

      return {
        title: response.data.title,
        url: `https://docs.google.com/document/d/${documentId}/edit`,
        lastModified: new Date(), // Would need Drive API for actual lastModified
      };
    } catch (error) {
      logger.error('Failed to get document', {
        documentId,
        error: (error as Error).message,
      });
      return null;
    }
  }
}
