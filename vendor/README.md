# vendor/

Upstream content vendored into this repo. Not our code. Licensed
under the upstream terms (see each subdirectory for LICENSE files).

Workforce0 reads these at boot via `LibraryService` and seeds them
into the per-tenant `SkillPackage` + `SubagentDefinition` tables.
That way air-gapped deploys need zero network at runtime.

## Contents

- **`skills/`** — `anthropics/skills` (Apache 2.0, plus some
  source-available docs skills — see `skills/README.md`). Parsed
  from `skills/skills/<slug>/SKILL.md`.
- **`subagents/`** — `VoltAgent/awesome-claude-code-subagents`.
  Parsed from `subagents/categories/<category>/<slug>.md`.

## Updating

This is a one-time vendor snapshot. To refresh:

```bash
cd vendor
rm -rf skills subagents
git clone --depth 1 https://github.com/anthropics/skills.git skills
git clone --depth 1 https://github.com/VoltAgent/awesome-claude-code-subagents.git subagents
rm -rf skills/.git subagents/.git
```

Then restart the backend — `LibraryService.seedFromVendor()` detects
new/changed files on boot and upserts them into `SkillPackage` /
`SubagentDefinition` rows. Hashes prevent unnecessary writes.
