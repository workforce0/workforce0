import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

// The client factory builds a ModelClient per provider. Mock it so no
// real network calls fire.
const chatMock = vi.fn();
vi.mock('../../agent-runtime/clients/client-factory.js', () => ({
  createModelClient: vi.fn(() => ({
    chat: chatMock,
  })),
}));

import {
  LLMPlanner,
  parsePlanJson,
  parseCritiqueJson,
  CRITIQUE_REVISE_THRESHOLD,
  DEFAULT_SELF_CONSISTENCY_N,
  pickMostConsistent,
} from '../planner-llm.js';
import type { PlannerContext } from '../chief-of-staff.service.js';

describe('pickMostConsistent', () => {
  it('returns the sole candidate when N=1', () => {
    const a = { steps: [{ roleSlug: 'ba_agent' }], summary: 'a' };
    expect(pickMostConsistent([a])).toBe(a);
  });

  it('picks the modal step count out of three', () => {
    const a = { steps: [{ roleSlug: 'ba_agent' }], summary: '1-step' };
    const b = {
      steps: [{ roleSlug: 'ba_agent' }, { roleSlug: 'dev_agent' }],
      summary: '2-step-A',
    };
    const c = {
      steps: [{ roleSlug: 'ba_agent' }, { roleSlug: 'dev_agent' }],
      summary: '2-step-B',
    };
    // Group {2,2} beats {1}; within the 2-step group, both have the
    // same role-overlap score, so the first one wins by tie-break.
    expect(pickMostConsistent([a, b, c]).summary).toBe('2-step-A');
  });

  it('breaks a step-count tie by preferring more detail', () => {
    // Two groups of one each → tie → larger step count wins.
    const a = { steps: [{ roleSlug: 'ba_agent' }], summary: 'short' };
    const b = {
      steps: [{ roleSlug: 'ba_agent' }, { roleSlug: 'dev_agent' }, { roleSlug: 'qa_agent' }],
      summary: 'long',
    };
    expect(pickMostConsistent([a, b]).summary).toBe('long');
  });

  it('within a group, picks the candidate with the highest role-overlap score', () => {
    // All 3 have step count 2. A and B share roles; C is an outlier.
    const a = {
      steps: [{ roleSlug: 'ba_agent' }, { roleSlug: 'dev_agent' }],
      summary: 'A',
    };
    const b = {
      steps: [{ roleSlug: 'ba_agent' }, { roleSlug: 'dev_agent' }],
      summary: 'B',
    };
    const c = {
      steps: [{ roleSlug: 'architect' }, { roleSlug: 'memory_optimizer' }],
      summary: 'C',
    };
    // A overlaps with both B (2) and C (0) → score 2.
    // B overlaps with both A (2) and C (0) → score 2.
    // C overlaps with both A (0) and B (0) → score 0.
    // A wins by tie-break (first seen).
    expect(pickMostConsistent([a, b, c]).summary).toBe('A');
  });
});

describe('parseCritiqueJson', () => {
  it('parses a well-formed critique object', () => {
    const input = JSON.stringify({
      coverage: 5,
      feasibility: 4,
      dependencies: 5,
      missingContext: 4,
      ambiguity: 3,
      rationale: 'ok',
      suggestedFix: '',
    });
    const out = parseCritiqueJson(input);
    expect(out?.coverage).toBe(5);
    expect(out?.ambiguity).toBe(3);
  });

  it('clamps reject out-of-range scores via zod schema', () => {
    const input = JSON.stringify({
      coverage: 7, // out of range
      feasibility: 4,
      dependencies: 5,
      missingContext: 4,
      ambiguity: 3,
    });
    expect(parseCritiqueJson(input)).toBeNull();
  });

  it('strips a ```json fence', () => {
    const input =
      '```json\n{"coverage":5,"feasibility":5,"dependencies":5,"missingContext":5,"ambiguity":5}\n```';
    expect(parseCritiqueJson(input)?.coverage).toBe(5);
  });

  it('returns null for non-JSON content', () => {
    expect(parseCritiqueJson('looks fine to me')).toBeNull();
  });

  it('returns null for missing required fields', () => {
    expect(parseCritiqueJson('{"coverage":5}')).toBeNull();
  });
});

