import type { WebSocket } from 'ws';

// ── Protocol Messages (Agent → Hub) ──────────────────────────────

export interface AuthMessage {
  type: 'auth';
  token: string;
}

export interface RegisterMessage {
  type: 'register';
  repos: string[];
  capabilities: string[];
}

export interface PingMessage {
  type: 'ping';
}

export interface JobAckMessage {
  type: 'job_ack';
  jobId: string;
}

export interface JobProgressMessage {
  type: 'job_progress';
  jobId: string;
  message: string;
  percent: number;
  logs?: string[];
}

export interface JobResultMessage {
  type: 'job_result';
  jobId: string;
  status: 'done' | 'failed';
  data: Record<string, unknown>;
}

export type AgentToHubMessage =
  | AuthMessage
  | RegisterMessage
  | PingMessage
  | JobAckMessage
  | JobProgressMessage
  | JobResultMessage;

// ── Protocol Messages (Hub → Agent) ──────────────────────────────

export interface AuthOkMessage {
  type: 'auth_ok';
  agentId: string;
  tenantId: string;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  message: string;
}

export interface RegisteredMessage {
  type: 'registered';
  repos: number;
}

export interface PongMessage {
  type: 'pong';
}

export interface JobMessage {
  type: 'job';
  jobId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface JobCompleteMessage {
  type: 'job_complete';
  jobId: string;
}

export interface JobResumeMessage {
  type: 'job_resume';
  jobId: string;
  payload: Record<string, unknown>;
}

export interface ServerShutdownMessage {
  type: 'server_shutdown';
  reconnectAfter: number;
}

export type HubToAgentMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | RegisteredMessage
  | PongMessage
  | JobMessage
  | JobCompleteMessage
  | JobResumeMessage
  | ServerShutdownMessage;

// ── Internal Types ───────────────────────────────────────────────

export interface AgentConnection {
  agentId: string;
  tenantId: string;
  ws: WebSocket;
  repos: string[];
  capabilities: string[];
  activeJobs: Set<string>;
  maxActiveJobs: number;
  connectedAt: Date;
  lastPingAt: Date;
  authenticated: boolean;
}

export type AgentJobStatus = 'pending' | 'dispatched' | 'in_progress' | 'done' | 'failed';

export interface AgentJobData {
  id?: string;
  tenantId: string;
  action: string;
  targetRepo: string;
  payload: Record<string, unknown>;
}

export interface AgentStatusInfo {
  agentId: string;
  repos: string[];
  capabilities: string[];
  activeJobs: number;
  maxActiveJobs: number;
  connectedAt: Date;
  lastPingAt: Date;
}

// ── Constants ────────────────────────────────────────────────────

export const AUTH_DEADLINE_MS = 10_000;
export const HEARTBEAT_TIMEOUT_MS = 90_000;
export const JOB_ACK_TIMEOUT_MS = 5 * 60_000;
export const STALE_JOB_TIMEOUT_MS = 60 * 60_000;
export const JOB_EXPIRY_MS = 24 * 60 * 60_000;
export const MAX_AGENTS_PER_TENANT = 20;
export const MAX_AGENTS_TOTAL = 500;
export const DEFAULT_MAX_ACTIVE_JOBS = 3;
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
export const CLEANUP_INTERVAL_MS = 5 * 60_000;
