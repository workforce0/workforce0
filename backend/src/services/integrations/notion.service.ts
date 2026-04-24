/**
 * =============================================================================
 * NOTION INTEGRATION SERVICE
 * =============================================================================
 *
 * Saves approved briefs as Notion pages. Each brief lands in a parent the
 * user has shared with the Workforce0 integration — either a database
 * (preferred, gives us a typed row per brief) or a page (falls back to a
 * sub-page with block content).
 *
 * API Overview
 * ------------
 *   - `GET  https://api.notion.com/v1/users/me`     — connection test
 *   - `GET  https://api.notion.com/v1/search`       — list accessible
 *                                                     pages + databases
 *   - `POST https://api.notion.com/v1/pages`        — create a page
 *   - `GET  https://api.notion.com/v1/databases/:id` — database schema
 *
 * Authentication
 * --------------
 * Internal integration tokens in the `Authorization: Bearer` header.
 * Token format: `secret_...` or `ntn_...` for newer workspaces.
 *
 * Version header
 * --------------
 * Notion REQUIRES `Notion-Version: 2022-06-28`. Without it every request
 * fails with 400 `missing_version`. We hard-code the current stable
 * version; bumping it is a deliberate change.
 *
 * Permission model quirk
 * ----------------------
 * Notion uses per-page sharing. Even with a valid token, the integration
 * only sees pages/databases that have been explicitly shared with it via
 * the Notion UI. `listTargets()` filters by what the integration can see,
 * so the picker in the wizard shows only usable targets.
 *
 * Rate Limits
 * -----------
 * ~3 requests/second per integration. Callers retry on 429.
 *
 * @module services/integrations/notion
 */

import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';

const logger = createChildLogger({ service: 'NotionService' });

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionConfig {
  /** Internal integration token. Starts with `secret_` or `ntn_`. */
  apiKey: string;
  /** Default parent — a database or a plain page — to write briefs into. */
  defaultTarget?: {
    type: 'database' | 'page';
    id: string;
    title: string;
  };
}

export interface NotionTarget {
  type: 'database' | 'page';
  id: string;
  title: string;
  /** True for databases so the UI can warn about typed schemas. */
  isDatabase: boolean;
}

export interface NotionUser {
  id: string;
  name: string;
  type: 'person' | 'bot';
  workspaceName?: string;
}

export interface CreateNotionPageInput {
  /** Override the defaultTarget if set. */
  target?: { type: 'database' | 'page'; id: string };
  title: string;
  /** Markdown-like content. We convert the first pass to Notion blocks. */
  body?: string;
  /** When target is a database, extra database properties to set. */
  databaseProperties?: Record<string, unknown>;
}

export interface CreatedNotionPage {
  id: string;
  url: string;
  title: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  viewer?: NotionUser;
  /** Accessible targets pulled during the connection test, if available. */
  targets?: NotionTarget[];
  code?: string;
}

/**
 * NotionService. Never throws on construction with a `null` config.
 * Callers check `isConfigured()` to render "connected" states.
 */
export class NotionService {
  constructor(private readonly config: NotionConfig | null) {}

  /** Non-throwing config guard. */
  isConfigured(): boolean {
    if (!this.config) return false;
    const k = this.config.apiKey;
    return typeof k === 'string' && (k.startsWith('secret_') || k.startsWith('ntn_'));
  }

  /**
   * Verify the token against `/users/me` and opportunistically pull the
   * list of accessible targets so the wizard can show the picker in one
   * round-trip.
   */
  async test(): Promise<TestResult> {
    if (!this.config) {
      return { ok: false, message: 'Notion is not connected yet.', code: 'NOT_CONFIGURED' };
    }
    if (!this.isConfigured()) {
      return {
        ok: false,
        message:
          'That does not look like a Notion internal integration secret (should start with secret_ or ntn_).',
        code: 'INVALID_KEY_FORMAT',
      };
    }
    try {
      const viewer = await this.call<{
        id: string;
        name?: string;
        type: 'person' | 'bot';
        bot?: { workspace_name?: string };
      }>('GET', '/users/me');

      const viewerShaped: NotionUser = {
        id: viewer.id,
        name: viewer.name ?? 'Workforce0 Bot',
        type: viewer.type,
        workspaceName: viewer.bot?.workspace_name,
      };

      // Fetch targets, but don't fail the whole test if this part fails —
      // the token could still be valid with zero shared pages.
      let targets: NotionTarget[] = [];
      try {
        targets = await this.listTargets();
      } catch (err) {
        logger.warn('listTargets failed during test()', { error: (err as Error).message });
      }

      const hint =
        targets.length === 0
          ? ' — but you have not shared any Notion page or database with this integration yet. Share a parent page first.'
          : '';

      return {
        ok: true,
        message: `Connected to ${viewerShaped.workspaceName ?? 'Notion'}${hint}`,
        viewer: viewerShaped,
        targets,
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.toLowerCase().includes('unauthorized') || msg.includes('401')) {
        return { ok: false, message: 'Invalid or revoked integration secret.', code: 'INVALID_AUTH' };
      }
      return { ok: false, message: `Could not reach Notion: ${msg}`, code: 'NETWORK_ERROR' };
    }
  }

