/**
 * @deprecated Content migrated to services/agents/skills/foundation/.
 * Helper functions moved to dev/tools.ts and qa/tools.ts.
 * This file will be removed in a future release.
 *
 * =============================================================================
 * CODING STANDARDS — AI Agent Prompt Context
 * =============================================================================
 *
 * Shared coding standards injected into all AI-generated code prompts.
 * Used by Dev Agent (code generation, self-review) and QA Agent (review, coverage).
 *
 * These standards ensure AI-generated PRs match the quality of hand-written code.
 * Update this file when coding conventions change — all agents inherit updates.
 *
 * TODO(agent): Remove this file once processors.ts is updated to import
 * buildCodeGenerationPrompt and buildCodeReviewPrompt from their respective
 * agent tool files (dev/tools.ts and qa/tools.ts).
 *
 * @module services/agents/coding-standards
 */

// ---------------------------------------------------------------------------
// Code Generation Standards
// ---------------------------------------------------------------------------

export const CODE_GENERATION_STANDARDS = `
## CODE GENERATION STANDARDS

You are a senior software engineer generating production-grade TypeScript code
for the Workforce0 platform. Every file you produce MUST meet these standards.

### 1. Git Hygiene

- NEVER commit directly to \`main\`. Always work on a feature branch.
- Branch naming: \`workforce0/<prd-slug>-<short-id>\` (e.g. \`workforce0/user-auth-a1b2c3\`).
- Commit messages follow Conventional Commits:
  - \`feat(scope): short description\` for new features
  - \`fix(scope): short description\` for bug fixes
  - \`test(scope): short description\` for test additions
  - \`docs(scope): short description\` for documentation
  - \`refactor(scope): short description\` for refactoring
- One logical change per commit. Do NOT bundle unrelated changes.
- Keep commits small and atomic — reviewable in under 5 minutes.
- Never force-push to shared branches.

### 2. Documentation & Comments

- Every exported function/class/type MUST have a JSDoc comment:
  \`\`\`typescript
  /**
   * Brief one-line summary of what this does.
   *
   * @param paramName - What this parameter controls
   * @returns What the function returns and when
   * @throws {ErrorType} When and why this throws
   *
   * @example
   * \`\`\`typescript
   * const result = await myFunction('input');
   * \`\`\`
   */
  \`\`\`
- Internal/private functions: a single-line \`// Why this exists\` comment is sufficient.
- Comment the WHY, not the WHAT. The code shows what; comments explain intent.
- Add \`// TODO(agent): <description>\` for known limitations or future work.
  Every TODO must have a description — never leave bare TODOs.
- Add a file-level header comment for every new file:
  \`\`\`typescript
  /**
   * Brief description of the file's purpose.
   * @module path/to/module
   */
  \`\`\`
- Update existing comments when modifying code. Stale comments are worse than none.

### 3. Code Style & Naming

- TypeScript strict mode. No \`any\` unless absolutely unavoidable (document why).
- Naming conventions:
  - \`camelCase\` for variables, functions, methods
  - \`PascalCase\` for classes, interfaces, types, enums
  - \`SCREAMING_SNAKE_CASE\` for constants
  - \`kebab-case\` for file names (e.g. \`user-auth.service.ts\`)
- Prefer \`const\` over \`let\`. Never use \`var\`.
- Use early returns to reduce nesting. Max 3 levels of indentation.
- Prefer descriptive names over abbreviations:
  - YES: \`meetingTranscript\`, \`clarificationRequest\`, \`engagementPhase\`
  - NO: \`mt\`, \`cr\`, \`ep\`
- One class/interface per file unless tightly coupled.
- Imports order: node builtins → external packages → internal modules → types.

### 4. Error Handling

- NEVER swallow errors silently. At minimum, log them.
- Use typed errors — extend \`AppError\` from \`lib/error-handler.ts\`.
- Async functions: use try/catch. Do NOT use \`.catch()\` chains.
- Validate all external input at system boundaries (API routes, webhooks).
- Internal function calls: trust the types, don't re-validate.
- Include context in error messages:
  - YES: \`\`Failed to create PR for PRD \${prdId}: \${error.message}\`\`
  - NO: \`"Something went wrong"\`

### 5. Unit Tests

- EVERY new function/method MUST have corresponding test(s).
- Test file naming: \`<module>.test.ts\` in a \`__tests__/\` directory adjacent to source.
- Use \`vitest\` with \`describe\` / \`it\` blocks.
- Test structure follows AAA (Arrange, Act, Assert):
  \`\`\`typescript
  describe('FunctionName', () => {
    it('should do X when given Y', () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toEqual(expected);
    });
  });
  \`\`\`
- Required test cases for every function:
  1. **Happy path** — normal expected input
  2. **Edge cases** — empty arrays, null/undefined, boundary values
  3. **Error cases** — invalid input, service failures, timeouts
- Mock external services (GitHub, Gemini, Jira) — never call real APIs in tests.
- Use descriptive test names: \`should return 404 when PRD not found\` not \`test 1\`.
- Minimum 80% code coverage for new code.

### 6. Architecture Patterns

- Follow the existing repository pattern: Repository → Service → Route.
- Services take dependencies via constructor injection (never import singletons).
- Use the queue system (BullMQ) for anything that takes > 1 second.
- Never block the event loop — all I/O must be async.
- Database queries:
  - Use Prisma's typed client — no raw SQL unless performance-critical.
  - Always scope queries by \`tenantId\` (multi-tenancy).
  - Use \`select\` to fetch only needed columns.
- File structure:
  \`\`\`
  src/
    services/<domain>/
      <domain>.service.ts      # Business logic
      <domain>.types.ts        # Types and interfaces
      __tests__/
        <domain>.test.ts       # Unit tests
  \`\`\`

### 7. Security

- NEVER log secrets, tokens, passwords, or API keys.
- NEVER hardcode credentials — use environment variables via \`config/index.ts\`.
- Sanitize all user input before passing to AI prompts (prompt injection prevention).
- Use parameterized queries (Prisma handles this).
- Validate webhook signatures before processing.
- NEVER auto-deploy or auto-merge. All PRs require human review.

### 8. Performance

- Prefer batch operations over loops with individual DB calls.
- Use \`Promise.all()\` for independent async operations.
- Add database indexes for frequently queried columns.
- Keep AI prompts focused and concise — token cost matters.
- Stream large responses instead of buffering in memory.
`.trim();

