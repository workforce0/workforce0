// In development, use empty string so requests go to same origin (Next.js proxy).
// The next.config.ts rewrites proxy /api/* to the backend at localhost:3000.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: Record<string, unknown>;
  message?: string;
}

interface AgentToken {
  id: string;
  name: string;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface AgentStatusInfo {
  agentId: string;
  repos: string[];
  capabilities: string[];
  activeJobs: number;
  maxActiveJobs: number;
  connectedAt: string;
  lastPingAt: string;
}

interface AgentJob {
  id: string;
  action: string;
  status: string;
  targetRepo: string;
  result: any;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("wf0_token");
  }

  /** P1: Current project scope — list endpoints filter by this. */
  private getProjectId(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("wf0_project_id");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Send Authorization header as fallback (httpOnly cookie is primary)
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // P1: attach the active project scope so list endpoints filter down.
    const projectId = this.getProjectId();
    if (projectId) {
      headers["X-Project-Id"] = projectId;
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: "include", // Send httpOnly cookies automatically
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(
        "Unable to reach the server. Please check your connection.",
        "NETWORK_ERROR",
        0
      );
    }

    let json: Record<string, unknown>;
    try {
      json = await res.json();
    } catch {
      throw new ApiError(
        `Server returned an unexpected response (${res.status})`,
        "PARSE_ERROR",
        res.status
      );
    }

    if (!res.ok) {
      // Auto-redirect to login on 401 (session expired / invalid token)
      if (res.status === 401 && typeof window !== "undefined") {
        localStorage.removeItem("wf0_token");
        localStorage.removeItem("wf0_user");
        window.location.href = "/login";
      }
      throw new ApiError(
        (json.error as Record<string, string>)?.message || json.message as string || "Request failed",
        (json.error as Record<string, string>)?.code || "UNKNOWN",
        res.status
      );
    }

    return json as unknown as ApiResponse<T>;
  }

  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("PUT", path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("PATCH", path, body);
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", path);
  }

  // Auth
  async login(email: string, password: string) {
    return this.post<{
      token: string;
      user: { email: string; name: string; organizationName: string; tenantId: string };
    }>("/api/auth/login", { email, password });
  }

  async signup(data: { email: string; password: string; name: string; organizationName: string }) {
    return this.post<{
      token: string;
      user: { email: string; name: string; organizationName: string; tenantId: string };
    }>("/api/auth/signup", data);
  }

  async forgotPassword(email: string) {
    return this.post<{ message: string }>("/api/auth/forgot-password", { email });
  }

  async resetPassword(token: string, password: string) {
    return this.post<{ message: string }>("/api/auth/reset-password", { token, password });
  }

  // SSO
  async ssoAuthorize(redirectUri: string, options?: { organization?: string; domainHint?: string; loginHint?: string }) {
    return this.post<{ authUrl: string }>("/api/auth/sso/authorize", { redirectUri, ...options });
  }

  async ssoCallback(code: string) {
    return this.post<{
      token: string;
      user: { email: string; name: string; organizationName: string; tenantId: string };
    }>("/api/auth/sso/callback", { code });
  }

  async getMe() {
    return this.get<{
      email: string;
      name: string;
      organizationName: string;
      tenantId: string;
      integrations: Record<string, unknown>;
    }>("/api/auth/me");
  }

  // Dashboard
  async getDashboardStats() {
    return this.get<{
      overview: {
        meetings: { total: number; completed: number; active: number };
        prds: { total: number; approved: number; pending: number };
        tasks: { total: number; active: number; pendingClarifications: number };
        tickets: { total: number };
      };
      recent: {
        meetings: Array<{ id: string; title: string; status: string; startTime: string; createdAt: string }>;
        prds: Array<{ id: string; title: string; status: string; confidence: number; createdAt: string }>;
      };
    }>("/api/dashboard/stats");
  }

  async getDashboardROI() {
    return this.get<{
      hoursSavedThisWeek: number;
      meetingsThisWeek: number;
      prdsThisWeek: number;
      approvalRate: number;
      weekOverWeekChange: number;
    }>("/api/dashboard/roi");
  }

