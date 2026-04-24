# Tier 3 — Fully autonomous multi-agent conversation

> Where agents not only answer when asked, but initiate conversations, negotiate work among themselves, and pull humans in only when a decision is needed. This doc captures the architecture we'd commit to, the open questions we haven't answered, and the honest risks that keep it out of tiers 1 and 2.

---

## What already landed (tiers 1 + 2)

Before discussing tier 3, it helps to name what's concrete today:

| | Where | Behaviour |
|---|---|---|
| **Tier 1 — @mention from WhatsApp / SMS** | `backend/src/services/agent-dispatcher/agent-dispatcher.service.ts` + `routes/webhooks/twilio-whatsapp.handler.ts` | Human texts `@ba status`; the BA agent answers with a read-only summary from the database. Cheap, deterministic, zero LLM calls. |
| **Tier 2 — @mention in Slack channels** | `routes/webhooks/slack-events.handler.ts` | Same dispatch in a Slack channel; bot replies in-thread. Handoff messages between agents can be posted as additional threaded messages by the Supervisor. |
| **Internal agent orchestration** | `services/agents/supervisor/`, `services/agent-runtime/subagent-spawner.ts` | BA → Architect → Dev → QA already hand off work server-side. No chat surface; no human visibility into the hand-off. |

Tier 3 is the missing piece: agents **publicly** talking, reasoning together, and driving work without a human starting every loop.

---

## The north star

```
Slack channel: #brief-q3-approvals
───────────────────────────────────────────────────────────────
10:02  BA         Meeting "Q3 planning" captured. Drafting brief.
10:02  BA         @architect — design is needed for the approval
                   workflow portion. Here's the PRD:
                   <brief-link>
10:04  Architect  Looked at it. Two risks: (1) the compliance team
                   requires dual-sign; (2) the mobile client can't
                   handle the current webhook payload. @ba, can we
                   confirm these are in scope?
10:05  BA         Compliance is in scope. @priya — is dual-sign a
                   v1 requirement, or can we ship v1 without it?
10:06  Priya      V1 without. Dual-sign in v1.1.
10:07  Architect  Got it. Updating the design. Mobile webhook is
                   a Dev agent concern — @dev please review the
                   payload shape before we ship.
10:09  Dev        Payload's fine if we gzip over 4KB. I'll add that
                   to the PR template. Ready when you are.
10:10  Supervisor Design approved, implementation queued.
                   @ba → notifying stakeholders. Done.
```

Five agents and one human. Four of the six turns are agent-to-agent. The human's involvement is a single, clear ask.

---

## Architectural sketch

### 1. `ConversationThread` — the addressable group

Today, every chat is 1:1 (DM) or an ephemeral channel response. Tier 3 needs a durable record:

```prisma
model ConversationThread {
  id            String   @id @default(cuid())
  tenantId      String
  channel       String   // "slack" | "telegram" | "teams"
  channelRef    String   // Slack channel id, Telegram chat id, …
  purpose       String   // "engagement:abc123" | "oncall" | "general"
  engagementId  String?  // when tied to a PRD/engagement
  participants  Json     // [{ kind: 'agent' | 'human', id, handle }]
  createdAt     DateTime @default(now())
  lastActivityAt DateTime?
  @@index([tenantId, purpose])
}

model ConversationTurn {
  id            String   @id @default(cuid())
  threadId      String
  speaker       String   // "agent:ba" | "agent:dev" | "human:user-xyz"
  text          String
  kind          String   // "speak" | "handoff" | "question" | "decision"
  addressedTo   String?  // optional "agent:dev" or "human:user-xyz"
  createdAt     DateTime @default(now())
  @@index([threadId, createdAt])
}
```

Every inbound and outbound message lands in `ConversationTurn`. This is the substrate the Supervisor reads to decide "what should happen next".

### 2. `ConversationOrchestrator` — the traffic controller

A new service, sibling to `ApprovalFanoutService`. Responsibilities:

1. **Listen**: subscribes to every inbound message (Slack events, Telegram updates, WhatsApp webhooks).
2. **Classify**: decides whether the message is directed at an agent, at a human, at the channel broadly, or is noise.
3. **Dispatch**: for agent-directed messages, invokes the right agent via an LLM call (not the cheap db-query shortcut tiers 1+2 use).
4. **Respond**: posts the agent's reply back via the `CommunicationRouter`.
5. **Handoff**: when an agent's output contains `@other-agent`, schedules a follow-up turn addressed to that agent — effectively a public handoff visible to everyone in the thread.

Pseudo-code:

```ts
class ConversationOrchestrator {
  async onInbound(event: InboundMessage) {
    const thread = await this.findOrCreateThread(event);
    const addressed = this.classifier.classify(event.text);
    await this.storeTurn({ thread, speaker: event.sender, ...addressed });

    if (addressed.kind === 'handoff' && addressed.target.kind === 'agent') {
      // Someone @mentioned an agent. Run it.
      const reply = await this.invokeAgent(addressed.target.handle, thread);
      await this.postTurn({ thread, speaker: `agent:${addressed.target.handle}`, text: reply });

      // If the reply itself contains a new @mention, don't recurse immediately —
      // schedule it on the queue with a small delay so humans can jump in.
      const next = this.classifier.extractHandoffs(reply);
      for (const h of next) await this.queue.addJob('conversation.turn', { threadId: thread.id, target: h });
    }
  }
}
```

### 3. Classifier — cheap before expensive

Classifying "is this directed at me?" is the highest-cost surface if done with an LLM, because every message in a busy channel goes through it. Proposed rules, in order:

