// ============================================================
// Core Types
// ============================================================

export interface Tenant {
  id: string;
  name: string;
  settings: TenantSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  integrations: IntegrationSettings;
  notifications: NotificationSettings;
  approvalThresholds: ApprovalThresholds;
}

export interface IntegrationSettings {
  meetingProvider: 'google_meet' | 'zoom' | 'teams';
  communicationProvider: 'google_chat' | 'slack' | 'teams';
  taskProvider: 'jira' | 'linear' | 'asana';
  jiraProjectKey?: string;
  slackChannel?: string;
  googleChatSpace?: string;
}

export interface NotificationSettings {
  notifyOnMeetingEnd: boolean;
  notifyOnPrdGenerated: boolean;
  notifyOnApprovalNeeded: boolean;
  mentionOnUrgent: boolean;
}

export interface ApprovalThresholds {
  autoApproveAbove: number; // confidence threshold for auto-approval
  requireHumanBelow: number; // confidence threshold requiring human review
}

// ============================================================
// Meeting Types
// ============================================================

export interface Meeting {
  id: string;
  tenantId: string;
  externalId?: string; // External service ID (e.g., Twilio call SID)
  title: string;
  startTime: Date;
  endTime?: Date;
  status: MeetingStatus;
  meetingUrl: string;
  participants: Participant[];
  transcript?: Transcript;
  createdAt: Date;
  updatedAt: Date;
}

export type MeetingStatus =
  | 'scheduled'
  | 'joining'
  | 'in_progress'
  | 'transcribing'
  | 'processing'   // Meeting ended, transcript being processed (can take up to 1 hour)
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface Participant {
  id: string;
  name: string;
  email?: string;
  role: 'host' | 'participant' | 'ai_bot';
  joinedAt?: Date;
  leftAt?: Date;
}

export interface Transcript {
  id: string;
  meetingId: string;
  segments: TranscriptSegment[];
  fullText: string;
  duration: number; // seconds
  wordCount: number;
  createdAt: Date;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number; // seconds
  endTime: number;
  confidence: number;
}

// ============================================================
// Agent Types
// ============================================================

export interface AgentTask {
  id: string;
  tenantId: string;
  agentType: AgentType;
  status: TaskStatus;
  input: TaskInput;
  output?: TaskOutput;
  confidence: number;
  requiresApproval: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  error?: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export type AgentType = 'ba_agent' | 'dev_agent' | 'qa_agent' | 'sales_agent' | 'marketing_agent';

export type TaskStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_clarification'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

export interface TaskInput {
  type: 'meeting_transcript' | 'prd' | 'feature_request' | 'clarification_response';
  meetingId?: string;
  transcript?: string;
  context?: Record<string, unknown>;
}

export interface TaskOutput {
  type: 'prd' | 'tickets' | 'clarification_request' | 'error';
  prd?: PRD;
  tickets?: JiraTicket[];
  clarificationRequest?: ClarificationRequest;
  rawResponse?: string;
}

// ============================================================
// PRD Types
// ============================================================

export interface PRD {
  id: string;
  taskId: string;
  meetingId: string;
  title: string;
  summary: string;
  objectives: string[];
  requirements: Requirement[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  assumptions: string[];
  risks: Risk[];
  timeline?: string;
  confidence: number;
  version: number;
  status: 'draft' | 'review' | 'approved' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'functional' | 'non_functional' | 'technical';
  acceptanceCriteria: string[];
  estimatedEffort?: string;
}

export interface Risk {
  description: string;
  impact: 'high' | 'medium' | 'low';
  mitigation?: string;
}

// ============================================================
// Jira Types
// ============================================================

export interface JiraTicket {
  id?: string;
  key?: string;
  projectKey: string;
  issueType: 'Story' | 'Task' | 'Bug' | 'Epic';
  summary: string;
  description: string;
  priority: 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';
  labels: string[];
  acceptanceCriteria?: string;
  storyPoints?: number;
  status?: string;
  assignee?: string;
  createdAt?: Date;
}

// ============================================================
// Communication Types
// ============================================================

export interface ClarificationRequest {
  id: string;
  taskId: string;
  question: string;
  context: string;
  options?: ClarificationOption[];
  routeTo: 'technical_lead' | 'product_lead' | 'ceo' | 'cto';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'answered' | 'timeout';
  response?: string;
  respondedBy?: string;
  respondedAt?: Date;
  createdAt: Date;
  expiresAt: Date;
}

export interface ClarificationOption {
  label: string;
  value: string;
  description?: string;
}

export interface Notification {
  id: string;
  tenantId: string;
  channel: 'google_chat' | 'slack' | 'email';
  type: 'info' | 'success' | 'warning' | 'error' | 'approval_request';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  sentAt?: Date;
  status: 'pending' | 'sent' | 'failed';
}

// ============================================================
// API Types
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================
// Event Types (for BullMQ)
// ============================================================

export type JobType =
  | 'process_meeting'
  | 'generate_prd'
  | 'create_tickets'
  | 'send_notification'
  | 'handle_clarification';

export interface JobData {
  type: JobType;
  tenantId: string;
  payload: Record<string, unknown>;
}
