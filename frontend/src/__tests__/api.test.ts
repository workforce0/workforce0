import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── localStorage mock ──────────────────────────────────────────────────────
// jsdom in some Node versions has incomplete localStorage; provide a robust mock.
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// ─── fetch mock ─────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Helper to build a mock Response
function mockResponse(
  body: unknown,
  opts: { status?: number; ok?: boolean } = {}
): Response {
  const { status = 200, ok = true } = opts;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? "OK" : "Error",
    type: "basic" as ResponseType,
    url: "",
    clone: () => ({} as Response),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(""),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

// Import after mocks are set up
import { api, ApiError } from "@/lib/api";

describe("ApiClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  // ─── Auth Header ──────────────────────────────────────────────────────────

  describe("authentication header", () => {
    it("sets Authorization header when token exists in localStorage", async () => {
      store["wf0_token"] = "my-jwt-token";
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.get("/api/test");

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers["Authorization"]).toBe("Bearer my-jwt-token");
    });

    it("does not set Authorization header when no token", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.get("/api/test");

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers["Authorization"]).toBeUndefined();
    });

    it("always sets Content-Type to application/json", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.get("/api/test");

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers["Content-Type"]).toBe("application/json");
    });
  });

  // ─── HTTP Methods ─────────────────────────────────────────────────────────

  describe("HTTP methods", () => {
    it("GET sends correct method and no body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: { id: 1 } })
      );

      await api.get("/api/items");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/items");
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
    });

    it("POST sends correct method and JSON body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.post("/api/items", { name: "test" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/items");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ name: "test" });
    });

    it("PUT sends correct method and JSON body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.put("/api/items/1", { name: "updated" });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("PUT");
      expect(JSON.parse(init.body)).toEqual({ name: "updated" });
    });

    it("PATCH sends correct method and JSON body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.patch("/api/items/1", { status: "active" });

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toEqual({ status: "active" });
    });

    it("DELETE sends correct method and no body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.delete("/api/items/1");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/items/1");
      expect(init.method).toBe("DELETE");
      expect(init.body).toBeUndefined();
    });

    it("POST with no body sends undefined body", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, data: {} })
      );

      await api.post("/api/action");

      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws ApiError with NETWORK_ERROR when fetch fails", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      try {
        await api.get("/api/test");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe("NETWORK_ERROR");
        expect((err as ApiError).status).toBe(0);
        expect((err as ApiError).message).toContain("Unable to reach the server");
      }
    });

    it("throws ApiError with PARSE_ERROR when JSON parsing fails", async () => {
      const badResponse = {
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
        headers: new Headers(),
        redirected: false,
        statusText: "OK",
        type: "basic" as ResponseType,
        url: "",
        clone: () => ({} as Response),
        body: null,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        text: () => Promise.resolve(""),
        bytes: () => Promise.resolve(new Uint8Array()),
      } as Response;

      mockFetch.mockResolvedValueOnce(badResponse);

      try {
        await api.get("/api/test");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe("PARSE_ERROR");
        expect((err as ApiError).status).toBe(200);
      }
    });

    it("handles 401 by clearing localStorage and redirecting to /login", async () => {
      store["wf0_token"] = "expired-token";
      store["wf0_user"] = JSON.stringify({ name: "Test" });

      mockFetch.mockResolvedValueOnce(
        mockResponse(
          { error: { code: "UNAUTHORIZED", message: "Token expired" } },
          { status: 401, ok: false }
        )
      );

      try {
        await api.get("/api/protected");
      } catch {
        // expected
      }

      expect(localStorageMock.removeItem).toHaveBeenCalledWith("wf0_token");
      expect(localStorageMock.removeItem).toHaveBeenCalledWith("wf0_user");
      expect(window.location.href).toBe("/login");
    });

    it("throws ApiError with server error message on non-OK response", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          { error: { code: "NOT_FOUND", message: "Resource not found" } },
          { status: 404, ok: false }
        )
      );

      try {
        await api.get("/api/missing");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe("NOT_FOUND");
        expect((err as ApiError).status).toBe(404);
        expect((err as ApiError).message).toBe("Resource not found");
      }
    });

    it("falls back to 'Request failed' when no error message in response", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({}, { status: 500, ok: false })
      );

      try {
        await api.get("/api/server-error");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toBe("Request failed");
      }
    });

    it("uses top-level message field when error object is absent", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          { message: "Something went wrong" },
          { status: 400, ok: false }
        )
      );

      try {
        await api.get("/api/bad-request");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toBe("Something went wrong");
      }
    });
  });

  // ─── Endpoint Methods ─────────────────────────────────────────────────────

  describe("endpoint methods", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue(
        mockResponse({ success: true, data: {} })
      );
    });

    it("login posts to /api/auth/login with email and password", async () => {
      await api.login("user@test.com", "pass123");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/auth/login");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        email: "user@test.com",
        password: "pass123",
      });
    });

    it("signup posts to /api/auth/signup with full data", async () => {
      const signupData = {
        email: "new@test.com",
        password: "secret",
        name: "New User",
        organizationName: "Acme",
      };
      await api.signup(signupData);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/auth/signup");
      expect(JSON.parse(init.body)).toEqual(signupData);
    });

    it("getMe calls GET /api/auth/me", async () => {
      await api.getMe();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/auth/me");
      expect(init.method).toBe("GET");
    });

    it("getDashboardStats calls GET /api/dashboard/stats", async () => {
      await api.getDashboardStats();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/dashboard/stats");
    });

    it("getMeetings with no params calls /api/meetings", async () => {
      await api.getMeetings();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/meetings");
    });

    it("getMeetings with params appends query string", async () => {
      await api.getMeetings({ status: "completed", limit: 10, offset: 5 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/meetings?");
      expect(url).toContain("status=completed");
      expect(url).toContain("limit=10");
      expect(url).toContain("offset=5");
    });

    it("getMeeting calls GET /api/meetings/:id", async () => {
      await api.getMeeting("mtg-123");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/meetings/mtg-123");
    });

    it("getTranscript calls GET /api/meetings/:id/transcript", async () => {
      await api.getTranscript("mtg-123");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/meetings/mtg-123/transcript");
    });

    it("scheduleMeeting posts to /api/meetings", async () => {
      await api.scheduleMeeting("https://meet.google.com/abc", "Standup");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/meetings");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        meetingUrl: "https://meet.google.com/abc",
        title: "Standup",
      });
    });

    it("getPrds with no params calls /api/agents/prds", async () => {
      await api.getPrds();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/agents/prds");
    });

    it("getPrds with params appends query string", async () => {
      await api.getPrds({ status: "approved", limit: 5 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("status=approved");
      expect(url).toContain("limit=5");
    });

    it("getPrd calls GET /api/agents/prds/:id", async () => {
      await api.getPrd("prd-456");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/agents/prds/prd-456");
    });

    it("approvePrd posts to /api/agents/prds/:id/approve", async () => {
      await api.approvePrd("prd-456");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/agents/prds/prd-456/approve");
      expect(init.method).toBe("POST");
    });

    it("rejectPrd posts to /api/agents/prds/:id/reject with reason", async () => {
      await api.rejectPrd("prd-456", "Not complete");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/agents/prds/prd-456/reject");
      expect(JSON.parse(init.body)).toEqual({ reason: "Not complete" });
    });

    it("createTickets posts to /api/agents/prds/:id/tickets", async () => {
      await api.createTickets("prd-456", "PROJ", "EPIC-1");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/agents/prds/prd-456/tickets");
      expect(JSON.parse(init.body)).toEqual({
        projectKey: "PROJ",
        epicKey: "EPIC-1",
      });
    });

    it("generateBrief posts to /api/agents/ba/process", async () => {
      await api.generateBrief("mtg-123");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/agents/ba/process");
      expect(JSON.parse(init.body)).toEqual({ meetingId: "mtg-123" });
    });

    it("getTasks with params appends query string", async () => {
      await api.getTasks({ status: "completed", agentType: "ba" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("status=completed");
      expect(url).toContain("agentType=ba");
    });

    it("getSettings calls GET /api/settings", async () => {
      await api.getSettings();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/settings");
    });

    it("updateIntegrations puts to /api/settings/integrations", async () => {
      await api.updateIntegrations({ jiraApiToken: "tok-123" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/settings/integrations");
      expect(init.method).toBe("PUT");
    });

    it("updateNotifications puts to /api/settings/notifications", async () => {
      await api.updateNotifications({ notifyOnMeetingEnd: true });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/settings/notifications");
      expect(init.method).toBe("PUT");
    });

    it("testIntegration posts to /api/settings/integrations/test", async () => {
      await api.testIntegration("jira");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/settings/integrations/test");
      expect(JSON.parse(init.body)).toEqual({ integration: "jira" });
    });

    it("getNotifications defaults to pending status and limit 20", async () => {
      await api.getNotifications();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/notifications?status=pending&limit=20");
    });

    it("getNotifications accepts custom status and limit", async () => {
      await api.getNotifications("all", 50);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/notifications?status=all&limit=50");
    });

    it("dismissNotification patches /api/notifications/:id", async () => {
      await api.dismissNotification("notif-789");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/notifications/notif-789");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toEqual({ status: "read" });
    });

    it("getActivity calls GET /api/dashboard/activity", async () => {
      await api.getActivity();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/dashboard/activity");
    });

    it("getActivity with limit appends query param", async () => {
      await api.getActivity(10);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/dashboard/activity?limit=10");
    });

    it("getEngagements with no status calls /api/engagements", async () => {
      await api.getEngagements();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/engagements");
    });

    it("getEngagements with status appends query param", async () => {
      await api.getEngagements("active");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/engagements?status=active");
    });

    it("getEngagement calls GET /api/engagements/:id", async () => {
      await api.getEngagement("eng-101");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/engagements/eng-101");
    });

    it("advanceEngagement posts to /api/engagements/:id/advance", async () => {
      await api.advanceEngagement("eng-101", { confidence: 0.9 });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/engagements/eng-101/advance");
      expect(init.method).toBe("POST");
    });

    it("pauseEngagement posts to /api/engagements/:id/pause", async () => {
      await api.pauseEngagement("eng-101", "Waiting for client");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/engagements/eng-101/pause");
      expect(JSON.parse(init.body)).toEqual({ reason: "Waiting for client" });
    });

    it("resumeEngagement posts to /api/engagements/:id/resume", async () => {
      await api.resumeEngagement("eng-101");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/engagements/eng-101/resume");
    });

    it("getModelConfig calls GET /api/models/config", async () => {
      await api.getModelConfig();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/models/config");
    });

    it("updateModelConfig puts to /api/models/config", async () => {
      await api.updateModelConfig({
        agentType: "ba",
        primaryModelId: "model-1",
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/models/config");
      expect(init.method).toBe("PUT");
    });

    it("getAvailableModels calls GET /api/models/available", async () => {
      await api.getAvailableModels();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/models/available");
    });

    it("getTeam calls GET /api/team", async () => {
      await api.getTeam();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/team");
    });

    it("addTeamMember posts to /api/team", async () => {
      await api.addTeamMember({
        name: "Alice",
        email: "alice@test.com",
        role: "admin",
      });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/team");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body).name).toBe("Alice");
    });

    it("updateTeamMember puts to /api/team/:id", async () => {
      await api.updateTeamMember("user-1", { role: "viewer" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/team/user-1");
      expect(init.method).toBe("PUT");
    });

    it("removeTeamMember deletes /api/team/:id", async () => {
      await api.removeTeamMember("user-1");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/team/user-1");
      expect(init.method).toBe("DELETE");
    });

    it("updateAccount puts to /api/settings/account", async () => {
      await api.updateAccount({ name: "New Name" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/settings/account");
      expect(init.method).toBe("PUT");
    });
  });

  // ─── ApiError class ───────────────────────────────────────────────────────

  describe("ApiError", () => {
    it("extends Error and carries code and status", () => {
      const err = new ApiError("Not found", "NOT_FOUND", 404);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).toBe("Not found");
      expect(err.code).toBe("NOT_FOUND");
      expect(err.status).toBe(404);
    });

    it("has the correct name for stack traces", () => {
      const err = new ApiError("Oops", "UNKNOWN", 500);
      expect(err.name).toBe("Error");
      expect(err.stack).toBeDefined();
    });
  });
});