describe('parsePlanJson', () => {
  it('parses a clean JSON object', () => {
    const input = JSON.stringify({
      summary: 'Got it.',
      steps: [{ title: 'A', description: 'do A', roleSlug: 'ba_agent' }],
    });
    const out = parsePlanJson(input);
    expect(out?.summary).toBe('Got it.');
    expect(out?.steps).toHaveLength(1);
  });

  it('strips a ```json fence', () => {
    const input = '```json\n{"summary":"ok","steps":[{"title":"x","description":"y","roleSlug":"ba_agent"}]}\n```';
    expect(parsePlanJson(input)?.steps).toHaveLength(1);
  });

  it('strips a plain ``` fence', () => {
    const input = '```\n{"summary":"ok","steps":[{"title":"x","description":"","roleSlug":"ba_agent"}]}\n```';
    expect(parsePlanJson(input)?.summary).toBe('ok');
  });

  it('slices preamble text before the first {', () => {
    const input = 'Here is my plan:\n{"summary":"hi","steps":[{"title":"x","description":"","roleSlug":"ba_agent"}]}';
    expect(parsePlanJson(input)?.summary).toBe('hi');
  });

  it('returns null for non-JSON output', () => {
    expect(parsePlanJson('I will think about it.')).toBeNull();
  });

  it('returns null for JSON that fails schema (empty steps)', () => {
    expect(parsePlanJson('{"summary":"","steps":[]}')).toBeNull();
  });

  it('returns null for JSON with wrong shape', () => {
    expect(parsePlanJson('{"foo":"bar"}')).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(parsePlanJson('')).toBeNull();
  });

  it('accepts optional step fields (subagentSlug, skills, dependsOn)', () => {
    const input = JSON.stringify({
      summary: 'Plan.',
      steps: [
        {
          title: 'Review',
          description: 'Review the PR',
          roleSlug: 'qa_agent',
          subagentSlug: 'code-reviewer',
          skills: ['pr-review'],
          dependsOn: [0],
        },
      ],
    });
    const out = parsePlanJson(input);
    expect(out?.steps[0].subagentSlug).toBe('code-reviewer');
    expect(out?.steps[0].skills).toEqual(['pr-review']);
  });
});

const baseCtx: PlannerContext = {
  tenantId: 't1',
  parentTicket: {
    id: 'parent-1',
    title: 'Ship voice onboarding',
    description: 'Users can dial a number to start a brief.',
    roleSlug: 'chief_of_staff',
  },
  attempt: 1,
};

function makeRegistry(resolved: any) {
  return {
    resolveModel: vi.fn(async () => resolved),
  };
}

