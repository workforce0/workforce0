import { describe, it, expect, vi } from 'vitest';
import { TranscriptionService } from '../transcription.service.js';
import type { STTProviderRouter } from '../../stt/stt-router.service.js';
import type { TranscribeResult } from '../../stt/stt-provider.types.js';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

/** Build a fake STTProviderRouter that resolves with a stub TranscribeResult. */
function fakeRouter(result: TranscribeResult): STTProviderRouter {
  return {
    transcribe: vi.fn().mockResolvedValue(result),
  } as unknown as STTProviderRouter;
}

describe('TranscriptionService', () => {
  describe('isEnabled', () => {
    it('returns false when no API key and no router are provided', () => {
      const service = new TranscriptionService('');
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when API key is provided', () => {
      const service = new TranscriptionService('sk-test-key-123');
      expect(service.isEnabled()).toBe(true);
    });

    it('returns true when an STTProviderRouter is provided even without API key', () => {
      const router = fakeRouter({ text: '', segments: [], durationSec: 0, language: 'en' });
      const service = new TranscriptionService('', router);
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('calculateChunks', () => {
    const service = new TranscriptionService('sk-test-key');

    it('returns empty array for zero-size file', () => {
      const chunks = service.calculateChunks(0);
      expect(chunks).toHaveLength(0);
    });

    it('returns empty array for negative size', () => {
      const chunks = service.calculateChunks(-1);
      expect(chunks).toHaveLength(0);
    });

    it('returns single chunk for file under 24MB', () => {
      const size = 10 * 1024 * 1024; // 10MB
      const chunks = service.calculateChunks(size);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ start: 0, end: size });
    });

    it('returns single chunk for file exactly 24MB', () => {
      const size = 24 * 1024 * 1024; // 24MB
      const chunks = service.calculateChunks(size);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ start: 0, end: size });
    });

    it('returns multiple chunks for file over 24MB', () => {
      const size = 60 * 1024 * 1024; // 60MB
      const chunkSize = 24 * 1024 * 1024; // 24MB
      const chunks = service.calculateChunks(size);

      // 60MB / 24MB = 2.5 -> 3 chunks
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ start: 0, end: chunkSize });
      expect(chunks[1]).toEqual({ start: chunkSize, end: chunkSize * 2 });
      expect(chunks[2]).toEqual({ start: chunkSize * 2, end: size });
    });

    it('returns two chunks for file slightly over 24MB', () => {
      const chunkSize = 24 * 1024 * 1024;
      const size = chunkSize + 1; // 24MB + 1 byte
      const chunks = service.calculateChunks(size);

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ start: 0, end: chunkSize });
      expect(chunks[1]).toEqual({ start: chunkSize, end: size });
    });

    it('covers entire file with no gaps or overlaps', () => {
      const size = 100 * 1024 * 1024; // 100MB
      const chunks = service.calculateChunks(size);

      // Verify first chunk starts at 0
      expect(chunks[0].start).toBe(0);

      // Verify last chunk ends at file size
      expect(chunks[chunks.length - 1].end).toBe(size);

      // Verify no gaps between chunks
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].start).toBe(chunks[i - 1].end);
      }
    });
  });

  describe('transcribe', () => {
    it('throws error when service is disabled', async () => {
      const service = new TranscriptionService('');
      const buffer = Buffer.from('fake audio data');

      await expect(
        service.transcribe(buffer, 'test.mp3')
      ).rejects.toThrow('TranscriptionService is not enabled');
    });

    it('delegates per-chunk single-shot calls to the STTProviderRouter when present', async () => {
      const router = fakeRouter({
        text: 'hello world',
        segments: [{ start: 0, end: 1.2, text: 'hello world' }],
        durationSec: 1.2,
        language: 'en',
      });
      const service = new TranscriptionService('', router);
      const buffer = Buffer.from('fake audio data');

      const result = await service.transcribe(buffer, 'test.wav', 'audio/wav');

      // Router was called once (single-chunk file under 24 MB).
      expect(router.transcribe).toHaveBeenCalledTimes(1);
      expect(router.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'test.wav', audio: expect.any(Uint8Array) }),
      );

      // Result reflects the router's output via the chunking/merge pipeline.
      expect(result.fullText).toBe('hello world');
      expect(result.language).toBe('en');
      expect(result.segments).toHaveLength(1);
      expect(result.wordCount).toBe(2);
    });
  });
});
