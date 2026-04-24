// mvp/src/services/agent-runtime/types.ts

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context: AgentContext) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentContext {
  tenantId: string;
  engagementId: string;
  agentType: string;
  traceId: string;
  memory: Record<string, unknown>;
  /**
   * M7.7: Ticket the agent is currently working on. When set, the
   * consultant's system prompt is enriched with the skill packages
   * listed in `ticket.payload.skills[]` via LibraryService.
   * Optional — legacy call paths that don't go through chief_of_staff
   * decomposition omit it and the prompt is unchanged.
   */
  ticketId?: string;
}

export interface ToolCallResult {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: ToolResult;
}

export interface AgentStep {
  stepNumber: number;
  thought: string;
  /** @deprecated Use toolCalls array instead for parallel tool call support */
  toolName: string | null;
  /** @deprecated Use toolCalls array instead */
  toolInput: Record<string, unknown> | null;
  /** @deprecated Use toolCalls array instead */
  toolResult: ToolResult | null;
  /** All tool calls executed in this step (supports parallel execution) */
  toolCalls: ToolCallResult[];
  timestamp: Date;
  tokenUsage: { input: number; output: number };
}

export interface AgentRunResult {
  success: boolean;
  output: unknown;
  confidence: number;
  steps: AgentStep[];
  totalTokens: { input: number; output: number };
  durationMs: number;
  skillVersions?: Array<{ name: string; version: string; scope: 'foundation' | 'learned' }>;
}

export interface AgentConfig {
  agentType: string;
  systemPrompt: string;
  tools: AgentTool[];
  maxSteps: number;
  confidenceThreshold: number;
  model: {
    provider: string;
    modelId: string;
    apiKey?: string;
    baseUrl?: string;
  };
}

export interface ModelClient {
  chat(params: {
    model: string;
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  }): Promise<{
    content: string;
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
    tokenUsage: { input: number; output: number };
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  }>;
}
