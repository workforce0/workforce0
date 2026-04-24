# Security Policy

## Supported Versions

We support the latest minor release on the `main` branch. Security fixes are backported to the previous minor release for 90 days after a new release.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Instead, [open a private security advisory on GitHub](https://github.com/workforce0/workforce0/security/advisories/new) with:

- A description of the issue
- Steps to reproduce
- The affected version / commit SHA
- Any proof-of-concept code (optional but helpful)

We will:

1. Acknowledge receipt within **48 hours**.
2. Confirm the issue and assess severity within **5 business days**.
3. Prepare a fix and coordinate a disclosure timeline with you.
4. Credit you in the release notes (unless you prefer to stay anonymous).

## Scope

In scope:
- The Workforce0 backend (`mvp/`)
- The Workforce0 frontend (`frontend/`)
- The local agent daemon (`agent/`)
- Docker images and deployment templates

Out of scope:
- Vulnerabilities in third-party dependencies (please report upstream)
- Social engineering of maintainers
- Denial-of-service attacks against self-hosted instances
- Issues requiring physical access to a user's machine

## Self-hosting responsibility

Because Workforce0 is self-hosted, the operator is responsible for:

- Running a reverse proxy with HTTPS (Caddy, Traefik, Cloudflare Tunnel)
- Keeping Docker, the host OS, and dependencies patched
- Rotating AI provider keys periodically
- Restricting network access to the admin UI

See [`docs/self-hosting.md`](./docs/self-hosting.md) for a hardening checklist.