  /**
   * Every database + page the integration can see. Filters out archived
   * items. Up to 50 of each — enough for the wizard picker.
   */
  async listTargets(): Promise<NotionTarget[]> {
    this.ensureConfigured();
    const data = await this.call<{
      results: Array<{
        object: 'database' | 'page';
        id: string;
        archived?: boolean;
        title?: Array<{ plain_text: string }>;
        properties?: Record<string, { title?: Array<{ plain_text: string }> }>;
      }>;
    }>('POST', '/search', {
      page_size: 50,
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    });

    return data.results
      .filter((r) => !r.archived)
      .map((r): NotionTarget => {
        const title =
          r.object === 'database'
            ? r.title?.map((t) => t.plain_text).join('') || 'Untitled database'
            : extractPageTitle(r.properties) || 'Untitled page';
        return {
          type: r.object,
          id: r.id,
          title,
          isDatabase: r.object === 'database',
        };
      });
  }

  /**
   * Create a page under the target (database row or sub-page).
   * Returns the created page's id and URL.
   */
  async createPage(input: CreateNotionPageInput): Promise<CreatedNotionPage> {
    this.ensureConfigured();
    const target = input.target ?? this.config!.defaultTarget;
    if (!target) {
      throw new AppError(
        'No Notion target selected. Pick a default database or page in Settings → Integrations → Notion.',
        400,
        'NOTION_NO_TARGET',
      );
    }

    const parent =
      target.type === 'database' ? { database_id: target.id } : { page_id: target.id };

    // Database parents require the "title" property key; page parents use a
    // different shape where the first-level title lives under `properties.title.title`.
    const properties =
      target.type === 'database'
        ? {
            Name: {
              title: [{ text: { content: input.title.slice(0, 2000) } }],
            },
            ...(input.databaseProperties ?? {}),
          }
        : {
            title: [{ text: { content: input.title.slice(0, 2000) } }],
          };

    const children = input.body ? markdownToBlocks(input.body) : [];

    const res = await this.call<{
      id: string;
      url: string;
    }>('POST', '/pages', {
      parent,
      properties,
      children,
    });

    logger.info('Notion page created', { id: res.id, targetType: target.type });
    return { id: res.id, url: res.url, title: input.title };
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError('Notion is not connected', 400, 'NOTION_NOT_CONFIGURED');
    }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config!.apiKey}`,
        'Notion-Version': NOTION_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    if (!res.ok) {
      let msg = `Notion HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string; code?: string };
        if (parsed.message) msg = parsed.message;
      } catch {
        msg += `: ${text.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    return JSON.parse(text) as T;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Page title extraction is annoying because it sits under an unknown-named
 *  property whose type is `title`. Find the first such property. */
function extractPageTitle(
  properties?: Record<string, { title?: Array<{ plain_text: string }> }>,
): string | null {
  if (!properties) return null;
  for (const prop of Object.values(properties)) {
    if (prop.title?.length) {
      return prop.title.map((t) => t.plain_text).join('');
    }
  }
  return null;
}

/**
 * Minimal markdown → Notion blocks converter.
 *
 * Handles: paragraphs, `# / ## / ###` headings, `- ` bullet lists.
 * Everything else becomes plain-text paragraphs. A PRD renderer will
 * typically format server-side into this subset before calling.
 *
 * Each block object uses the Notion block type's "rich_text" payload;
 * content is capped at 2000 chars per Notion's limit.
 */
export function markdownToBlocks(md: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const lines = md.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith('### ')) {
      blocks.push(textBlock('heading_3', line.slice(4)));
    } else if (line.startsWith('## ')) {
      blocks.push(textBlock('heading_2', line.slice(3)));
    } else if (line.startsWith('# ')) {
      blocks.push(textBlock('heading_1', line.slice(2)));
    } else if (/^[-*]\s+/.test(line)) {
      blocks.push(textBlock('bulleted_list_item', line.replace(/^[-*]\s+/, '')));
    } else {
      blocks.push(textBlock('paragraph', line));
    }
  }

  return blocks;
}

function textBlock(type: string, content: string): Record<string, unknown> {
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: [{ type: 'text', text: { content: content.slice(0, 2000) } }],
    },
  };
}
