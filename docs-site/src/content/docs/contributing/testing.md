---
title: Testing
description: "How we test: unit, integration, e2e, smoke. What's expected in a PR."
---

## The stack

- **Vitest** for unit + integration in backend / frontend / agent.
- **Playwright** for frontend e2e.
- **Smoke tests** in `backend/scripts/smoke-test.ts` — end-to-end
  against a deployed environment.

## What goes where

### Unit tests

Colocated under `__tests__/`. Test pure functions, class methods,
service logic with mocked dependencies.

```ts
// backend/src/services/project-graph/__tests__/py-extractor.test.ts
describe('extractFromPythonFile', () => {
  it('extracts classes and functions', () => {
    const out = extractFromPythonFile(fixture('a.py', 'class Foo: pass'));
    expect(out.nodes.some(n => n.name === 'Foo')).toBe(true);
  });
});
```

### Integration tests

Hit real Postgres + Redis via `docker-compose.test.yml`. Mock LLMs
unless testing LLM integration itself.

### E2E tests

Playwright driving the frontend with a real backend. Fixtures seed
the DB, actions flow through the full stack.

Run locally:

```bash
cd frontend
npm run e2e
```

### Smoke tests

Against a running deployment:

```bash
cd backend
WORKFORCE0_API_URL=https://your-instance npm run smoke-test
```

Seeds a fake meeting, generates a brief, fans out child tickets,
prints a PASS/FAIL report.

## Expected PR coverage

- **Business logic change** — unit test covering the change.
- **Route change** — integration test covering the route.
- **UI change** — e2e test for user-visible flows; Vitest for
  components.
- **Bug fix** — a regression test for the specific bug (even if
  it's a one-liner).
- **Docs-only change** — no tests needed.

## Running the full suite

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm test && npm run e2e

# Agent
cd agent
npm test
```

CI does all of the above on every PR.

## Writing good tests

- **Arrange-Act-Assert.** Each test has one clear action.
- **Names say what, not how.** "returns 0 when no god-nodes match" is
  better than "tests listGodNodes with empty input".
- **One assertion per behaviour.** Multiple asserts for the same
  behaviour is fine; multiple behaviours means split the test.
- **Avoid snapshots for LLM output.** Too brittle. Assert structural
  properties instead.

## Mocking LLMs

Use `vi.mock` to replace the client factory. A canonical setup:

```ts
vi.mock('../../agent-runtime/clients/client-factory.js', () => ({
  createModelClient: () => ({
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({ summary: 'x', steps: [{ title: 'y', … }] }),
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    }),
  }),
}));
```

See `backend/src/services/chief-of-staff/__tests__/planner-llm.test.ts`
for the full pattern.

## Test databases

Unit tests mock Prisma. Integration tests use a throwaway schema:

```ts
beforeAll(async () => {
  await prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS test_${randomId}`;
});

afterAll(async () => {
  await prisma.$executeRaw`DROP SCHEMA test_${randomId} CASCADE`;
});
```

Keeps tests parallel-safe.

## Deterministic randomness

Snapshot-like tests that depend on time or UUIDs should use a fake
clock (`vi.useFakeTimers`) and seed any RNG.

## What not to test

- **Provider SDKs.** Don't test that Anthropic returns a response;
  test that our code handles provider responses correctly.
- **Prisma query correctness.** Prisma is well-tested upstream.
- **Third-party webhook payload shapes.** Trust Slack / GitHub /
  Twilio; test that we handle their documented shapes.

## CI behaviour

- Tests run on every push to any branch.
- Typecheck runs alongside tests.
- A failed test blocks merge. Retries are OK for flaky tests, but
  flaky tests are bugs — file them.

## Metric harness (PG.14)

A separate mechanism for measuring planner quality over time. Not a
traditional "test" — see [Metric harness](/features/metric-harness/).
Used for prompt changes; gate PRs on `verdict: improved | flat`, not
`regressed`.