// ---------------------------------------------------------------------------
// Code Review Standards
// ---------------------------------------------------------------------------

export const CODE_REVIEW_STANDARDS = `
## CODE REVIEW STANDARDS

You are a senior QA engineer reviewing code against production standards.
Be thorough but pragmatic. Focus on issues that matter in production.

### Review Checklist

**Critical (must fix before merge):**
- [ ] Security vulnerabilities (injection, exposed secrets, missing auth)
- [ ] Data integrity issues (missing tenant scoping, race conditions)
- [ ] Missing error handling on external calls
- [ ] Breaking API changes without versioning

**Major (should fix before merge):**
- [ ] Missing unit tests for new functions
- [ ] Missing or incorrect JSDoc on exported symbols
- [ ] \`any\` types without documented justification
- [ ] Bare TODOs without descriptions
- [ ] Console.log instead of structured logger
- [ ] Synchronous I/O or event loop blocking
- [ ] Missing input validation at API boundaries

**Minor (nice to fix, not blocking):**
- [ ] Naming convention violations
- [ ] Unused imports or variables
- [ ] Overly complex expressions that could be simplified
- [ ] Missing early returns increasing nesting depth
- [ ] Inconsistent formatting

### Review Output Format

For each issue found, report:
- **File**: path/to/file.ts
- **Line**: approximate line number
- **Severity**: critical | major | minor
- **Category**: security | testing | documentation | style | performance | bug
- **Message**: Clear description of the issue
- **Suggestion**: How to fix it (be specific)

### What NOT to Flag

- Style preferences that don't affect correctness
- Existing code not touched in this PR
- Theoretical concerns without concrete risk
- Performance optimizations without measured bottleneck
`.trim();

// ---------------------------------------------------------------------------
// Coverage Analysis Standards
// ---------------------------------------------------------------------------

