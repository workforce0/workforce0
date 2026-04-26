/**
 * CallContextStore — short-lived in-memory map from Twilio CallSid to caller
 * metadata captured at webhook time so the media-stream WS handler can
 * recover it when Twilio later opens the WS (the WS upgrade carries no body).
 *
 * Why in-memory: the inbound webhook and the media-stream WS land on the same
 * backend instance for the lifetime of a single call (Twilio honours the
 * `<Connect><Stream url=...>` host returned by the inbound webhook, and that
 * URL is built from this same instance's WEBHOOK_BASE_HOST). The window
 * between the webhook returning TwiML and the WS opening is sub-second.
 *
 * If the deployment ever scales past a single instance OR cold-starts a new
 * pod between the webhook and the WS, swap the implementation for a Redis
 * SETEX with the same key shape (`voice:call-context:<callSid>`) and a 60s
 * TTL. The `set`/`get`/`delete` surface is identical so callers don't change.
 *
 * @module services/voice-provider/call-context.store
 */

export interface CallContext {
  /** Twilio E.164 caller number (the `From` field on the inbound webhook). */
  fromNumber: string;
  /** Twilio dialed-in number (`To`). Useful for multi-DID deployments. */
  toNumber: string;
  /** Wall-clock when the inbound webhook accepted the call. */
  acceptedAt: number;
}

/** Default TTL: 5 minutes. Twilio opens the WS in <1s in practice; the cap
 * exists to bound memory if a webhook fires but Twilio never connects. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class CallContextStore {
  private readonly map = new Map<string, { ctx: CallContext; expiresAt: number }>();
  // Sweep interval: the store is small (one entry per active call), so a
  // simple lazy + periodic sweep is fine.
  private readonly sweepIntervalMs = 60_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  /** Store the caller metadata keyed by CallSid. */
  set(callSid: string, ctx: CallContext): void {
    this.map.set(callSid, { ctx, expiresAt: Date.now() + this.ttlMs });
    if (this.sweepTimer === null) this.startSweep();
  }

  /**
   * Look up caller metadata for a CallSid. Returns `null` if the entry has
   * expired or was never written. Lazy-evicts expired entries on access.
   */
  get(callSid: string): CallContext | null {
    const entry = this.map.get(callSid);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(callSid);
      return null;
    }
    return entry.ctx;
  }

  /** Drop the entry — call after the WS handler has consumed it. */
  delete(callSid: string): void {
    this.map.delete(callSid);
  }

  /** Stop the sweep interval (for tests + graceful shutdown). */
  shutdown(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.map.clear();
  }

  private startSweep(): void {
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.map.entries()) {
        if (v.expiresAt < now) this.map.delete(k);
      }
      // If empty, stop the timer to free the event loop reference.
      if (this.map.size === 0 && this.sweepTimer) {
        clearInterval(this.sweepTimer);
        this.sweepTimer = null;
      }
    }, this.sweepIntervalMs);
    // Don't keep the process alive solely for this sweep timer.
    this.sweepTimer.unref?.();
  }
}
