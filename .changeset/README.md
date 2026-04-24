# Changesets

## What are changesets?

Changesets are small markdown files that describe a change you've made to the codebase. Each changeset lives in the `.changeset/` directory and captures a version bump type (major/minor/patch) plus a human-readable summary. When a release is cut, all pending changesets get rolled up into `CHANGELOG.md` entries and drive `package.json` version bumps automatically — so contributors never have to hand-edit changelogs or version numbers.

## How to add one

From the repo root:

```bash
npx changeset
```

You'll be prompted to:
1. **Pick affected packages** (use space to select, enter to confirm)
2. **Pick the bump type** — `patch` (bug fix), `minor` (new feature, backwards-compatible), or `major` (breaking change)
3. **Write a short summary** describing what changed and why it matters to users

This creates a file like `.changeset/quiet-lions-dance.md`. Commit it along with your PR.

## Example changeset file

```markdown
---
"@workforce0/mvp": minor
---

Add self-service Jira integration wizard with visual "Get API Key" flow and inline connection testing — executives can now connect Jira in under 60 seconds without touching a config file.
```

The frontmatter lists the package(s) and bump type. The body becomes the changelog entry.

## When to skip a changeset

You can skip `npx changeset` for changes that don't affect published behavior:

- Internal refactors with no user-visible effect
- Documentation-only changes (README, comments, docs/)
- Test-only changes (adding, fixing, or reorganizing tests)
- CI, tooling, or build-script tweaks
- Dependency bumps that don't change runtime behavior

If in doubt, add one — an extra patch entry never hurts.

## How changesets become releases

On merge to `main`, the release workflow:

1. Runs `changeset version` — consumes all pending `.changeset/*.md` files, bumps versions in `package.json`, and appends entries to `CHANGELOG.md`
2. Opens (or updates) a "Version Packages" PR with those edits
3. When that PR is merged, runs `changeset publish` to tag the release

You never run these commands locally — just drop the changeset markdown and the automation handles the rest.

## We also use release-please

Workforce0 runs [release-please](https://github.com/googleapis/release-please) in parallel, which derives releases from Conventional Commit messages. **Changesets are optional** — use whichever fits your workflow:

- Prefer **Conventional Commits**? Just write `feat:` / `fix:` / `chore:` commit messages and release-please handles it.
- Prefer **explicit changelog control**? Add a changeset via `npx changeset`.

Both paths produce valid releases. Pick one per PR; don't mix.
