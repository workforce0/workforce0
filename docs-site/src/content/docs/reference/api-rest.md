---
title: REST endpoints
description: Grouped list of HTTP endpoints. For exact schemas, see backend/src/routes.
---

## Envelope

Every response:

```json
{
  "success": true,
  "data": <T>,
  "error": { "code": "...", "message": "..." },
  "meta": { "pagination": { "nextCursor": "..." } }
}
```

`success: false` always has a populated `error`. `data` is absent on
errors.

## Projects

```
GET    /api/projects                 List all projects (tenant-scoped)
POST   /api/projects                 Create a project
GET    /api/projects/:id             Fetch one
PATCH  /api/projects/:id             Partial update
DELETE /api/projects/:id             Delete (must be empty)
```

## Meetings + transcripts

```
POST   /api/meetings                 Create a meeting (upload / paste)
POST   /api/meetings/:id/transcribe  Re-run Whisper
GET    /api/meetings                 List
GET    /api/meetings/:id             Fetch one
POST   /api/meetings/:id/transcript  Replace transcript (edit)
```

## Briefs (PRDs)

```
GET    /api/prds                     List
POST   /api/prds                     Create (manual; normally generated)
POST   /api/meetings/:id/generate-brief   Chief-of-staff drafts from meeting
GET    /api/prds/:id                  Fetch one
POST   /api/prds/:id/approve         Approve → triggers plan decomposition
POST   /api/prds/:id/redirect        Redirect with reason
POST   /api/prds/:id/pause           Pause; can resume later
POST   /api/prds/:id/regenerate      New draft, same transcript
```

## Tickets + plans

```
GET    /api/tickets                  List (paginated)
GET    /api/tickets/:id              Fetch one
POST   /api/tickets/:id/claim        Agent claim (agent-token auth)
POST   /api/tickets/:id/comment      Append a comment
POST   /api/tickets/:id/transition   Move status
GET    /api/plans/:ticketId          All plans for a ticket (inc. superseded)
POST   /api/plans/:id/replan         Manual replan with a reason
```

## Project graph

```
POST   /api/project-graph/:projectId/build              Build / refresh
GET    /api/project-graph/:projectId                    Summary
GET    /api/project-graph/:projectId/god-nodes?limit=N  Top symbols by degree
GET    /api/project-graph/:projectId/callers/:symbol    Incoming calls
GET    /api/project-graph/:projectId/path?from=X&to=Y   Shortest path
GET    /api/project-graph/:projectId/community/:symbol  Louvain cluster members
```

## Approvals + activity

```
GET    /api/approvals                 List recent approvals
GET    /api/audit                     Audit log (paginated)
GET    /api/activity                  Human-readable activity feed
```

## Library (skills + subagents + plans)

```
GET    /api/library/skills
GET    /api/library/skills/:slug
GET    /api/library/subagents
GET    /api/library/subagents/:slug
GET    /api/library/plans             Recent plans with staleness flags
GET    /api/library/plans/:ticketId   All plans for a ticket
```

## Integrations

```
GET    /api/integrations                       List connections
POST   /api/integrations/:name/connect         Connect (per-integration shape)
POST   /api/integrations/:name/disconnect
POST   /api/integrations/:name/test            Run a test call
```

## Agents

```
GET    /api/agents                    List connected agents
POST   /api/agents/tokens             Create an agent token
DELETE /api/agents/tokens/:id         Revoke a token
GET    /api/agents/jobs               Recent agent jobs
```

## Notifications

```
GET    /api/notifications             Recent notifications
POST   /api/notifications/:id/ack    Mark as read
GET    /api/notifications/subscriptions
POST   /api/notifications/subscriptions
```

## Settings + admin

```
GET    /api/settings                  Workspace settings
PATCH  /api/settings                  Partial update
GET    /api/settings/roles            Role definitions
PATCH  /api/settings/roles/:slug      Edit role prompt / budget
GET    /api/team                      Team members
POST   /api/team/invite               Invite a user
```

## Setup wizard

```
GET    /api/setup/status              Wizard state
POST   /api/setup/complete            Mark wizard done
```

## Webhooks (inbound — from external systems)

```
POST   /api/webhooks/slack            Slack interactivity + events
POST   /api/webhooks/twilio           Voice inbound
POST   /api/webhooks/github           Push events
POST   /api/webhooks/jira             Issue events
POST   /api/webhooks/google-drive     Watch channel updates
POST   /api/voice/incoming            Twilio voice (legacy path; same handler)
```

All verify signatures. Never hit directly without valid payload.

## Health

```
GET    /api/health                    Full dep health
GET    /api/health/live               Process liveness
GET    /api/health/ready              Readiness (false during migrations)
GET    /metrics                       Prometheus (gated)
```

## Pagination

Cursor-based. Responses include `meta.pagination.nextCursor` when
more results exist. Pass it as `?cursor=<value>` on the next call.

Default page size: 50. Max: 200.

## Filters

List endpoints accept common filters:

- `?projectId=…`
- `?status=…`
- `?since=<iso>`
- `?until=<iso>`
- `?actor=<email>` (audit only)

## OpenAPI

A generated OpenAPI spec lives at `backend/openapi.yaml`. Re-generate
via `npm run openapi:generate`. Import into Postman / Insomnia to get
typed clients.
