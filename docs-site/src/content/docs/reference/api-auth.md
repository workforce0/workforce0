---
title: Authentication
description: How to authenticate to the Workforce0 REST API.
---

## Two modes

1. **Cookie auth (web UI).** Login route sets a httpOnly, SameSite=Lax
   JWT cookie. Subsequent requests include it automatically.
2. **Bearer token (programmatic).** For scripts / CI / agents. The
   cookie is always preferred when both are present.

## Login

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "you@example.com", "password": "..." }

→ 200 OK
Set-Cookie: wf0_session=<jwt>; HttpOnly; SameSite=Lax
```

Response body has a `{ token }` field too — store it in
`localStorage` as a fallback for environments that strip cookies.

## Every authenticated request

```http
GET /api/projects
Cookie: wf0_session=<jwt>
X-Project-Id: <active-project-id>
```

Or, for programmatic access:

```http
GET /api/projects
Authorization: Bearer <jwt>
X-Project-Id: <optional>
```

## Project scoping

Every list endpoint respects `X-Project-Id` when present. Omit it
for "all projects in tenant" (subject to auth grants).

## Tokens

- **Access token (JWT)** — 24h expiry. Refresh by re-logging-in
  (short term) or through the refresh-token flow (roadmap).
- **Agent token** — long-lived (no expiry by default). Scoped to a
  single tenant, can claim tickets for specific roles. Issued via
  **Settings → Agents → Create token**.

## Error codes

- `401 Unauthorized` — missing / invalid / expired JWT. Redirect to
  `/login`.
- `403 Forbidden` — authenticated but lacking permission for this
  resource.

## CSRF

SameSite=Lax on the cookie + checking `Origin` for unsafe methods.
Every state-changing endpoint requires a same-origin request or an
Authorization header.

## Rate limits

- Auth endpoints: `RATE_LIMIT_AUTH_PER_MIN` (default 20) per IP.
- General endpoints: 120 rpm per authenticated user.

Exceeding returns `429 Too Many Requests` with `Retry-After`.

## Rotating JWT_SECRET

Rotating invalidates all existing tokens. Every user is logged out.

Schedule quarterly or on compromise.
