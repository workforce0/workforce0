---
title: Skills & subagents
description: The vendored library the chief-of-staff picks from when assembling plans.
---

## The library

`vendor/skills/` and `vendor/subagents/` contain markdown-described
capabilities the chief-of-staff can reach for when assembling plans.
They're vendored — checked into the repo — so every install has the
same baseline library.

## Skills

A **skill** is a prompt-pack: a slug, a description, and a body of
instructions the specialist agent loads into its context.

Example: `code-review-standards` might describe your team's code
review conventions. When a plan attaches this skill to a `dev_agent`
step, the agent's prompt includes the skill body verbatim.

Skills are:

- **Tenant-local or global.** `tenantId: null` rows are shared globals;
  `tenantId: <id>` rows are overrides.
- **Named by slug.** Referenced in plans by slug string.
- **Versioned via git**, not the database.

## Subagents

A **subagent** is a specialised role definition — system prompt, tool
list, preferred model. When a plan step names a subagent, the
specialist agent running that step uses the subagent's prompt
instead of the role's default prompt.

Example subagents:

- `code-reviewer` — specialised for code diff review.
- `security-auditor` — looks for OWASP issues.
- `accessibility-expert` — WCAG pass on UI changes.

Useful when the same role (e.g. `dev_agent`) needs very different
behaviour across steps.

## Loading the library

On first boot, the backend seeds `SkillPackage` and
`SubagentDefinition` tables from `vendor/skills/*.md` and
`vendor/subagents/*.md`. Updates on deploy.

The `LibraryService` layer reads both tables and exposes them to the
planner via `ChiefOfStaffService.buildPlan()`.

## Library browser UI

**Library** in the sidebar shows:

- **Skills** — searchable list, detail view.
- **Subagents** — same.
- **Plans** — recent plans across the workspace, with critique
  scores and graph-staleness flags.

Everything is read-only; the source of truth is the vendored content.

## Adding a skill

1. Drop `vendor/skills/my-skill.md` with frontmatter:
   ```yaml
   ---
   slug: my-skill
   description: One-line description for the planner to read.
   requiredTools: []
   ---

   Markdown body of instructions.
   ```
2. Deploy.
3. Confirm in **Library → Skills**.

## Adding a subagent

Same pattern under `vendor/subagents/`. Additional frontmatter:

```yaml
---
slug: code-reviewer
description: …
systemPrompt: |
  You are a senior engineer reviewing a pull request.
  Focus on correctness and clarity.
allowedTools: [read_file, write_comment]
preferredModel: claude-sonnet-4-6
category: review
---
```

## Tenant overrides

Rare but supported: override a global skill per tenant. Write a row
in `SkillPackage` with the same slug and a tenantId. The LibraryService
prefers tenant rows over globals when both exist.

UI-level editing of tenant overrides isn't yet exposed. Use psql for
now.

## Planner integration

When the chief-of-staff drafts a plan, the user prompt includes:

```
## Available skills
- name-1: description 1
- name-2: description 2
- …

## Available subagents
- slug-1: description 1
- slug-2: description 2
- …
```

capped at `MAX_SKILLS_IN_PROMPT=40` and
`MAX_SUBAGENTS_IN_PROMPT=60` respectively.

When the planner outputs a step, it may set:

```json
{
  "skills": ["code-review-standards", "security-best-practices"],
  "subagentSlug": "code-reviewer"
}
```

…and the executor honours them.

## Validation

The backend cross-validates plan output against the library: any
`skills` or `subagentSlug` that don't exist in the library get
stripped and logged. The planner doesn't crash; the executor gets a
clean plan.

## Why vendor, not a runtime config

- Skills are **versioned with the code**. Rolling back a release
  rolls back the skills.
- Easy to diff. A PR that changes a skill is visible alongside the
  code change that wanted it.
- Same library everywhere. Every installer gets the baseline.

The alternative — a database-only library — makes audit and rollback
harder; we reserve that path for tenant-specific overrides.
