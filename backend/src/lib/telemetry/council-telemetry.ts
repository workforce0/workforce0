/**
 * Council session telemetry — emits one structured log per Council
 * session at completion. Plan 3 will scrape these via Prometheus.
 *
 * @module lib/telemetry/council-telemetry
 */

import { createChildLogger } from '../logger.js';

const logger = createChildLogger({ service: 'CouncilTelemetry' });

export type CouncilExitReason =
  | 'threshold'    // reviewer confidence ≥ threshold; consensus reached
  | 'max_rounds'   // hit iteration cap without consensus
  | 'first_pass'   // critique disabled or no reviewer engaged
  | 'rejected'     // reviewer voted reject
  | 'error';       // exception during session

export interface CouncilSessionEvent {
  agentType: string;
  rounds: number;
  exitReason: CouncilExitReason;
  totalLatencyMs: number;
  totalCostUsd: number;
  primaryProvider: string;
  primaryModelId: string;
  reviewerCount: number;
}

export function emitCouncilSessionComplete(event: CouncilSessionEvent): void {
  logger.info(event, 'council.session_complete');
}
