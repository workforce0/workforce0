/**
 * =============================================================================
 * OpenTelemetry Tracing — Conditional Initialization
 * =============================================================================
 *
 * Provides distributed tracing via OpenTelemetry when configured.
 * Gracefully no-ops when OTEL_EXPORTER_OTLP_ENDPOINT is not set or
 * when @opentelemetry packages are not installed.
 *
 * Env vars (standard OTel):
 *   OTEL_EXPORTER_OTLP_ENDPOINT — e.g. http://localhost:4318
 *   OTEL_SERVICE_NAME           — defaults to "workforce0-api"
 *   OTEL_ENABLED                — set to "false" to disable even if endpoint is set
 *
 * Usage:
 *   // At app startup (before importing routes):
 *   import { initTelemetry, shutdownTelemetry } from './lib/telemetry.js';
 *   await initTelemetry();
 *
 *   // For manual spans:
 *   import { getTracer } from './lib/telemetry.js';
 *   const tracer = getTracer('my-module');
 *   tracer.startActiveSpan('operation', async (span) => { ... span.end(); });
 *
 *   // At graceful shutdown:
 *   await shutdownTelemetry();
 *
 * Install (when ready):
 *   npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
 *     @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources \
 *     @opentelemetry/semantic-conventions
 */

import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'telemetry' });

let sdk: any = null;
let traceApi: any = null;

/**
 * Initialize OpenTelemetry SDK with auto-instrumentation.
 * No-ops if OTEL_EXPORTER_OTLP_ENDPOINT is not set or packages are missing.
 */
export async function initTelemetry(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const enabled = process.env.OTEL_ENABLED !== 'false';

  if (!endpoint || !enabled) {
    log.info('OpenTelemetry disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set or OTEL_ENABLED=false)');
    return;
  }

  try {
    // Dynamic imports — only loaded when packages are installed
    // @ts-expect-error - optional dependency, loaded dynamically
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    // @ts-expect-error - optional dependency, loaded dynamically
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    // @ts-expect-error - optional dependency, loaded dynamically
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    // @ts-expect-error - optional dependency, loaded dynamically
    const { Resource } = await import('@opentelemetry/resources');
    // @ts-expect-error - optional dependency, loaded dynamically
    const otelApi = await import('@opentelemetry/api');

    const serviceName = process.env.OTEL_SERVICE_NAME || 'workforce0-api';

    const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

    sdk = new NodeSDK({
      resource: new Resource({ 'service.name': serviceName }),
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
        }),
      ],
    });

    sdk.start();
    traceApi = otelApi.trace;

    log.info('OpenTelemetry initialized', { endpoint, serviceName });
  } catch (err) {
    log.warn('OpenTelemetry packages not installed — tracing disabled. Install with: npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources');
  }
}

/**
 * Get a tracer instance for creating manual spans.
 * Returns a no-op tracer if OTel is not initialized.
 */
export function getTracer(name: string): any {
  if (traceApi) {
    return traceApi.getTracer(name);
  }

  // Return a no-op tracer
  return {
    startActiveSpan: (_name: string, fn: (span: any) => any) => {
      const noopSpan = {
        end: () => {},
        setAttribute: () => noopSpan,
        setStatus: () => noopSpan,
        recordException: () => {},
        isRecording: () => false,
      };
      return fn(noopSpan);
    },
    startSpan: () => ({
      end: () => {},
      setAttribute: () => {},
      setStatus: () => {},
      recordException: () => {},
      isRecording: () => false,
    }),
  };
}

/**
 * Gracefully shutdown the OTel SDK (flushes pending spans).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      log.info('OpenTelemetry shutdown complete');
    } catch (err) {
      log.error('OpenTelemetry shutdown error', { error: (err as Error).message });
    }
  }
}

/**
 * Reset module state (for test isolation only).
 */
export function resetTelemetry(): void {
  sdk = null;
  traceApi = null;
}
