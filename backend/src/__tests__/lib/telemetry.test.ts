/**
 * =============================================================================
 * OpenTelemetry Telemetry Module — Tests
 * =============================================================================
 *
 * Tests:
 *   - initTelemetry no-ops when OTEL_EXPORTER_OTLP_ENDPOINT is not set
 *   - initTelemetry no-ops when OTEL_ENABLED is "false"
 *   - getTracer returns a no-op tracer when OTel is not initialized
 *   - No-op tracer's startActiveSpan executes the callback
 *   - shutdownTelemetry resolves cleanly when not initialized
 *   - resetTelemetry clears module state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTelemetry, getTracer, shutdownTelemetry, resetTelemetry } from '../../lib/telemetry.js';

// We test the no-op / disabled paths since OTel packages aren't installed
describe('Telemetry Module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean OTel-related env vars
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_ENABLED;
    // Reset module state between tests for isolation
    resetTelemetry();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('initTelemetry resolves without error when endpoint is not set', async () => {
    await expect(initTelemetry()).resolves.toBeUndefined();
  });

  it('initTelemetry resolves without error when OTEL_ENABLED=false', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    process.env.OTEL_ENABLED = 'false';

    await expect(initTelemetry()).resolves.toBeUndefined();
  });

  it('getTracer returns a no-op tracer when not initialized', () => {
    const tracer = getTracer('test-module');

    expect(tracer).toBeDefined();
    expect(typeof tracer.startActiveSpan).toBe('function');
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('no-op tracer startActiveSpan executes the callback and returns its result', () => {
    const tracer = getTracer('test-module');

    const result = tracer.startActiveSpan('test-span', (span: any) => {
      expect(span.isRecording()).toBe(false);
      span.setAttribute('key', 'value');
      span.end();
      return 42;
    });

    expect(result).toBe(42);
  });

  it('no-op tracer startSpan returns a span with all methods', () => {
    const tracer = getTracer('test-module');

    const span = tracer.startSpan('test-span');
    expect(span.isRecording()).toBe(false);
    // These should not throw
    span.setAttribute('key', 'value');
    span.setStatus({ code: 1 });
    span.recordException(new Error('test'));
    span.end();
  });

  it('shutdownTelemetry resolves cleanly when not initialized', async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  it('resetTelemetry clears state so getTracer returns no-op', () => {
    // Even if somehow initialized, reset should force no-op
    resetTelemetry();
    const tracer = getTracer('after-reset');
    expect(typeof tracer.startActiveSpan).toBe('function');
    expect(tracer.startSpan('x').isRecording()).toBe(false);
  });
});
