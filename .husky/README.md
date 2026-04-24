# .husky/

Git hooks for Workforce0, managed by [Husky](https://typicode.github.io/husky/).

## What lives here

- `pre-commit` — runs `npx lint-staged` before every commit (see `../.lintstagedrc.json`)

## Bootstrap (one-time, first-time setup)

Workforce0 doesn't have a root `package.json` yet. When one is added (tracked as a Wave 2 task), run:

```bash
# at repo root
npm init -y
npm install --save-dev husky@^9 lint-staged@^15
npx husky init
```

Then add to the new root `package.json`:

```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

`npm install` at the repo root will auto-run `prepare`, which:
1. Creates `.husky/_/` with husky runtime shims
2. Marks `.husky/pre-commit` executable
3. Installs the git hook path (`git config core.hooksPath .husky/_`)

## How the hook works

On `git commit`, the pre-commit hook runs `npx lint-staged`, which:
1. Reads globs from `.lintstagedrc.json`
2. Runs `eslint --fix` on staged TS/JS files in each workspace
3. Runs `prettier --write` on staged config/doc files
4. Re-stages auto-fixed files
5. Blocks the commit if any linter exits non-zero

## Skipping the hook (rare, discouraged)

```bash
git commit --no-verify -m "..."
```

Don't do this in PRs — CI will fail what the hook would have caught.

## Troubleshooting

- **Hook not running** — you skipped `npm install` at repo root, or husky's `prepare` script didn't run. Re-run `npx husky init`.
- **`lint-staged: command not found`** — dev deps not installed. `npm install` at root.
- **ESLint errors on unchanged code** — stash, rebase onto `main`, and try again.
