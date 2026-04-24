import type { FoundationSkill } from '../../types.js';

export const CODING_STANDARDS: FoundationSkill = {
  name: 'coding-standards',
  version: '1.0.0',
  target: 'all',
  content: `### Coding Standards
- Prefer immutability: use const by default, readonly on interface properties, and avoid in-place mutation of shared state
- Keep files under 800 lines; split by single-responsibility when a file grows beyond that threshold
- Functions must do one thing and stay under 50 lines; extract helpers rather than adding conditional complexity
- Limit nesting depth to three levels maximum — flatten with early returns, guard clauses, and extracted functions
- Every error path must be explicitly handled; never silently swallow exceptions or return undefined where a typed result is expected
- Validate inputs at every public function boundary; do not assume callers have already validated
- Use TypeScript strict mode; avoid any casts and non-null assertions except where absolutely required with a justifying comment
- Name variables and functions for what they represent or do, not how they work (e.g., getUserById not fetchFromDb)
- Write self-documenting code first; add comments only to explain why, not what
- Maintain consistent import ordering: external packages first, then internal absolute paths, then relative paths`,
};