export const COVERAGE_ANALYSIS_STANDARDS = `
## TEST COVERAGE ANALYSIS STANDARDS

Analyze test coverage by cross-referencing PRD requirements against test files.

### Coverage Criteria

For each PRD requirement, check:
1. Is there at least one test that exercises the happy path?
2. Are edge cases covered (empty input, boundary values, null)?
3. Are error paths tested (service failures, invalid input)?
4. Are integration points mocked correctly?

### Coverage Rating

- **100%**: Happy path + edge cases + error paths + integration mocks
- **80%**: Happy path + some edge cases + basic error handling
- **50%**: Happy path only
- **0%**: No tests found for this requirement

### Output Format

Return JSON with:
- \`overallCoverage\`: weighted average (0-100)
- \`meetsThreshold\`: boolean (true if >= threshold)
- \`requirementCoverage\`: array of per-requirement analysis
  - \`requirement\`: requirement title
  - \`coveragePercent\`: 0-100
  - \`testFiles\`: list of test files that cover this
  - \`missingTests\`: specific test cases that should be added
`.trim();

// ---------------------------------------------------------------------------
// Helper to build full prompts
// ---------------------------------------------------------------------------

/**
 * Build a code generation prompt with standards baked in.
 *
 * @param prdTitle - PRD title
 * @param prdSummary - PRD summary
 * @param requirements - Structured requirements
 * @param acceptanceCriteria - Acceptance criteria list
 * @param conventions - Optional tenant-specific conventions from memory
 * @returns Complete prompt string for the AI model
 */
export function buildCodeGenerationPrompt(
  prdTitle: string,
  prdSummary: string,
  requirements: unknown,
  acceptanceCriteria: unknown,
  conventions?: Array<{ key: string; value: string }>,
): string {
  const parts = [
    CODE_GENERATION_STANDARDS,
    '',
    '---',
    '',
    '## TASK: Implement the Following PRD',
    '',
    `**Title:** ${prdTitle}`,
    `**Summary:** ${prdSummary}`,
    '',
    '**Requirements:**',
    JSON.stringify(requirements, null, 2),
    '',
    '**Acceptance Criteria:**',
    JSON.stringify(acceptanceCriteria, null, 2),
  ];

  if (conventions && conventions.length > 0) {
    parts.push(
      '',
      '**Project-Specific Conventions (from team memory):**',
      ...conventions.map(c => `- ${c.key}: ${c.value}`),
    );
  }

  parts.push(
    '',
    '---',
    '',
    '## OUTPUT FORMAT',
    '',
    'Return a JSON array of files to create:',
    '```json',
    '[',
    '  {',
    '    "path": "src/services/feature/feature.service.ts",',
    '    "content": "// full file content here...",',
    '    "type": "implementation"',
    '  },',
    '  {',
    '    "path": "src/services/feature/__tests__/feature.test.ts",',
    '    "content": "// full test file content here...",',
    '    "type": "test"',
    '  }',
    ']',
    '```',
    '',
    'IMPORTANT:',
    '- Include BOTH implementation AND test files.',
    '- Every implementation file must have a corresponding test file.',
    '- Follow the file structure pattern: source in `src/services/<domain>/`, tests in `__tests__/`.',
    '- Include complete, runnable code — not pseudocode or snippets.',
    '- Add JSDoc to all exported symbols.',
    '- Add TODO comments for any known limitations.',
  );

  return parts.join('\n');
}

/**
 * Build a code review prompt with standards baked in.
 *
 * @param prdTitle - PRD title
 * @param requirements - PRD requirements
 * @param acceptanceCriteria - Acceptance criteria
 * @param changedFiles - Files changed in the PR
 * @returns Complete prompt string for the AI model
 */
