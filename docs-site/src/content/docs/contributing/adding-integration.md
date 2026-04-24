---
title: Adding an integration
description: Recipe for wiring up a new external system (Linear, Asana, Notion, Loom, etc).
---

## Scope

An "integration" in Workforce0 is a typed connector between the
platform and an external system. It usually provides some mix of:

- **Outbound** — Workforce0 posts to the external system (Slack
  messages, Jira tickets).
- **Inbound** — External system posts to Workforce0 (Slack button
  clicks, Jira updates, GitHub pushes).

Most integrations do both.

## The recipe (outbound-only)

### 1. Define the integration

Pick a slug (e.g. `linear`). Define the required credentials (API
key, workspace URL, team id) and any optional settings (default
project mapping).

### 2. Add a schema to the Integration vault

The `IntegrationConnection` table is generic — credentials encrypt-
blob, metadata JSON. Just add a case to the runtime decoder for
your slug.

### 3. Write the connector

`backend/src/services/integrations/linear.connector.ts`:

```ts
export class LinearConnector {
  constructor(private apiKey: string, private workspaceId: string) {}

  async createIssue(title: string, description: string): Promise<string> {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Authorization': this.apiKey, … },
      body: JSON.stringify({ query: `mutation { issueCreate(…) { issue { id } } }` }),
    });
    const { data } = await res.json();
    return data.issueCreate.issue.id;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.query(`{ viewer { id name } }`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
```

### 4. Wire into the service

`backend/src/services/integrations/integration-connection.service.ts`:

```ts
async getConnector(tenantId: string, name: string) {
  if (name === 'linear') {
    const creds = await this.decrypt(tenantId, 'linear');
    return new LinearConnector(creds.apiKey, creds.workspaceId);
  }
  // …existing branches
}
```

### 5. Add HTTP routes for connect / disconnect / test

`backend/src/routes/integrations/linear.routes.ts`:

```ts
export async function linearIntegrationRoutes(fastify: FastifyInstance) {
  fastify.post('/connect', async (request, reply) => {
    const body = LinearConnectSchema.parse(request.body);
    await connectionService.connect(tenantId, 'linear', body);
    return reply.send({ success: true });
  });

  fastify.post('/test', …);
  fastify.post('/disconnect', …);
}
```

Add to the routes index.

### 6. Use it downstream

When a `dev_agent` ticket completes and you want to mirror to
Linear, call the connector from the ticket-completion hook:

```ts
const connector = await connectionService.getConnector(tenantId, 'linear');
await connector.createIssue(ticket.title, ticket.description);
```

### 7. Add the UI wizard

`frontend/src/components/integration-wizard.tsx` has a pattern for
per-integration steps. Add:

- Fields (API key, workspace id).
- "Get API key" link to the provider's docs.
- Connect button → `api.integrations.linear.connect(…)`.
- Test button → `api.integrations.linear.test()`.
- Status badge in the Integrations page.

### 8. Document it

Add `docs-site/src/content/docs/integrations/linear.md` using the
existing integration pages as a template.

Add to the sidebar in `docs-site/astro.config.mjs`.

## The recipe (inbound / webhooks)

Add:

### 1. A signature verifier

`backend/src/lib/webhook-verify.ts` — add a function for your source's
signature scheme (HMAC, shared secret, etc).

### 2. A webhook route

`backend/src/routes/webhooks/linear.routes.ts`:

```ts
fastify.post('/', async (request, reply) => {
  const verified = verifyLinearSignature(
    request.headers['x-linear-signature'],
    request.rawBody,
    linearWebhookSecret,
  );
  if (!verified) return reply.status(401).send({ error: 'bad signature' });

  const event = LinearWebhookSchema.parse(request.body);
  await handleLinearEvent(event);
  return reply.send({ ok: true });
});
```

### 3. A handler that maps events to your state

Usually you map external events to existing models (Ticket,
Meeting). The handler is the glue.

### 4. Tests

Both positive (valid signature + expected side effect) and negative
(invalid signature → 401).

## Guidelines

- **Verify signatures, always.** Never trust an inbound webhook's
  body without a signature check.
- **Use the Integration vault** for credentials. Don't read from
  env vars in services — the vault is the source of truth.
- **Return 200 even on "ignored" events.** Providers retry on
  non-2xx; ignored events shouldn't trigger retries.
- **Graceful degradation.** If the integration is disconnected,
  dependent features should log a warning and proceed, not crash.

## Testing strategy

- Unit tests — mock `fetch`; assert the connector sends the right
  request shape.
- Integration tests — use a mock server (`msw` or similar).
- Smoke test — real credentials on a staging environment.

## Idempotency

External systems may retry webhooks. Match on provider-side
delivery IDs (`X-GitHub-Delivery`, `x-linear-event-id`) and
short-circuit duplicates.

## What external systems care about

- Rate limits — respect `Retry-After`.
- User-Agent — set `Workforce0/<version>` so the provider can
  identify your traffic.
- Minimum scope — only request the OAuth scopes you use.

## Ship checklist

- [ ] Connector class with `testConnection()`.
- [ ] Connect / disconnect / test routes.
- [ ] UI wizard.
- [ ] Signature verification (if inbound).
- [ ] Unit tests + signature-failure tests.
- [ ] Docs page under `integrations/`.
- [ ] Sidebar entry in `astro.config.mjs`.
- [ ] Example `.env` keys in `.env.example`.
