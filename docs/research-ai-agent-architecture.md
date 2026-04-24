# Deep Research: Production AI Agent Architecture for Workforce Automation

**Date:** March 2026
**Purpose:** Technology evaluation and architecture decision for building production AI agents at scale.

---

## Table of Contents

1. [Claude Agent SDK (Anthropic)](#1-claude-agent-sdk-anthropic)
2. [Claude Tool Use / Multi-Agent Systems](#2-claude-tool-use--multi-agent-systems)
3. [LangGraph](#3-langgraph)
4. [CrewAI](#4-crewai)
5. [Vercel AI SDK](#5-vercel-ai-sdk)
6. [OpenAI Agents SDK](#6-openai-agents-sdk)
7. [Architecture Recommendation](#7-architecture-recommendation-for-workforce0)
8. [Practical Production Patterns](#8-practical-production-patterns)
9. [Sources](#9-sources)

---

## 1. Claude Agent SDK (Anthropic)

### What It Is

The Claude Agent SDK (formerly Claude Code SDK, renamed September 2025) gives developers the same tools, agent loop, and context management that power Claude Code -- programmable in **Python and TypeScript**. It is Anthropic's official framework for building production AI agents.

### Architecture: The Agent Loop

The SDK is built around a three-phase agentic loop:

```
Gather Context -> Take Action -> Verify Work -> Repeat
```

Internally, the pattern is minimal: `while(tool_call) -> execute tool -> feed results -> repeat`. The loop continues as long as the model's response includes tool usage. When Claude produces a plain text response without tool calls, the loop terminates.

**Key design choice:** A single main thread with one flat list of messages -- no swarms, no competing agent personas. Anthropic explicitly chose this for debuggability and reliability. The flat message history eliminates many debugging and state management challenges that plague multi-threaded agent systems.

### Execution Model

- **Read-only tools** (Read, Glob, Grep, MCP tools marked read-only) run **concurrently**
- **State-modifying tools** (Edit, Write, Bash) run **sequentially** to avoid conflicts
- Conversation state is persisted locally, enabling rewinding, resuming, and forking sessions

### Built-In Capabilities

- Built-in tools for reading files, running commands, editing code
- Connect custom tools, databases, and APIs via **Model Context Protocol (MCP)**
- Built-in error handling, session management, monitoring
- Automatic prompt caching and performance optimizations
- Structured outputs from agents (typed responses)

### Production Readiness

**Yes -- production-ready.** The SDK runs the same code that powers Claude Code, which is used by hundreds of thousands of developers daily. It includes:
- Automatic context management for long-running tasks
- Error recovery and retry logic
- Session persistence
- Observability hooks

### Multi-Agent: Agent Teams

Anthropic launched Agent Teams (experimental) alongside Opus 4.6:
- One session acts as **team lead** (coordinates, assigns tasks, synthesizes results)
- **Teammates** work independently in their own context windows
- Direct agent-to-agent communication
- Enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

### Verdict

Best choice if you want a battle-tested agent runtime with minimal abstraction. The flat-loop design is simple to reason about. MCP support makes tool integration extensible. However, it is tightly coupled to Claude models.

---

## 2. Claude Tool Use / Multi-Agent Systems

### Tool Definition

Tools are defined via JSON schema in the `tools` parameter of the Messages API:

```json
{
  "name": "create_prd",
  "description": "Creates a product requirements document",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "requirements": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["title", "requirements"]
  }
}
```

Adding `strict: true` ensures Claude's tool calls always match your schema exactly, eliminating type mismatches or missing fields.

### Advanced: Programmatic Tool Calling

Introduced in 2025, this allows Claude to write code that calls tools programmatically within a code execution container, rather than requiring round trips through the model for each tool invocation. Benefits:
- Reduces latency for multi-tool workflows
- Decreases token consumption
- Enables complex orchestration logic within a single turn

### Multi-Agent Patterns That Work

Anthropic identifies **three situations** where multiple agents consistently outperform a single agent:

1. **Context pollution** -- when unrelated information degrades performance
2. **Parallelizable tasks** -- work that can run concurrently
3. **Specialization** -- when focused toolsets improve tool selection

**Anti-pattern:** An agent with 20+ tools struggles to select the right one. Specialized agents with focused toolsets matched to responsibilities improve reliability.

### Orchestration Patterns

- **Conductor pattern:** A primary agent decomposes work into dependency graphs, spawns background agents to execute in parallel, processes completion notifications as they arrive
- **Subagent pattern:** Main agent delegates specific subtasks to specialized subagents
- **Pipeline pattern:** Sequential handoff between agents (e.g., transcription -> analysis -> PRD generation -> code)

### Key Guideline

Different tasks benefit from different tool sets, system prompts, and domains of expertise. Rather than one agent with access to dozens of tools, use specialized agents with 5-8 focused tools each.

---

## 3. LangGraph

### What It Is

LangGraph is a library built on LangChain for creating **stateful, multi-agent applications** as directed graphs. It is the most mature framework for complex agent orchestration.

### Core Architecture

Three key components:

1. **State** -- A shared data structure (TypedDict or Pydantic model) representing the application snapshot. Flows through every node. Updates merged via reducer logic.
2. **Nodes** -- Python/JS functions encoding agent logic. Each node reads state, performs work, returns state updates.
3. **Edges** -- Functions determining which node executes next. Can be fixed transitions or conditional branches.

### State Management

- Central persistence layer with **checkpointers** (SQLite, Redis, Postgres)
- State is persisted at each step, enabling:
  - Rewinding to any previous state
  - Resuming after crashes
  - Forking workflows
  - Human-in-the-loop interrupts
  - Debugging by inspecting any point in execution

### Conditional Routing

```python
def route_by_confidence(state):
    if state["confidence"] > 0.9:
        return "auto_execute"
    elif state["confidence"] > 0.7:
        return "human_review"
    else:
        return "escalate"

graph.add_conditional_edges("evaluate", route_by_confidence)
```

This maps directly to confidence-based routing with human approval.

### Human-in-the-Loop

First-class support:
- Pause execution at any node
- Inspect current state
- Approve/reject/modify before continuing
- Resume from checkpoint

### Production Readiness

**Yes -- the most battle-tested framework for complex workflows.** Key advantages:
- Built-in checkpointing for durability
- Model-agnostic (works with Claude, GPT, Gemini, Llama)
- State rollback and recovery
- Human-in-the-loop as a core primitive
- LangGraph Cloud for managed deployment

### Drawbacks

- 1-2 week learning curve for the graph paradigm
- LangChain dependency (though lighter than full LangChain)
- Can be over-engineered for simple agent tasks
- Abstraction overhead adds complexity for debugging

### Verdict

Best choice for **complex, stateful workflows** that need conditional routing, human approval, durability, and multi-model support. The graph paradigm maps naturally to business workflows. The 1-2 week learning curve pays off for production systems.

---

## 4. CrewAI

### What It Is

CrewAI is a **Python-only** framework for role-based multi-agent collaboration. Built entirely from scratch (independent of LangChain). Models agent teams as organizational structures with roles, tasks, and delegation.

### Core Concepts

- **Agents** have roles, goals, backstories, and assigned tools
- **Tasks** have descriptions, expected outputs, and assigned agents
- **Crews** combine agents and tasks with a defined process
- **Processes**: Sequential, Hierarchical (with a manager agent), or Consensus-based

### Agent Roles

- **Manager agents** oversee task distribution and monitor progress
- **Worker agents** execute specific tasks with specialized tools
- **Researcher agents** handle information gathering and analysis

### Delegation

Agents can delegate tasks to other agents, ask questions, and collaborate. The hierarchical process automatically assigns a manager that coordinates planning and execution.

### Production Readiness

**Mixed.** CrewAI claims 1.4B agentic automations across enterprises (PwC, IBM, NVIDIA). However:
- **CrewAI Flows** is the enterprise/production architecture (separate from basic CrewAI)
- The basic framework is better suited for prototyping
- Teams frequently **outgrow CrewAI** and migrate to LangGraph as complexity increases

### Common Migration Path

CrewAI -> LangGraph is the most common migration pattern:
1. Prototype in CrewAI (fast, intuitive)
2. Validate the concept
3. Hit CrewAI's control flow ceiling
4. Map each CrewAI agent to a LangGraph node
5. Convert process to explicit graph edges
6. Move shared context to LangGraph state

### Verdict

**Best for rapid prototyping** of multi-agent concepts. The role-based paradigm is intuitive for non-technical stakeholders. But plan to migrate to something more robust for production. Not recommended as a long-term production foundation for a startup.

---

## 5. Vercel AI SDK

### What It Is

The Vercel AI SDK (v6.0+ released late 2025) is a **TypeScript-first** framework for building AI-powered applications in Next.js/Node.js. It is the best option for teams building AI features into web applications.

### Agent Architecture (v6)

AI SDK 6 introduced the **Agent abstraction**:
- Define agent once with model, instructions, and tools
- Reuse across your entire application
- Automatic integration with streaming UI, structured outputs, framework support

The **ToolLoopAgent** class handles the complete tool execution loop:
1. Call LLM with prompt
2. Execute any requested tool calls
3. Add results back to conversation
4. Repeat until complete (default: 20 steps max, configurable via `stopWhen`)

### Streaming

- **Server-Sent Events (SSE)** replace WebSockets for stable real-time responses
- React hooks manage state and error handling
- Reduces 200-300 lines of streaming boilerplate to 10-20 lines
- Handles connection drops, partial data, backpressure

### Tool Calling

Tools defined with Zod schemas for type safety:

```typescript
const tools = {
  getWeather: tool({
    description: 'Get weather for a location',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => fetchWeather(city),
  }),
};
```

### Multi-Step + Structured Output

AI SDK 6 unifies `generateObject` and `generateText`:
- Multi-step tool calling loops with structured output at the end
- No more chaining `generateText` then `generateObject`
- `prepareStep` and `stopWhen` for fine-grained control

### Provider Flexibility

Model-agnostic -- works with Claude, GPT, Gemini, Llama, etc. Switch providers without rewriting agent logic.

### Production Readiness

**Yes, for web-facing AI features.** Key advantages:
- 50-70% faster development than custom implementations
- Built-in streaming with React integration
- Type-safe tool calling
- Provider flexibility
- Human-in-the-loop via tool approval workflows

### Limitations

- TypeScript only (no Python)
- Optimized for request/response web patterns, not long-running background workflows
- Less suited for complex orchestration (no built-in state machines or checkpointing)
- Better as the **frontend/API layer** than the **orchestration layer**

### Verdict

**Best choice for the web/API layer** of an agent platform built on Next.js. Use it for streaming agent responses to users, handling tool approval UIs, and managing the human-agent interaction. Pair it with a backend orchestration layer (LangGraph, Temporal, or custom) for complex workflows.

---

## 6. OpenAI Agents SDK

### What It Is

Launched March 2025, the OpenAI Agents SDK is a lightweight Python framework for multi-agent coordination. Key features: intelligent agent handoffs, guardrails, and tracing.

### Architecture

- **Agents** with instructions, tools, and model configuration
- **Handoffs** -- first-class concept for transferring control between agents
- **Guardrails** -- input/output validation, safety rails
- **Tracing** -- built-in observability for debugging agent behavior

### Handoff Pattern

The SDK's signature feature: agents can hand off conversations to other specialized agents. For example, a triage agent hands off to a billing agent or a technical support agent based on the user's intent.

### Comparison with Claude Agent SDK

| Feature | OpenAI Agents SDK | Claude Agent SDK |
|---------|-------------------|------------------|
| **Language** | Python | Python + TypeScript |
| **Model Lock-in** | OpenAI models | Claude models |
| **Key Strength** | Handoffs + guardrails | Tool use + MCP protocol |
| **Multi-Agent** | Handoff-based | Subagent / team-based |
| **Ecosystem** | OpenAI tools (code interpreter, retrieval) | MCP ecosystem (open standard) |
| **Production Use** | Newer, less battle-tested | Powers Claude Code |
| **Deployment** | Your infrastructure | Your infrastructure |
| **Open Protocol** | No (proprietary) | Yes (MCP is open) |

### Verdict

Good if you are committed to OpenAI models. The handoff pattern is elegant for customer-facing conversational agents. But **MCP's open protocol** gives Claude's ecosystem a strategic advantage -- your tools work with any MCP-compatible system, not just one vendor.

---

## 7. Architecture Recommendation for Workforce0

### Requirements Recap

- Multiple specialized agents (BA, Dev, Sales, Marketing)
- Multi-tenant (each customer has different integrations)
- Confidence-based routing with human approval
- Long-running workflows (hours/days)
- Meeting transcription -> PRD -> Code pipeline
- Multi-model consensus (Claude + Gemini + GPT)

### Recommended Architecture: Hybrid Layered Approach

**Do not pick one framework. Layer them.**

```
+------------------------------------------------------------------+
|                    FRONTEND / API LAYER                           |
|           Vercel AI SDK (Next.js) + SSE Streaming                |
|     Human-in-the-loop UI, agent chat, approval workflows         |
+------------------------------------------------------------------+
                              |
+------------------------------------------------------------------+
|                   ORCHESTRATION LAYER                             |
|        LangGraph (state machines + conditional routing)          |
|     OR Temporal (durable execution for long-running flows)       |
|                                                                  |
|  - Workflow state management (checkpointed)                      |
|  - Confidence-based routing                                      |
|  - Human approval gates                                          |
|  - Agent-to-agent communication                                  |
|  - Multi-model consensus voting                                  |
+------------------------------------------------------------------+
                              |
+------------------------------------------------------------------+
|                    AGENT EXECUTION LAYER                          |
|           Each agent = Claude API + System Prompt + Tools         |
|                                                                  |
|  BA Agent    | Dev Agent   | Sales Agent  | Marketing Agent      |
|  - MCP tools | - MCP tools | - MCP tools  | - MCP tools          |
|  - Focused   | - Focused   | - Focused    | - Focused            |
|    toolset   |   toolset   |   toolset    |   toolset            |
+------------------------------------------------------------------+
                              |
+------------------------------------------------------------------+
|                    INFRASTRUCTURE LAYER                           |
|  - Temporal / Bull MQ (durable job execution)                    |
|  - PostgreSQL (state, tenants, audit logs)                       |
|  - Redis (caching, session state, pub/sub)                       |
|  - S3/R2 (artifacts, transcripts, PRDs)                          |
|  - Vector DB (agent memory, RAG)                                 |
+------------------------------------------------------------------+
```

### Answer to the Architecture Question

**The right answer is (d) -- a custom agent loop with tool calling -- but with LangGraph or Temporal for orchestration.**

Here is why each option alone falls short:

| Option | Why Not Alone |
|--------|--------------|
| (a) Claude API + system prompt + tools | No state persistence, no routing, no durability. Good for individual agents but not orchestration. |
| (b) LangGraph state machine | Good for orchestration but overkill as the agent runtime itself. Use it as the workflow layer, not the agent layer. |
| (c) Bedrock Agent | Vendor lock-in to AWS. 3-4s latency penalty vs direct API. New Claude models arrive weeks/months late. Good for enterprises needing compliance, wrong for a startup needing speed. |
| (d) Custom agent loop | Correct for the agent layer. Each agent is a simple while-loop calling Claude with focused tools. |
| (e) Something else | The "something else" is the layered hybrid described above. |

### Per-Agent Design

Each specialized agent should be:

```typescript
// Simplified agent structure
const baAgent = {
  model: "claude-sonnet-4-5",       // or swap models per task
  systemPrompt: BA_SYSTEM_PROMPT,    // role, expertise, constraints
  tools: [                           // 5-8 focused tools
    analyzeTranscript,
    createPRD,
    searchConfluence,
    queryJira,
    askClarification,
  ],
  maxSteps: 25,
  confidenceThreshold: 0.85,        // below this -> human review
};
```

### Multi-Model Consensus Pattern

For high-stakes decisions (e.g., final PRD approval, code review):

```
1. Send same prompt to Claude + Gemini + GPT
2. Collect structured outputs from each
3. Compare outputs programmatically
4. If all agree (>90% similarity) -> auto-approve
5. If 2/3 agree -> flag for quick human review
6. If disagreement -> escalate to human with all three perspectives
```

Cost optimization: Use Claude Sonnet for most work, Gemini Flash for high-volume cheap tasks, reserve Opus/GPT-4 for consensus checks.

### Multi-Tenant Architecture

```
Per-Tenant Configuration:
{
  tenantId: "acme-corp",
  integrations: {
    crm: { type: "salesforce", credentials: "vault://acme/sf" },
    pm: { type: "jira", credentials: "vault://acme/jira" },
    docs: { type: "confluence", credentials: "vault://acme/conf" },
  },
  agents: {
    ba: { enabled: true, model: "claude-sonnet-4-5" },
    dev: { enabled: true, model: "claude-sonnet-4-5" },
    sales: { enabled: false },
  },
  approvalRules: {
    prdCreation: "human-in-the-loop",
    codeGeneration: "human-in-the-loop",
    emailDraft: "human-on-the-loop",
    dataQuery: "autonomous",
  },
}
```

Tools are resolved at runtime based on tenant configuration via MCP, so the same agent code works across tenants with different integrations.

### Meeting Transcription -> PRD -> Code Pipeline

```
[Meeting Recording]
      |
      v
[Transcription Service] (Whisper / AssemblyAI / Deepgram)
      |
      v
[BA Agent] -- Analyzes transcript
      |       -- Extracts requirements, decisions, action items
      |       -- Generates draft PRD (structured output)
      |
      v
[Human Review Gate] -- Stakeholder reviews PRD
      |               -- Approves / requests changes
      |
      v
[Dev Agent] -- Breaks PRD into technical tasks
      |       -- Generates code scaffolding
      |       -- Creates Jira tickets
      |
      v
[Human Review Gate] -- Tech lead reviews
      |
      v
[Output] -- Approved PRD + Jira tickets + Code scaffolds
```

Each stage is a **checkpointed step** in LangGraph or Temporal. If the pipeline fails at any point, it resumes from the last checkpoint. Human review gates can take hours or days -- durable execution handles this natively.

---

## 8. Practical Production Patterns

### 8.1 Agent Memory and Context

**Three-tier memory architecture:**

1. **Working memory** (within conversation): The current message history. Keep focused -- summarize older context rather than keeping everything.
2. **Session memory** (across turns in a workflow): Stored in PostgreSQL/Redis. Includes decisions made, artifacts created, approval status.
3. **Long-term memory** (across sessions): Vector database for semantic search. Agent can recall past decisions, patterns, and user preferences.

**Key insight:** Don't dump everything into the prompt. Use retrieval (reactive recall when the agent recognizes gaps) + proactive recall (pre-processor runs similarity search on user input).

### 8.2 Tool Error Handling

```typescript
async function executeToolWithRetry(tool, input, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await tool.execute(input);
      return { success: true, result };
    } catch (error) {
      if (attempt === maxRetries) {
        return {
          success: false,
          error: error.message,
          suggestion: "Tool failed after retries. Consider alternative approach."
        };
      }
      // Exponential backoff
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

Feed failures back to the agent as context so it can adapt its approach. Never silently swallow errors.

### 8.3 Retries and Bounded Autonomy

Set explicit budgets and stop conditions:
- **Maximum tool calls** per agent turn (e.g., 25)
- **Maximum retries** per tool (e.g., 3)
- **Timeout** per workflow step (e.g., 5 minutes for API calls, 48 hours for human review)
- **Confidence threshold** below which to escalate
- **Cost budget** per workflow execution

### 8.4 Human-in-the-Loop Approval

**Tiered autonomy model:**

| Action Type | Autonomy Level | Example |
|-------------|---------------|---------|
| Read-only queries | Fully autonomous | Searching docs, analyzing data |
| Draft creation | Human-on-the-loop | Email drafts, PRD drafts (auto-send with monitoring) |
| External actions | Human-in-the-loop | Sending emails, creating Jira tickets |
| Destructive actions | Strict approval | Deleting data, modifying production systems |
| Financial actions | Multi-approval | Budget allocation, contract changes |

Implementation: LangGraph `interrupt_before` on sensitive nodes, or Temporal signal/query pattern for external approval.

### 8.5 Agent-to-Agent Communication

**Three patterns in order of preference:**

1. **Shared state** (simplest): Agents read/write to a shared state object managed by the orchestrator. No direct communication needed.
2. **Message passing**: Agents send structured messages via a queue (Redis pub/sub, SQS). The orchestrator routes messages.
3. **Direct delegation**: One agent spawns another as a subagent, waits for results. Used when Agent A needs Agent B to complete a subtask.

Avoid: Agents talking to each other in unstructured natural language without orchestrator oversight. This leads to context pollution and unpredictable behavior.

### 8.6 Cost Optimization

| Strategy | Impact | Implementation |
|----------|--------|---------------|
| **Model tiering** | 60-80% savings | Use Sonnet for routine work, Opus for complex reasoning, Flash for high-volume |
| **Prompt caching** | 30-50% savings | Claude's automatic caching for repeated system prompts and tool definitions |
| **Structured outputs** | 20-30% savings | Reduce retries from malformed outputs |
| **Early termination** | Variable | Stop agent loops when confidence is high enough |
| **Batch processing** | 40-60% savings | Use Claude's batch API for non-urgent work (50% cheaper) |
| **Context pruning** | 20-40% savings | Summarize old context instead of keeping full history |

**Cost model per workflow (estimated):**
- Meeting transcription: $0.01-0.05 (Whisper API)
- BA analysis + PRD generation: $0.10-0.50 (Claude Sonnet, ~5-10 tool calls)
- Multi-model consensus check: $0.30-1.00 (3 models)
- Total pipeline cost: $0.50-2.00 per meeting-to-PRD workflow

### 8.7 Observability and Debugging

Essential for production:
- **Trace every agent step**: Input, tool calls, outputs, latency, cost
- **Log confidence scores** at each decision point
- **Record human overrides** to improve prompts over time
- **Alert on anomalies**: Unusual tool call patterns, excessive retries, cost spikes
- **Replay capability**: Rerun any workflow from any checkpoint with the same or modified inputs

Tools: LangSmith (if using LangGraph), Langfuse (open-source), custom logging to your observability stack.

---

## 9. Sources

### Claude Agent SDK
- [Agent SDK Overview - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Building Agents with the Claude Agent SDK | Anthropic](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [How the Agent Loop Works - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/agent-loop)
- [Claude Agent SDK Python - GitHub](https://github.com/anthropics/claude-agent-sdk-python)
- [Claude Agent SDK - npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

### Claude Tool Use & Multi-Agent
- [How to Implement Tool Use - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- [Tool Use with Claude - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Advanced Tool Use - Anthropic Engineering](https://www.anthropic.com/engineering/advanced-tool-use)
- [When to Use Multi-Agent Systems | Claude Blog](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)
- [Claude Code's Hidden Multi-Agent System](https://paddo.dev/blog/claude-code-hidden-swarm/)
- [Programmatic Tool Calling - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)

### LangGraph
- [LangGraph: Agent Orchestration Framework](https://www.langchain.com/langgraph)
- [LangGraph Multi-Agent Workflows - LangChain Blog](https://blog.langchain.com/langgraph-multi-agent-workflows/)
- [Build Multi-Agent Systems with LangGraph - AWS](https://aws.amazon.com/blogs/machine-learning/build-multi-agent-systems-with-langgraph-and-amazon-bedrock/)
- [Graph API Overview - LangChain Docs](https://docs.langchain.com/oss/python/langgraph/graph-api)

### CrewAI
- [CrewAI - The Leading Multi-Agent Platform](https://crewai.com/)
- [CrewAI Open Source Framework](https://crewai.com/open-source)
- [CrewAI Documentation](https://docs.crewai.com/)
- [CrewAI Framework 2025 Review](https://latenode.com/blog/ai-frameworks-technical-infrastructure/crewai-framework/crewai-framework-2025-complete-review-of-the-open-source-multi-agent-ai-platform)
- [CrewAI GitHub](https://github.com/crewAIInc/crewAI)

### Vercel AI SDK
- [AI SDK 6 - Vercel Blog](https://vercel.com/blog/ai-sdk-6)
- [How to Build AI Agents with Vercel AI SDK](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [AI SDK Agents Overview](https://ai-sdk.dev/docs/agents/overview)
- [AI SDK Agents: Building Agents](https://ai-sdk.dev/docs/agents/building-agents)
- [AI SDK Introduction](https://ai-sdk.dev/docs/introduction)

### OpenAI Agents SDK
- [OpenAI Agents SDK vs Claude Agent SDK Comparison](https://agentpatch.ai/blog/openai-agents-sdk-vs-claude-agent-sdk/)
- [AI Framework Comparison 2025: OpenAI vs Claude vs LangGraph](https://enhancial.substack.com/p/choosing-the-right-ai-framework-a)
- [The AI Agent Landscape in 2026](https://www.aimakers.co/blog/ai-agents-landscape-2026/)

### Production Architecture & Patterns
- [Multi-Agent Systems: Architecture, Integration, and Governance](https://theblue.ai/blog/multi-agent-ai-2026-enterprise-integration/)
- [The 2026 Guide to Agentic Workflow Architectures](https://www.stackai.com/blog/the-2026-guide-to-agentic-workflow-architectures)
- [Agents At Work: 2026 Playbook for Reliable Agentic Workflows](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/)
- [Top 10 Enterprise AI Automation Platforms 2026](https://www.vellum.ai/blog/guide-to-enterprise-ai-automation-platforms)
- [Memory for AI Agents: Context Engineering - The New Stack](https://thenewstack.io/memory-for-ai-agents-a-new-paradigm-of-context-engineering/)
- [Measuring AI Agent Autonomy - Anthropic Research](https://www.anthropic.com/research/measuring-agent-autonomy)

### Durable Execution & Long-Running Workflows
- [Durable Execution Meets AI - Temporal](https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai)
- [Building Dynamic AI Agents with Temporal](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal)
- [Durable Multi-Agentic AI Architecture with Temporal](https://temporal.io/blog/using-multi-agent-architectures-with-temporal)
- [Basic Agentic Loop with Claude and Temporal](https://docs.temporal.io/ai-cookbook/agentic-loop-tool-call-claude-python)

### Cost & Multi-Model
- [LLM API Pricing 2026 Comparison](https://claude5.ai/news/llm-api-pricing-comparison-2025-complete-guide)
- [LangGraph vs CrewAI vs OpenAI Agents SDK 2026](https://particula.tech/blog/langgraph-vs-crewai-vs-openai-agents-sdk-2026)
- [Agent Frameworks Compared 2026](https://www.aitoolskit.io/agents/agent-frameworks-compared)
- [AWS Bedrock AgentCore and Claude](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-and-claude-transforming-business-with-agentic-ai/)
- [Claude on Bedrock vs Claude API Direct](https://www.braincuber.com/blog/claude-on-bedrock-vs-claude-api-direct-whats-different)

---

## Executive Summary: What to Build

**For a startup building a workforce automation platform in 2026:**

1. **Agent runtime:** Custom agent loops calling Claude API directly (via Claude Agent SDK or raw Messages API). Each agent has a focused system prompt and 5-8 tools. This is option (d).

2. **Orchestration:** LangGraph for workflow state machines with conditional routing and human approval gates. For workflows that span hours/days, wrap LangGraph in Temporal for durable execution.

3. **Frontend:** Vercel AI SDK v6 for the Next.js web layer -- streaming agent responses, tool approval UIs, real-time status updates.

4. **Multi-model:** Route by task type and cost. Claude Sonnet for most agent work. Gemini Flash for high-volume cheap tasks. Multi-model consensus for high-stakes decisions only.

5. **Multi-tenant:** Tenant configuration drives which integrations (MCP servers) are available to each agent. Tools are resolved at runtime. Credentials stored in a vault.

6. **Do not use:** CrewAI (prototype-tier), Bedrock Agents (latency + lock-in), OpenAI Agents SDK (vendor lock-in, less mature).

7. **Start with:** One agent (BA Agent) doing the meeting-to-PRD pipeline. Get it production-solid. Then add agents incrementally.
