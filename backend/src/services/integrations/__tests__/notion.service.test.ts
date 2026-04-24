import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotionService, markdownToBlocks } from '../notion.service.js';

const originalFetch = globalThis.fetch;

function mockResponse(body: unknown, { status = 200 }: { status?: number } = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

function mockSequence(steps: Array<{ body: unknown; status?: number }>) {
  const fn = vi.fn();
  for (const step of steps) {
    fn.mockResolvedValueOnce(
      new Response(JSON.stringify(step.body), { status: step.status ?? 200 }),
    );
  }
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('NotionService', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('isConfigured', () => {
    it('false when no config', () => {
      expect(new NotionService(null).isConfigured()).toBe(false);
    });
    it('false for wrong prefix', () => {
      expect(new NotionService({ apiKey: 'bad-key' }).isConfigured()).toBe(false);
    });
    it('true for secret_ prefix', () => {
      expect(new NotionService({ apiKey: 'secret_abc' }).isConfigured()).toBe(true);
    });
    it('true for ntn_ prefix (newer tokens)', () => {
      expect(new NotionService({ apiKey: 'ntn_abc' }).isConfigured()).toBe(true);
    });
  });

  describe('test()', () => {
    it('returns NOT_CONFIGURED without config', async () => {
      const r = await new NotionService(null).test();
      expect(r).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
    });

    it('returns INVALID_KEY_FORMAT on wrong prefix', async () => {
      const r = await new NotionService({ apiKey: 'oops' }).test();
      expect(r).toMatchObject({ ok: false, code: 'INVALID_KEY_FORMAT' });
    });

    it('returns INVALID_AUTH on 401', async () => {
      mockResponse({ message: 'unauthorized', code: 'unauthorized' }, { status: 401 });
      const r = await new NotionService({ apiKey: 'secret_test' }).test();
      expect(r).toMatchObject({ ok: false, code: 'INVALID_AUTH' });
    });

    it('succeeds with viewer + targets', async () => {
      mockSequence([
        { body: { id: 'bot-1', name: 'Workforce0 Bot', type: 'bot', bot: { workspace_name: 'Acme' } } },
        { body: { results: [{ object: 'database', id: 'db-1', title: [{ plain_text: 'Briefs' }] }] } },
      ]);
      const r = await new NotionService({ apiKey: 'secret_test' }).test();
      expect(r.ok).toBe(true);
      expect(r.viewer?.workspaceName).toBe('Acme');
      expect(r.targets).toHaveLength(1);
      expect(r.targets![0]!.title).toBe('Briefs');
      expect(r.message).toContain('Acme');
    });

    it('hints when no targets shared yet', async () => {
      mockSequence([
        { body: { id: 'bot-1', type: 'bot', bot: { workspace_name: 'Acme' } } },
        { body: { results: [] } },
      ]);
      const r = await new NotionService({ apiKey: 'secret_test' }).test();
      expect(r.ok).toBe(true);
      expect(r.targets).toHaveLength(0);
      expect(r.message).toMatch(/share a parent page/i);
    });

    it('succeeds even if target listing fails', async () => {
      mockSequence([
        { body: { id: 'bot-1', type: 'bot' } },
        { body: { message: 'search broke' }, status: 500 },
      ]);
      const r = await new NotionService({ apiKey: 'secret_test' }).test();
      expect(r.ok).toBe(true);
      expect(r.targets).toEqual([]);
    });
  });

  describe('listTargets()', () => {
    it('filters archived items and labels type/isDatabase', async () => {
      mockResponse({
        results: [
          { object: 'database', id: 'd1', title: [{ plain_text: 'DB' }], archived: false },
          { object: 'page', id: 'p1', properties: { Name: { title: [{ plain_text: 'Page' }] } }, archived: false },
          { object: 'page', id: 'p2', archived: true, properties: {} },
        ],
      });
      const targets = await new NotionService({ apiKey: 'secret_test' }).listTargets();
      expect(targets).toHaveLength(2);
      expect(targets[0]).toMatchObject({ type: 'database', isDatabase: true, title: 'DB' });
      expect(targets[1]).toMatchObject({ type: 'page', isDatabase: false, title: 'Page' });
    });

    it('throws when not configured', async () => {
      await expect(new NotionService(null).listTargets()).rejects.toThrow(/not connected/);
    });
  });

  describe('createPage()', () => {
    it('throws without a target', async () => {
      const svc = new NotionService({ apiKey: 'secret_test' });
      await expect(svc.createPage({ title: 't' })).rejects.toThrow(/No Notion target/);
    });

    it('uses defaultTarget when not overridden', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'new-page', url: 'https://notion.so/x' }), { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const svc = new NotionService({
        apiKey: 'secret_test',
        defaultTarget: { type: 'database', id: 'db-default', title: 'Briefs' },
      });
      await svc.createPage({ title: 'New brief', body: '# Hello\n\n- point' });

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.parent).toEqual({ database_id: 'db-default' });
      expect(body.properties.Name.title[0].text.content).toBe('New brief');
    });

    it('uses page_id parent for non-database targets', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'p-1', url: 'https://notion.so/y' }), { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const svc = new NotionService({
        apiKey: 'secret_test',
        defaultTarget: { type: 'page', id: 'pg-1', title: 'Parent' },
      });
      await svc.createPage({ title: 'Child' });

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.parent).toEqual({ page_id: 'pg-1' });
      expect(body.properties.title).toBeDefined();
    });

    it('sends Notion-Version header on every call', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'p', url: 'https://n.so/p' }), { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await new NotionService({
        apiKey: 'secret_test',
        defaultTarget: { type: 'page', id: 'pg', title: 'P' },
      }).createPage({ title: 't' });

      const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers['Notion-Version']).toBeDefined();
      expect(headers.Authorization).toBe('Bearer secret_test');
    });
  });
});

describe('markdownToBlocks', () => {
  it('handles headings and paragraphs', () => {
    const blocks = markdownToBlocks('# H1\n## H2\n### H3\nbody');
    expect(blocks[0]).toMatchObject({ type: 'heading_1' });
    expect(blocks[1]).toMatchObject({ type: 'heading_2' });
    expect(blocks[2]).toMatchObject({ type: 'heading_3' });
    expect(blocks[3]).toMatchObject({ type: 'paragraph' });
  });

  it('handles bullet lists with - and *', () => {
    const blocks = markdownToBlocks('- alpha\n* beta');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'bulleted_list_item' });
    expect(blocks[1]).toMatchObject({ type: 'bulleted_list_item' });
  });

  it('drops blank lines', () => {
    const blocks = markdownToBlocks('line1\n\n\nline2');
    expect(blocks).toHaveLength(2);
  });

  it('caps content at 2000 chars', () => {
    const long = 'x'.repeat(5000);
    const blocks = markdownToBlocks(long);
    const rich = (blocks[0] as { paragraph: { rich_text: Array<{ text: { content: string } }> } })
      .paragraph.rich_text;
    expect(rich[0]!.text.content.length).toBe(2000);
  });
});