  async getUsage() {
    return this.get<{
      tier: string;
      meetings: { used: number; limit: number };
      prds: { used: number; limit: number };
      trialDaysLeft: number | null;
      trialExpired: boolean;
    }>("/api/dashboard/usage");
  }

  // Meetings
  async getMeetings(params?: { status?: string; limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return this.get<Array<{
      id: string; title: string; status: string; meetingUrl: string;
      startTime: string; endTime?: string; participants: unknown[]; createdAt: string;
    }>>(`/api/meetings${qs ? `?${qs}` : ""}`);
  }

  async getMeeting(id: string) {
    return this.get<{
      id: string; title: string; status: string; meetingUrl: string;
      startTime: string; endTime?: string; participants: unknown[];
      transcript?: { id: string; fullText: string; segments: unknown[]; duration: number; wordCount: number };
    }>(`/api/meetings/${id}`);
  }

  async getTranscript(meetingId: string) {
    return this.get<{
      id: string; fullText: string; segments: Array<{ speaker: string; text: string; startTime: number; endTime: number }>;
      duration: number; wordCount: number;
    }>(`/api/meetings/${meetingId}/transcript`);
  }

  async scheduleMeeting(meetingUrl: string, title?: string) {
    return this.post<{ meetingId: string; botId: string; status: string }>("/api/meetings", { meetingUrl, title });
  }

  // PRDs
  async getPrds(params?: { status?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return this.get<Array<{
      id: string; title: string; summary: string; status: string; confidence: number;
      requirements: unknown[]; createdAt: string; meetingId: string;
      googleDocUrl?: string;
    }>>(`/api/agents/prds${qs ? `?${qs}` : ""}`);
  }

  async getPrd(id: string) {
    return this.get<{
      id: string; title: string; summary: string; status: string; confidence: number;
      objectives: string[]; requirements: Array<{
        id: string; title: string; description: string; priority: string; type: string; acceptanceCriteria: string[];
      }>;
      acceptanceCriteria: string[]; outOfScope: string[]; assumptions: string[]; risks: Array<{
        description: string; impact: string; mitigation?: string;
      }>;
      timeline?: string; googleDocUrl?: string; tickets: Array<{
        id: string; externalKey?: string; summary: string; priority: string; status: string;
      }>;
      createdAt: string; updatedAt: string;
    }>(`/api/agents/prds/${id}`);
  }

  async getPrdCouncil(id: string) {
    return this.get<{
      taskId: string;
      confidence: number;
      councilDecision: string | null;
      iterations: number;
      council: {
        votes: Array<{ model: string; vote: string; confidence: number; reasoning?: string; concerns?: string[] }>;
        critique: { assessment: string; confidence: number; issues: number; strengths: string[]; missingRisks: string[] } | null;
        consensusReached: boolean;
        outstandingIssues: string[];
        clarificationQuestions: string[];
        estimatedCost: { gemini: number; openai: number; total: number } | null;
        timing: { primaryGeneration: number; critique: number; consensus: number; revision: number; total: number } | null;
      } | null;
      completedAt: string | null;
      startedAt: string;
    }>(`/api/agents/prds/${id}/council`);
  }

  async approvePrd(id: string) {
    return this.post(`/api/agents/prds/${id}/approve`);
  }

  async rejectPrd(id: string, reason?: string) {
    return this.post(`/api/agents/prds/${id}/reject`, { reason });
  }

  async createTickets(prdId: string, projectKey: string, epicKey?: string) {
    return this.post<{ created: unknown[]; failed: unknown[] }>(`/api/agents/prds/${prdId}/tickets`, { projectKey, epicKey });
  }

  async downloadPrd(prdId: string, prdTitle: string) {
    const token = this.getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}/api/agents/prds/${prdId}/download`, {
      headers,
      credentials: "include",
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PRD - ${prdTitle}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Agents
  async generateBrief(meetingId: string) {
    return this.post<{ taskId: string; status: string }>("/api/agents/ba/process", { meetingId });
  }

  // Tasks
  async getTasks(params?: { status?: string; agentType?: string }) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.agentType) query.set("agentType", params.agentType);
    const qs = query.toString();
    return this.get<Array<{
      id: string; agentType: string; status: string; confidence: number;
      createdAt: string; completedAt?: string;
    }>>(`/api/agents/tasks${qs ? `?${qs}` : ""}`);
  }

  // Agent roles (M1)
  async getAgentRoles() {
    return this.get<Array<{
      id: string;
      tenantId: string | null;
      slug: string;
      displayName: string;
      description: string;
      category: string;
      systemPromptTemplate: string | null;
      allowedTools: string[];
      monthlyBudgetTokens: number | null;
      defaultConcurrency: number;
      parentRoleSlug: string | null;
      isBuiltin: boolean;
      isActive: boolean;
      isOverride: boolean;
    }>>("/api/agent-roles");
  }

  async patchAgentRole(slug: string, body: {
    displayName?: string;
    description?: string;
    systemPromptTemplate?: string | null;
    allowedTools?: string[];
    monthlyBudgetTokens?: number | null;
    defaultConcurrency?: number;
    parentRoleSlug?: string | null;
    isActive?: boolean;
  }) {
    return this.patch<any>(`/api/agent-roles/${slug}`, body);
  }

  async deleteAgentRoleOverride(slug: string) {
    return this.delete<{ success: boolean }>(`/api/agent-roles/${slug}`);
  }

  // Goals (M2)
  async getGoals(params?: { status?: string }) {
    const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
    return this.get<Array<{
      id: string;
      title: string;
      description: string;
      outcome: string;
      parentGoalId: string | null;
      status: string;
      targetDate: string | null;
      createdAt: string;
      updatedAt: string;
    }>>(`/api/goals${qs}`);
  }

  async createGoal(input: {
    title: string;
    description?: string;
    outcome?: string;
    parentGoalId?: string | null;
    targetDate?: string | null;
  }) {
    return this.post<any>("/api/goals", input);
  }

  async updateGoal(id: string, body: {
    title?: string;
    description?: string;
    outcome?: string;
    parentGoalId?: string | null;
    status?: "active" | "achieved" | "abandoned";
    targetDate?: string | null;
  }) {
    return this.patch<any>(`/api/goals/${id}`, body);
  }

  // Settings
  async getSettings() {
    return this.get<{
      account: { name: string; email: string; organizationName: string };
      integrations: {
        jiraBaseUrl: string; jiraEmail: string; jiraApiToken: string; jiraConnected: boolean;
        gchatWebhookUrl: string; gchatConnected: boolean;
        googleServiceAccountKey: string; googleDriveFolderId: string; googleDocsConnected: boolean;
      };
      notifications: {
        notifyOnMeetingEnd: boolean; notifyOnPrdGenerated: boolean;
        notifyOnApprovalNeeded: boolean; notifyOnTicketsCreated: boolean;
        notifyOnAgentErrors: boolean;
      };
      spending?: {
        currentSpend: number; monthlyCap: number | null;
        percentUsed: number; remaining: number | null;
      };
    }>("/api/settings");
  }

  async updateIntegrations(data: Record<string, string>) {
    return this.put("/api/settings/integrations", data);
  }

  async updateNotifications(data: Record<string, boolean>) {
    return this.put("/api/settings/notifications", data);
  }

  async updateAccount(data: { name?: string; organizationName?: string }) {
    return this.put("/api/settings/account", data);
  }

  async testIntegration(integration: string) {
    return this.post<{ connected: boolean; message: string }>("/api/settings/integrations/test", { integration });
  }

  async updateSpendingCap(monthlyCap: number | null) {
    return this.put<{ currentSpend: number; monthlyCap: number | null; percentUsed: number; remaining: number | null }>("/api/settings/spending", { monthlyCap });
  }

  // In-app Notifications (clarifications, approvals, etc.)
  async getNotifications(status: 'pending' | 'read' | 'all' = 'pending', limit = 20) {
    return this.get<Array<{
      id: string; tenantId: string; channel: string; type: string;
      title: string; message: string; metadata: Record<string, unknown> | null;
      status: string; createdAt: string;
    }>>(`/api/notifications?status=${status}&limit=${limit}`);
  }

  async dismissNotification(id: string) {
    return this.patch(`/api/notifications/${id}`, { status: 'read' });
  }

  // Activity
  async getActivity(limit?: number) {
    return this.get<Array<{
      type: string; id: string; title: string; status: string; timestamp: string; confidence?: number;
    }>>(`/api/dashboard/activity${limit ? `?limit=${limit}` : ""}`);
  }

  // Engagements
  async getEngagements(status?: string) {
    const params = status ? `?status=${status}` : '';
    return this.get<Array<{
      id: string; tenantId: string; title: string; status: string; phase: string;
      confidence: number; agentType?: string; createdAt: string; updatedAt: string;
      metadata?: Record<string, unknown>;
    }>>(`/api/engagements${params}`);
  }

  async getEngagement(id: string) {
    return this.get<{
      id: string; tenantId: string; title: string; status: string; phase: string;
      confidence: number; agentType?: string; input?: unknown; output?: unknown;
      createdAt: string; updatedAt: string;
      metadata?: Record<string, unknown>;
    }>(`/api/engagements/${id}`);
  }

  async advanceEngagement(id: string, data: { confidence?: number; output?: unknown }) {
    return this.post(`/api/engagements/${id}/advance`, data);
  }

  async pauseEngagement(id: string, reason?: string) {
    return this.post(`/api/engagements/${id}/pause`, { reason });
  }

  async resumeEngagement(id: string) {
    return this.post(`/api/engagements/${id}/resume`);
  }

  // Models
  async getModelConfig() {
    return this.get<{
      agents: Array<{
        id: string; tenantId: string; agentType: string; preset: string;
        primaryModelId: string; reviewerModelIds: string;
        maxSteps: number; confidenceThreshold: number; isActive: boolean;
        createdAt: string; updatedAt: string;
      }>;
      providers: Array<{
        id: string; name: string; isActive: boolean;
        models: Array<{ id: string; modelId: string; displayName: string }>;
      }>;
    }>(`/api/models/config`);
  }

  async updateModelConfig(data: {
    agentType: string;
    primaryModelId: string;
    reviewerModelIds?: string[];
    confidenceThreshold?: number;
    maxSteps?: number;
    preset?: string;
  }) {
    return this.put(`/api/models/config`, data);
  }

  async getAvailableModels() {
    return this.get<{
      providers: Array<{ id: string; name: string; isActive: boolean }>;
      models: Array<{
        id: string; modelId: string; displayName: string;
        costInput: number; costOutput: number;
        provider: { id: string; name: string };
      }>;
    }>(`/api/models/available`);
  }

  // Team
  async getTeam() {
    return this.get<Array<{
      id: string; name: string; email: string; role: string;
      preferredChannel: string;
      channelIds?: Record<string, string>;
      createdAt: string;
    }>>(`/api/team`);
  }

  async addTeamMember(data: {
    name: string;
    email: string;
    role: string;
    preferredChannel?: string;
    channelIds?: Record<string, string>;
  }) {
    return this.post<{
      id: string; name: string; email: string; role: string;
      preferredChannel: string;
      channelIds?: Record<string, string>;
      createdAt: string;
    }>(`/api/team`, data);
  }

  async updateTeamMember(
    id: string,
    data: {
      name?: string;
      role?: string;
      preferredChannel?: string;
      channelIds?: Record<string, string>;
    },
  ) {
    return this.put(`/api/team/${id}`, data);
  }

  async removeTeamMember(id: string) {
    return this.delete(`/api/team/${id}`);
  }

  async testMemberChannel(id: string) {
    return this.post<{ channel: string; messageLogId?: string }>(
      `/api/team/${id}/test-channel`,
    );
  }

  // Analytics
  async getAnalytics() {
    return this.get<{
      costByAgent: Array<{ agentType: string; totalCost: number; inputTokens: number; outputTokens: number; jobCount: number }>;
      totals: { costUSD: number; inputTokens: number; outputTokens: number };
      engagementsByPhase: Array<{ phase: string; count: number }>;
      meetingsByStatus: Array<{ status: string; count: number }>;
      dailyCosts: Array<{ date: string; cost: number }>;
    }>("/api/dashboard/analytics");
  }

  // Meeting Analytics
  async getMeetingAnalytics() {
    return this.get<{
      summary: {
        totalMeetings: number;
        completedMeetings: number;
        failedMeetings: number;
        completionRate: number;
        avgDurationSeconds: number;
        totalWords: number;
        totalActionItems: number;
        totalDecisions: number;
      };
      sentimentDistribution: Record<string, number>;
      meetingsByDayOfWeek: Array<{ day: string; count: number }>;
      topTopics: Array<{ topic: string; count: number }>;
      recentMeetings: Array<{
        id: string;
        title: string;
        status: string;
        startTime: string;
        durationSeconds: number | null;
        wordCount: number | null;
        speakerCount: number;
        participantCount: number;
      }>;
    }>("/api/dashboard/meeting-analytics");
  }

  // Audit Log
  async getAuditLog(params?: { action?: string; resource?: string; from?: string; to?: string; limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (params?.action) query.set("action", params.action);
    if (params?.resource) query.set("resource", params.resource);
    if (params?.from) query.set("from", params.from);
    if (params?.to) query.set("to", params.to);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return this.get<Array<{
      id: string; action: string; resource: string; resourceId?: string;
      userId?: string; before?: unknown; after?: unknown;
      ipAddress?: string; createdAt: string;
    }>>(`/api/audit-log${qs ? `?${qs}` : ""}`);
  }

  // ─── Outgoing Webhooks ─────────────────────────────────────────────────────

  async getWebhooks() {
    return this.get<Array<{
      id: string; url: string; events: string[]; active: boolean;
      description?: string; createdAt: string; updatedAt: string;
    }>>("/api/webhooks");
  }

  async createWebhook(data: { url: string; events: string[]; description?: string }) {
    return this.post<{
      id: string; url: string; events: string[]; active: boolean;
      description?: string; secret: string; createdAt: string;
    }>("/api/webhooks", data);
  }

  async updateWebhook(id: string, data: { url?: string; events?: string[]; active?: boolean; description?: string }) {
    return this.put<{
      id: string; url: string; events: string[]; active: boolean; updatedAt: string;
    }>(`/api/webhooks/${id}`, data);
  }

  async deleteWebhook(id: string) {
    return this.delete(`/api/webhooks/${id}`);
  }

  async testWebhook(id: string) {
    return this.post(`/api/webhooks/${id}/test`);
  }

  async getWebhookEvents() {
    return this.get<string[]>("/api/webhooks/events");
  }

  // ─── Meeting Upload ──────────────────────────────────────────────────────

  async getUploadPresignUrl(data: {
    fileName: string;
    fileSize: number;
    contentType: string;
    title?: string;
    meetingDate?: string;
  }) {
    return this.post<{
      meetingId: string;
      uploadUrl: string;
      s3Key: string;
      expiresIn: number;
    }>("/api/meetings/upload/presign", data);
  }

  async confirmUploadComplete(meetingId: string, data?: {
    title?: string;
    participants?: string[];
  }) {
    return this.post<{ meetingId: string; status: string }>(
      `/api/meetings/${meetingId}/upload/complete`,
      data || {}
    );
  }

  async uploadTranscript(data: { title: string; transcript: string; participants?: string[]; meetingDate?: string }) {
    return this.post<{ meetingId: string; status: string; wordCount: number }>("/api/meetings/upload/transcript", data);
  }

  // ─── Google Meet Integration ─────────────────────────────────────────────

  async getGoogleAuthUrl() {
    return this.get<{ authUrl: string }>("/api/integrations/google/authorize");
  }

  async disconnectGoogle() {
    return this.delete("/api/integrations/google");
  }

  async getGoogleStatus() {
    return this.get<{
      available: boolean;
      connected: boolean;
      email?: string;
    }>("/api/integrations/google/status");
  }

  // ─── Voice Dial-In ───────────────────────────────────────────────────────

  async voiceJoinMeeting(meetingId: string, data: {
    dialInNumber: string;
    accessCode?: string;
    mode: "silent" | "active";
  }) {
    return this.post<{
      meetingId: string;
      callSid: string;
      status: string;
      mode: string;
    }>(`/api/meetings/${meetingId}/voice-join`, data);
  }

  async voiceLeaveMeeting(meetingId: string) {
    return this.post<{
      meetingId: string;
      status: string;
    }>(`/api/meetings/${meetingId}/voice-leave`, {});
  }

  async initiateVoiceDialIn(meetingId: string, phoneNumber?: string) {
    return this.post<{ callSid: string; status: string }>("/api/voice/dial-in", { meetingId, phoneNumber });
  }

  async endVoiceCall(callSid: string) {
    return this.post<{ status: string }>("/api/voice/hangup", { callSid });
  }

  // ─── Meeting Insights ────────────────────────────────────────────────────

  async getMeetingInsights(meetingId: string) {
    return this.get<{
      id: string;
      summary: string;
      actionItems: Array<{ description: string; assignee?: string; deadline?: string; priority?: string }>;
      decisions: Array<{ description: string; madeBy?: string; context?: string }>;
      sentiment: string;
      topics: string[];
    }>(`/api/meetings/${meetingId}/insights`);
  }

  // Agent tokens
  async createAgentToken(name: string) {
    return this.post<{ token: string; tokenHint: string; name: string; id: string }>("/api/agents/tokens", { name });
  }

  async listAgentTokens() {
    return this.get<{ tokens: AgentToken[] }>("/api/agents/tokens");
  }

  async revokeAgentToken(id: string) {
    return this.delete<{ message: string }>(`/api/agents/tokens/${id}`);
  }

  // Agent status
  async getAgentStatus() {
    return this.get<{ agents: AgentStatusInfo[]; connected: number }>("/api/agents/status");
  }

  // Agent jobs
  async getAgentJobs(params?: { status?: string; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return this.get<AgentJob[]>(`/api/agents/jobs${qs ? `?${qs}` : ""}`);
  }

  async getAgentJob(id: string) {
    return this.get<AgentJob>(`/api/agents/jobs/${id}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Integration connections (BYOK credential vault — Stitch 05/06 wizards)
  // ──────────────────────────────────────────────────────────────────────

  async listIntegrations() {
    return this.get<IntegrationConnection[]>(`/api/integrations`);
  }

  async getIntegration(name: string) {
    return this.get<IntegrationConnection>(`/api/integrations/${name}`);
  }

  async connectIntegration(
    name: string,
    credentials: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) {
    return this.post<IntegrationConnection>(`/api/integrations/${name}/connect`, {
      credentials,
      metadata,
    });
  }

  async testIntegrationConnection(name: string) {
    return this.post<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }>(
      `/api/integrations/${name}/test`,
    );
  }

  async disconnectIntegration(name: string) {
    return this.delete(`/api/integrations/${name}`);
  }

  // ──────────────────────────────────────────────────────────────────────
  // First-run setup wizard (Stitch 01)
  // ──────────────────────────────────────────────────────────────────────

  async getSetupStatus() {
    return this.get<SetupStatus>(`/api/setup/status`);
  }

  async completeSetup(workspaceName?: string) {
    return this.post(`/api/setup/complete`, workspaceName ? { workspaceName } : {});
  }

  // ==========================================================================
  // Projects (P1 — project-level isolation)
  // ==========================================================================
  async listProjects(params?: { includeArchived?: boolean }) {
    const q = params?.includeArchived ? "?includeArchived=1" : "";
    return this.get<Project[]>(`/api/projects${q}`);
  }

  async createProject(data: { name: string; slug?: string; description?: string; color?: string }) {
    return this.post<Project>(`/api/projects`, data);
  }

  async getProject(id: string) {
    return this.get<Project>(`/api/projects/${id}`);
  }

  async updateProject(id: string, patch: Partial<Pick<Project, "name" | "description" | "color" | "isArchived">>) {
    return this.patch<Project>(`/api/projects/${id}`, patch);
  }

  async deleteProject(id: string) {
    return this.delete<undefined>(`/api/projects/${id}`);
  }

  // ==========================================================================
  // Library (M7 — skills + subagents + execution plans, audit-only)
  // ==========================================================================
  async listSkills() {
    return this.get<SkillPackage[]>(`/api/library/skills`);
  }
  async getSkill(slug: string) {
    return this.get<SkillPackage>(`/api/library/skills/${slug}`);
  }
  async listSubagents() {
    return this.get<SubagentDefinition[]>(`/api/library/subagents`);
  }
  async getSubagent(slug: string) {
    return this.get<SubagentDefinition>(`/api/library/subagents/${slug}`);
  }
  async getExecutionPlans(ticketId: string) {
    return this.get<ExecutionPlan[]>(`/api/library/plans/${ticketId}`);
  }
  async listRecentPlans() {
    return this.get<Array<ExecutionPlan & { parent: { id: string; title: string; status: string } | null }>>(
      `/api/library/plans`,
    );
  }

  // ==========================================================================
  // Project graph (PG — codebase structure + god-nodes + communities)
  // ==========================================================================
  async getProjectGraph(projectId: string) {
    return this.get<ProjectGraphSummary>(`/api/project-graph/${projectId}`);
  }
  async buildProjectGraph(projectId: string, body: { repoPath: string; repoLabel?: string }) {
    return this.post<{ rebuilt: boolean; stats: ProjectGraphStats }>(
      `/api/project-graph/${projectId}/build`,
      body,
    );
  }
  async getProjectGraphGodNodes(projectId: string, limit = 10) {
    return this.get<GraphNode[]>(`/api/project-graph/${projectId}/god-nodes?limit=${limit}`);
  }
  async getProjectGraphCallers(projectId: string, symbol: string) {
    return this.get<GraphNode[]>(`/api/project-graph/${projectId}/callers/${encodeURIComponent(symbol)}`);
  }
  async getProjectGraphPath(projectId: string, from: string, to: string) {
    const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return this.get<string[] | null>(`/api/project-graph/${projectId}/path?${q}`);
  }
  async getProjectGraphCommunity(projectId: string, symbol: string) {
    return this.get<GraphNode[]>(`/api/project-graph/${projectId}/community/${encodeURIComponent(symbol)}`);
  }
}

export interface GraphNode {
  id: string;
  kind: 'file' | 'class' | 'interface' | 'function' | 'method' | 'enum' | 'type';
  name: string;
  file: string;
  line?: number;
  degree?: number;
  community?: number;
}

export interface ProjectGraphStats {
  nodeCount: number;
  edgeCount: number;
  extractedEdges: number;
  inferredEdges: number;
  fileCount: number;
}

export interface ProjectGraphSummary {
  id: string;
  projectId: string;
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  languages: string[];
  repoLabel: string | null;
  updatedAt: string;
}

export interface SkillPackage {
  id: string;
  tenantId: string | null;
  slug: string;
  source: string;
  description: string;
  body: string;
  requiredTools: string[];
  status: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface SubagentDefinition {
  id: string;
  tenantId: string | null;
  slug: string;
  source: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  preferredModel: string | null;
  category: string | null;
  status: string;
  updatedAt: string;
}

export interface ExecutionPlan {
  id: string;
  tenantId: string;
  parentTicketId: string;
  attempt: number;
  model: string | null;
  steps: Array<{
    title: string;
    description: string;
    roleSlug: string;
    subagentSlug?: string;
    skills?: string[];
    dependsOn?: number[];
  }>;
  channelSummary: string;
  status: string;
  replanReason: string | null;
  /** M8.3: decomposition-quality metrics. Null/undefined when no
   *  critic ran (fallback plan, self-consistency off, etc). */
  critiqueScore?: number | null;
  revised?: boolean;
  candidateCount?: number;
  /** PG.13: hash of the ProjectGraph that fed this plan's prompt. Null
   *  when no graph was used. */
  graphContentHash?: string | null;
  /** PG.13: derived at read time — true when the stamped hash no longer
   *  matches the current graph (plan built against an older graph);
   *  false when fresh; null when no comparison is possible. */
  graphStale?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  isArchived: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConnection {
  name: string;
  status: "disconnected" | "connected" | "action_needed" | "error";
  metadata: Record<string, unknown>;
  lastTestedAt: string | null;
  lastError: string | null;
  connectedBy: string | null;
  updatedAt: string | null;
}

export interface SetupStatus {
  completed: boolean;
  nextStep: "workspace_name" | "ai_provider" | "first_integration" | "finish" | null;
  workspaceName: string;
  aiProvidersConfigured: number;
  integrationsConnected: number;
  completedAt: string | null;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const api = new ApiClient(API_BASE);
