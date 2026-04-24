import { describe, it, expect } from 'vitest';
import { TranscriptionService } from '../transcription.service.js';

describe('TranscriptionService', () => {
  describe('isEnabled', () => {
    it('returns false when no API key is provided', () => {
      const service = new TranscriptionService('');
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when API key is provided', () => {
      const service = new TranscriptionService('sk-test-key-123');
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
  });
});