describe('LLMPlanner.plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatMock.mockReset();
  });

  it('returns null when ModelRegistry throws (no provider set up)', async () => {
    const registry = { resolveModel: vi.fn(async () => { throw new Error('no config'); }) };
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out).toBeNull();
  });

  it('returns null when resolveModel succeeds but has no apiKey', async () => {
    const registry = makeRegistry({ modelId: 'gemini-2.0-flash', provider: 'google' });
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out).toBeNull();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('returns null when the chat call throws', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock.mockRejectedValue(new Error('network down'));
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out).toBeNull();
  });

  it('returns null when model replies with non-JSON', async () => {
    const registry = makeRegistry({
      modelId: 'x',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock.mockResolvedValue({ content: 'I think we should start by analyzing.', toolCalls: [], tokenUsage: { input: 0, output: 0 }, stopReason: 'end_turn' });
    const planner = new LLMPlanner({ modelRegistry: registry as any });
    expect(await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] })).toBeNull();
  });

  it('returns a parsed plan on a valid JSON response', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const planJson = JSON.stringify({
      summary: "I'll analyze the request, draft a brief, then route to dev.",
      steps: [
        { title: 'Draft brief', description: 'Turn transcript into a PRD.', roleSlug: 'ba_agent' },
        { title: 'Implement', description: 'Write the code.', roleSlug: 'dev_agent' },
      ],
    });
    chatMock.mockResolvedValue({
      content: planJson,
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out?.summary).toMatch(/analyze/i);
    expect(out?.steps).toHaveLength(2);
    expect(out?.steps[0].roleSlug).toBe('ba_agent');
  });

  it('drops subagentSlug and skills the model invented (cross-validate against lists)', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'Plan.',
        steps: [
          {
            title: 'Review',
            description: 'Look at it.',
            roleSlug: 'qa_agent',
            subagentSlug: 'made-up-subagent',
            skills: ['does-not-exist', 'real-skill'],
          },
        ],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({ modelRegistry: registry as any });
    const out = await planner.plan({
      context: baseCtx,
      availableSkills: [{ slug: 'real-skill', description: '' }],
      availableSubagents: [{ slug: 'code-reviewer', description: '' }],
    });
    expect(out?.steps[0].subagentSlug).toBeUndefined();
    expect(out?.steps[0].skills).toEqual(['real-skill']);
  });

  it('skips the LLM and returns null when the budget gate reports over-cap', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const budgetGate = {
      isOverRoleMonthlyBudget: vi.fn(async () => ({ over: true, used: 500_000, cap: 400_000 })),
    };
    const planner = new LLMPlanner({ modelRegistry: registry as any, budgetGate });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out).toBeNull();
    expect(chatMock).not.toHaveBeenCalled();
    expect(budgetGate.isOverRoleMonthlyBudget).toHaveBeenCalledWith('t1', 'chief_of_staff');
  });

  it('continues with the LLM when budget gate returns under-cap', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const budgetGate = {
      isOverRoleMonthlyBudget: vi.fn(async () => ({ over: false, used: 100_000, cap: 400_000 })),
    };
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'ok',
        steps: [{ title: 'Step', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({ modelRegistry: registry as any, budgetGate });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out).not.toBeNull();
    // M8.1: two calls — initial plan + critique. If the critique
    // parsed as a valid score (rare in this fake mock where the
    // response is always plan-shaped) a third revise call could fire;
    // we only care that at least the initial plan went out.
    expect(chatMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('continues with the LLM when the budget gate itself throws (fail-open)', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const budgetGate = {
      isOverRoleMonthlyBudget: vi.fn(async () => { throw new Error('usage service down'); }),
    };
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'ok',
        steps: [{ title: 'Step', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({ modelRegistry: registry as any, budgetGate });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out).not.toBeNull();
    expect(chatMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the draft plan when the critic scores above threshold', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    // Call 1: plan draft.  Call 2: passing critique (total >= threshold).
    chatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'Draft plan.',
          steps: [{ title: 'S1', description: '', roleSlug: 'ba_agent' }],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          coverage: 5,
          feasibility: 5,
          dependencies: 5,
          missingContext: 5,
          ambiguity: 5,
          rationale: 'all good',
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      });
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out?.summary).toBe('Draft plan.');
    expect(chatMock).toHaveBeenCalledTimes(2); // plan + critique, no revision
  });

  it('revises the plan when the critic scores below threshold', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'Weak draft.',
          steps: [{ title: 'S1', description: '', roleSlug: 'ba_agent' }],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          coverage: 1,
          feasibility: 2,
          dependencies: 2,
          missingContext: 1,
          ambiguity: 2,
          rationale: 'missing critical steps',
          suggestedFix: 'add a QA step',
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'Revised plan with QA.',
          steps: [
            { title: 'S1', description: '', roleSlug: 'ba_agent' },
            { title: 'QA', description: '', roleSlug: 'qa_agent' },
          ],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      });
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out?.summary).toBe('Revised plan with QA.');
    expect(out?.steps).toHaveLength(2);
    expect(chatMock).toHaveBeenCalledTimes(3); // plan + critique + revise
  });

  it('falls back to the draft when the revise call returns unparseable JSON', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'Draft.',
          steps: [{ title: 'S1', description: '', roleSlug: 'ba_agent' }],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          coverage: 1,
          feasibility: 1,
          dependencies: 1,
          missingContext: 1,
          ambiguity: 1,
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: 'the revise call returned prose',
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      });
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    // Falls back to the original draft rather than returning null.
    expect(out?.summary).toBe('Draft.');
  });

  it('keeps the draft when the critic itself throws', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'D.',
          steps: [{ title: 'S', description: '', roleSlug: 'ba_agent' }],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockRejectedValueOnce(new Error('critic timeout'));
    const planner = new LLMPlanner({ modelRegistry: registry as any, selfConsistencyN: 1 });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out?.summary).toBe('D.');
  });

  it('exposes CRITIQUE_REVISE_THRESHOLD as a 20-of-25 cutoff', () => {
    expect(CRITIQUE_REVISE_THRESHOLD).toBe(20);
  });

  it('exposes DEFAULT_SELF_CONSISTENCY_N as 3', () => {
    expect(DEFAULT_SELF_CONSISTENCY_N).toBe(3);
  });

  it('includes project landmarks from godNodeProvider in the user message when projectId is set', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const godNodeProvider = {
      getGodNodeNames: vi.fn(async () => ['BAAgentService', 'QueueService', 'TicketService']),
    };
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'ok',
        steps: [{ title: 'x', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({
      modelRegistry: registry as any,
      godNodeProvider: godNodeProvider as any,
      selfConsistencyN: 1,
    });
    const ctxWithProject = {
      ...baseCtx,
      parentTicket: { ...baseCtx.parentTicket, projectId: 'proj-1' } as any,
    };
    await planner.plan({
      context: ctxWithProject,
      availableSkills: [],
      availableSubagents: [],
    });
    expect(godNodeProvider.getGodNodeNames).toHaveBeenCalledWith('t1', 'proj-1', 5);
    const userMsg = chatMock.mock.calls[0][0].messages[0].content as string;
    expect(userMsg).toContain('## Project landmarks');
    expect(userMsg).toContain('- BAAgentService');
    expect(userMsg).toContain('- QueueService');
  });

  it('omits project landmarks when the ticket has no projectId', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const godNodeProvider = {
      getGodNodeNames: vi.fn(async () => ['ShouldNotAppear']),
    };
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'ok',
        steps: [{ title: 'x', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({
      modelRegistry: registry as any,
      godNodeProvider: godNodeProvider as any,
      selfConsistencyN: 1,
    });
    await planner.plan({
      context: baseCtx, // no projectId
      availableSkills: [],
      availableSubagents: [],
    });
    expect(godNodeProvider.getGodNodeNames).not.toHaveBeenCalled();
    const userMsg = chatMock.mock.calls[0][0].messages[0].content as string;
    expect(userMsg).not.toContain('Project landmarks');
  });

  it('captures the graph contentHash from getGodNodeSnapshot into plan metrics (PG.13)', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const godNodeProvider = {
      getGodNodeNames: vi.fn(async () => []), // should not be called when snapshot present
      getGodNodeSnapshot: vi.fn(async () => ({
        names: ['Alpha', 'Beta'],
        contentHash: 'sha-abc',
      })),
    };
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'ok',
        steps: [{ title: 'x', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({
      modelRegistry: registry as any,
      godNodeProvider: godNodeProvider as any,
      selfConsistencyN: 1,
    });
    const ctxWithProject = {
      ...baseCtx,
      parentTicket: { ...baseCtx.parentTicket, projectId: 'proj-1' } as any,
    };
    const out = await planner.plan({
      context: ctxWithProject,
      availableSkills: [],
      availableSubagents: [],
    });
    expect(godNodeProvider.getGodNodeSnapshot).toHaveBeenCalledWith('t1', 'proj-1', 5);
    expect(godNodeProvider.getGodNodeNames).not.toHaveBeenCalled();
    expect(out?.metrics?.graphContentHash).toBe('sha-abc');
    const userMsg = chatMock.mock.calls[0][0].messages[0].content as string;
    expect(userMsg).toContain('- Alpha');
    expect(userMsg).toContain('- Beta');
  });

  it('leaves graphContentHash null when the provider only has getGodNodeNames (PG.13)', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const godNodeProvider = {
      getGodNodeNames: vi.fn(async () => ['Legacy']),
      // no getGodNodeSnapshot
    };
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'ok',
        steps: [{ title: 'x', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({
      modelRegistry: registry as any,
      godNodeProvider: godNodeProvider as any,
      selfConsistencyN: 1,
    });
    const out = await planner.plan({
      context: {
        ...baseCtx,
        parentTicket: { ...baseCtx.parentTicket, projectId: 'proj-1' } as any,
      },
      availableSkills: [],
      availableSubagents: [],
    });
    expect(out?.metrics?.graphContentHash ?? null).toBeNull();
  });

  it('continues when godNodeProvider throws (non-fatal)', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    const godNodeProvider = {
      getGodNodeNames: vi.fn(async () => { throw new Error('graph not built'); }),
    };
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'ok',
        steps: [{ title: 'x', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({
      modelRegistry: registry as any,
      godNodeProvider: godNodeProvider as any,
      selfConsistencyN: 1,
    });
    const ctx = {
      ...baseCtx,
      parentTicket: { ...baseCtx.parentTicket, projectId: 'proj-1' } as any,
    };
    const out = await planner.plan({ context: ctx, availableSkills: [], availableSubagents: [] });
    expect(out).not.toBeNull();
    const userMsg = chatMock.mock.calls[0][0].messages[0].content as string;
    expect(userMsg).not.toContain('Project landmarks');
  });

  it('runs N=3 plan calls in parallel by default and picks the winner', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    // Three different plans; pickMostConsistent should pick the 2-step
    // majority. Then critique runs once, passes.
    chatMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'A',
          steps: [{ title: 'x', description: '', roleSlug: 'ba_agent' }],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'B',
          steps: [
            { title: 'x', description: '', roleSlug: 'ba_agent' },
            { title: 'y', description: '', roleSlug: 'dev_agent' },
          ],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'C',
          steps: [
            { title: 'x', description: '', roleSlug: 'ba_agent' },
            { title: 'y', description: '', roleSlug: 'dev_agent' },
          ],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          coverage: 5,
          feasibility: 5,
          dependencies: 5,
          missingContext: 5,
          ambiguity: 5,
          rationale: 'ok',
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      });
    const planner = new LLMPlanner({ modelRegistry: registry as any }); // default N=3
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(chatMock.mock.calls.length).toBe(4); // 3 plans + 1 critique
    // Winner is B or C (both 2-step, role-overlap ties; tie-break picks first seen in group = B).
    expect(out?.summary).toBe('B');
  });

  it('tolerates some draft failures in the self-consistency batch', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    // First draft throws; second returns garbage; third returns valid.
    // Critique then passes.
    chatMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({
        content: 'not json at all',
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'Only valid draft.',
          steps: [{ title: 'x', description: '', roleSlug: 'ba_agent' }],
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          coverage: 5,
          feasibility: 5,
          dependencies: 5,
          missingContext: 5,
          ambiguity: 5,
          rationale: 'ok',
        }),
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      });
    const planner = new LLMPlanner({ modelRegistry: registry as any });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out?.summary).toBe('Only valid draft.');
  });

  it('returns null when all self-consistency drafts fail', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'));
    const planner = new LLMPlanner({ modelRegistry: registry as any });
    const out = await planner.plan({ context: baseCtx, availableSkills: [], availableSubagents: [] });
    expect(out).toBeNull();
  });

  it('includes replan context in the user message when attempt > 1', async () => {
    const registry = makeRegistry({
      modelId: 'gemini-2.0-flash',
      provider: 'google',
      apiKeyEnc: 'fake-key',
    });
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        summary: 'Trying a different angle.',
        steps: [{ title: 'Alt', description: '', roleSlug: 'ba_agent' }],
      }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    });
    const planner = new LLMPlanner({ modelRegistry: registry as any });
    await planner.plan({
      context: { ...baseCtx, attempt: 2, replanReason: 'tests failed: connection reset' },
      availableSkills: [],
      availableSubagents: [],
    });
    const userMsg = chatMock.mock.calls[0][0].messages[0].content as string;
    expect(userMsg).toMatch(/Attempt: 2/);
    expect(userMsg).toMatch(/connection reset/);
    expect(userMsg).toMatch(/don't repeat what failed/);
  });
});
