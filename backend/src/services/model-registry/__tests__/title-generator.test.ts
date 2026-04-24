import { describe, it, expect, vi } from 'vitest';
import { cleanTitle, generateTitle } from '../title-generator.js';

describe('cleanTitle', () => {
  it('strips surrounding quotes', () => {
    expect(cleanTitle('"Q3 Planning Review"')).toBe('Q3 Planning Review');
    expect(cleanTitle("'Weekly Update'")).toBe('Weekly Update');
  });

  it('strips trailing punctuation', () => {
    expect(cleanTitle('Board Meeting.')).toBe('Board Meeting');
    expect(cleanTitle('Is This Working??')).toBe('Is This Working');
  });

  it('takes only the first line', () => {
    expect(cleanTitle('Line One\nLine Two\nLine Three')).toBe('Line One');
  });

  it('collapses whitespace', () => {
    expect(cleanTitle('  Too   Much    Space  ')).toBe('Too Much Space');
  });

  it('truncates to 60 chars', () => {
    const long = 'A'.repeat(120);
    expect(cleanTitle(long).length).toBe(60);
  });
});

describe('generateTitle', () => {
  it('returns fallback for empty source', async () => {
    const gen = vi.fn();
    expect(await generateTitle('', gen, 'Untitled')).toBe('Untitled');
    expect(gen).not.toHaveBeenCalled();
  });

  it('returns cleaned title from generator output', async () => {
    const gen = async () => '"Q3 Planning Session"';
    expect(await generateTitle('some transcript', gen)).toBe('Q3 Planning Session');
  });

  it('returns fallback when generator throws', async () => {
    const gen = async () => {
      throw new Error('boom');
    };
    expect(await generateTitle('some transcript', gen, 'Untitled')).toBe('Untitled');
  });

  it('returns fallback when generator returns empty/whitespace', async () => {
    const gen = async () => '   \n\n   ';
    expect(await generateTitle('some transcript', gen, 'Untitled')).toBe('Untitled');
  });

  it('truncates long source before sending to generator', async () => {
    const receivedPrompt = vi.fn(async (p: string) => {
      return 'Sample Title';
    });
    const longSource = 'x'.repeat(10_000);
    await generateTitle(longSource, receivedPrompt);
    const calledWith = receivedPrompt.mock.calls[0]![0];
    expect(calledWith.length).toBeLessThan(5000);
  });
});