export function buildCodeReviewPrompt(
  prdTitle: string,
  requirements: unknown,
  acceptanceCriteria: unknown,
  changedFiles: Array<{ filename: string; patch?: string; additions: number; deletions: number }>,
): string {
  const parts = [
    CODE_REVIEW_STANDARDS,
    '',
    '---',
    '',
    '## PR CONTEXT',
    '',
    `**PRD Title:** ${prdTitle}`,
    '',
    '**Requirements:**',
    JSON.stringify(requirements, null, 2),
    '',
    '**Acceptance Criteria:**',
    JSON.stringify(acceptanceCriteria, null, 2),
    '',
    '---',
    '',
    '## CHANGED FILES',
    '',
    ...changedFiles.map(f =>
      `### ${f.filename} (+${f.additions}/-${f.deletions})\n\`\`\`\n${f.patch || '(binary or too large)'}\n\`\`\``
    ),
    '',
    '---',
    '',
    '## OUTPUT FORMAT',
    '',
    'Return JSON:',
    '```json',
    '{',
    '  "verdict": "approved" | "changes_requested" | "blocked",',
    '  "issues": [',
    '    {',
    '      "file": "path/to/file.ts",',
    '      "line": 42,',
    '      "severity": "critical" | "major" | "minor",',
    '      "category": "security" | "testing" | "documentation" | "style" | "performance" | "bug",',
    '      "message": "Clear description of the issue",',
    '      "suggestion": "How to fix it"',
    '    }',
    '  ],',
    '  "summary": "Overall review summary in 2-3 sentences",',
    '  "testCoverage": {',
    '    "hasTests": true | false,',
    '    "missingTests": ["description of missing test case"]',
    '  },',
    '  "documentationCheck": {',
    '    "hasJSDoc": true | false,',
    '    "missingDocs": ["exported symbol without JSDoc"]',
    '  }',
    '}',
    '```',
  ];

  return parts.join('\n');
}

/**
 * Build a self-review prompt for the Dev Agent to review its own code.
 *
 * @param files - Files to review
 * @param checkCategories - Categories to check
 * @returns Complete prompt string
 */
export function buildSelfReviewPrompt(
  files: Array<{ path: string; content: string }>,
  checkCategories: string[],
): string {
  const parts = [
    CODE_REVIEW_STANDARDS,
    '',
    `Review the following code for: ${checkCategories.join(', ')}.`,
    '',
    'Apply the review checklist above. Be strict — this is self-review before submitting a PR.',
    '',
    '---',
    '',
    '## FILES TO REVIEW',
    '',
    ...files.map(f => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``),
    '',
    '---',
    '',
    '## OUTPUT FORMAT',
    '',
    'Return JSON:',
    '```json',
    '{',
    '  "issues": [',
    '    {',
    '      "file": "path/to/file.ts",',
    '      "line": 42,',
    '      "category": "security" | "testing" | "documentation" | "style" | "performance" | "bug",',
    '      "severity": "critical" | "major" | "minor",',
    '      "message": "What is wrong",',
    '      "suggestion": "How to fix it"',
    '    }',
    '  ],',
    '  "passed": true | false,',
    '  "summary": "Overall assessment in 1-2 sentences"',
    '}',
    '```',
    '',
    'Set "passed" to false if ANY critical or major issues exist.',
  ];

  return parts.join('\n');
}

/**
 * Build a coverage analysis prompt.
 *
 * @param requirements - PRD requirements
 * @param testFiles - Test files from the PR
 * @param coverageThreshold - Minimum coverage percentage
 * @returns Complete prompt string
 */
export function buildCoverageAnalysisPrompt(
  requirements: Array<{ title: string; acceptanceCriteria?: string[] }>,
  testFiles: Array<{ filename: string; patch?: string }>,
  coverageThreshold: number,
): string {
  const parts = [
    COVERAGE_ANALYSIS_STANDARDS,
    '',
    '---',
    '',
    '## REQUIREMENTS TO VERIFY',
    '',
    ...requirements.map((r, i) => {
      const criteria = r.acceptanceCriteria?.map(c => `  - ${c}`).join('\n') || '  (none specified)';
      return `### ${i + 1}. ${r.title}\n${criteria}`;
    }),
    '',
    '---',
    '',
    '## TEST FILES IN PR',
    '',
    ...testFiles.map(f => `### ${f.filename}\n\`\`\`\n${f.patch || '(no patch available)'}\n\`\`\``),
    '',
    '---',
    '',
    `**Coverage Threshold:** ${coverageThreshold}%`,
    '',
    '## OUTPUT FORMAT',
    '',
    'Return JSON:',
    '```json',
    '{',
    '  "overallCoverage": 75,',
    '  "meetsThreshold": false,',
    '  "requirementCoverage": [',
    '    {',
    '      "requirement": "User authentication",',
    '      "coveragePercent": 90,',
    '      "testFiles": ["src/__tests__/auth.test.ts"],',
    '      "missingTests": ["Should handle expired JWT tokens"]',
    '    }',
    '  ]',
    '}',
    '```',
  ];

  return parts.join('\n');
}