1. **Regex**: `@ba`, `@dev`, `@help`, etc. → route directly to that agent (tier 1/2 behaviour).
2. **Role keywords**: "dev agent", "architect", "QA" → same as #1 but more forgiving.
3. **Reply-to-bot**: the message is a threaded reply to a prior agent turn → route to that agent.
4. **LLM fallback** (per-message budget): only invoked if #1–3 don't match AND the message looks substantive (>20 chars, not punctuation/emoji). Classifies `{target, kind, confidence}`.
5. **Default**: ignore. Reading without reacting is the correct behaviour 90% of the time.

### 4. Cost + throttle guardrails

Without guardrails, tier 3 could spend a lot of tokens fast. Proposed:

- **Per-thread rate limit**: at most 20 agent turns per 10 minutes.
- **Idle window**: after a human message, wait 60 seconds before any agent can respond, giving other humans room to chime in.
- **Budget**: per-tenant daily token cap. When hit, agents silently stop responding in channels until the next day; `@supervisor budget` reports status.
- **Silent mode**: `@ba be quiet for 1h` suppresses that agent in the thread. Human override.

### 5. Identity — how does Slack know which agent is talking?

Slack lets a bot post with custom `username` and `icon_emoji`. The Supervisor posts as `Supervisor 🧭`; Dev posts as `Dev 🛠️`; BA as `BA 📝`. This is cosmetic but makes a busy thread legible.

WhatsApp doesn't support this — every outbound message is "Workforce0". For tier-3 WhatsApp, we'd prefix replies: `[BA] brief status:\n  • …`.

Telegram supports neither per-message personas nor threads natively. A per-agent bot token per tenant is the cleanest path (e.g., `@acme_workforce0_ba_bot`) — but that's Telegram-specific plumbing we'd defer.

---

## Open questions

These are the ones we'd answer before writing code, not while writing it.

1. **Who pays?** Per-turn LLM cost on a lively Slack channel is the user's biggest bill. How do we cap without making the feature feel broken? (Current answer: per-tenant daily budget with a soft cap at 70%.)
2. **Who gets @mentioned to humans?** If the BA agent decides it needs a human decision, how does it pick WHICH human? Team-roster roles → pick by role needed? How do we avoid paging the wrong person?
3. **What does an agent "remember" across turns?** A Slack channel is a conversation with potentially weeks of context. Loading all of it into every agent invocation is expensive. Recent-N window? Summarized memory? Honcho?
4. **Cross-thread learning.** Should the BA agent in channel A remember a decision made in channel B? (Probably yes — that's what makes agents feel smart. But privacy: the two channels might belong to different teams.)
5. **Opt-in vs opt-out.** Does creating a `#workforce0-thread-*` channel auto-enable tier 3, or does the workspace owner have to flip a switch per thread?
6. **Silencing and overrides.** `@ba stop` should work. `@supervisor reset thread` should too. What's the abuse surface if a malicious user silences real alerts?
7. **Audit trail.** Every agent turn already goes through `TrajectoryService` for evals. Tier 3 surfaces them publicly — is the audit log the same table, or separate?

---

## Honest risks

Why this isn't in tiers 1+2:

### R1 — Runaway loops
Two agents can @mention each other in a tight loop ("@architect what about X" → "@ba clarify X" → "@architect what about X again"). Without rate limits this bills $100s per hour. Mitigation: classifier MUST drop responses where the speaker is another agent and the previous two turns were also agent-only.

### R2 — Talkativeness makes the channel unusable
If three agents respond to every human message, humans stop reading the channel. The default must be *silent unless addressed*. This is counter to the "agents feel alive" vision but necessary.

### R3 — Context management is an open problem
No one has a great answer for "how does an agent keep track of a multi-week conversation". The BA can summarise, but summaries lose nuance — and the nuance is usually what executives care about.

### R4 — Identity + impersonation
If an agent posts "the CFO approved X" and the CFO didn't, that's a governance incident. Agents must never claim human approval they don't have verified via `ApprovalFanoutService.applyReplyAction`.

### R5 — Trust
Non-technical execs have to trust that the agent won't file bad tickets, ping the wrong people, or leak data across tenants. Tier 3 puts the agent in the loop with zero human gate — the trust bar is higher than everything shipped so far. Any tier-3 action that touches external systems (creating tickets, opening PRs, sending emails) must still pass the human-approval gate that tier 2 has.

---

## What we'd build, in order

A staged rollout that keeps shipping value:

1. **ConversationThread schema + CRUD** (~1 day). Stores the channel↔engagement mapping. No user-facing change.
2. **Slack-only tier 3 behind a feature flag** (~1 week). `WORKFORCE0_TIER3=slack` in env. Only for tenants that flip the flag. Classifier defaults strict (regex only).
3. **Budget + throttle primitives** (~3 days). Essential before opening to more users.
4. **LLM-backed classifier** (~3 days). Only on messages that slip through #1–3 of the cheap rules. Caches aggressively.
5. **Agent personas per channel** (~2 days). Slack username + emoji cosmetics; BA/Dev/QA/Architect/Supervisor each distinguishable.
6. **Handoff etiquette** (~3 days). When an agent completes work, decide whether to post a handoff note, and who to @mention.
7. **Telegram + Teams** (~1 week each). After Slack proves out.

Total first-ship: **~3 weeks of focused work** for Slack, gated.

---

## Decision we'd want from the user before any of this

> Given tier 3 costs real tokens (and can cost a lot on busy channels), is the goal:
> (a) A low-cost "read-mostly" chat surface — agents answer when asked, rarely proactively speak
> (b) A high-touch "AI team member" surface — agents actively drive conversations, delegate, push back
>
> (a) is ~1 week. (b) is ~4 weeks and needs a lot of product tuning.

Tiers 1 and 2 already deliver (a) for two channels. A decision point on whether to build (b) belongs here before committing engineering time.
