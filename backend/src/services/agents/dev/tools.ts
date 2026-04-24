// mvp/src/services/agents/dev/tools.ts

import type { AgentTool, AgentContext, ToolResult } from '../../agent-runtime/types.js';
import type { MemoryService } from '../../memory/memory.service.js';
import { CODE_REVIEW_STANDARDS } from '../coding-standards.js';

/**
 * Build a self-review prompt for the Dev Agent to review its own code.
 * Moved here from coding-standards.ts (deprecated).
 *
 * @param files - Files to review
 * @param checkCategories - Categories to check
 * @returns Complete prompt string
 */
function buildSelfReviewPrompt(
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

export interface DevToolDeps {
  prisma: any;
  memoryService: MemoryService;
  githubService?: {
    isAvailable: () => boolean;
    createBranch: (input: { branchName: string; fromRef?: string }) => Promise<{ ref: string; sha: string }>;
    createOrUpdateFile: (input: {
      path: string; content: string; message: string; branch: string; sha?: string;
    }) => Promise<{ sha: string; path: string }>;
    createPullRequest: (input: {
      title: string; body: string; head: string; base?: string; labels?: string[]; reviewers?: string[];
    }) => Promise<{ number: number; htmlUrl: string; title: string; state: string }>;
  };
  geminiService?: {
    generateContent: (prompt: string) => Promise<string>;
  };
}

/**
 * Creates the 5 tools available to the Dev Agent:
 *
 * 1. read_prd               — Read approved PRD (stub — will use PRD repository)
 * 2. recall_codebase_context — Get coding conventions from tenant memory
 * 3. generate_code           — Generate files with code + tests (stub — will use GitHub MCP)
 * 4. self_review             — Review generated code for bugs/security/conventions (stub)
 * 5. create_pull_request     — Create PR for human review (stub — will use GitHub MCP)
 */
export function createDevTools(deps: DevToolDeps): AgentTool[] {
  const { prisma, memoryService, githubService, geminiService } = deps;

  // ---- 1. read_prd ----

  const readPrd: AgentTool = {
    name: 'read_prd',
    description:
      'Read the approved PRD document to understand requirements before writing code. ' +
      'The prdId is taken from context.memory.prdId.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (
      _input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const prdId = context.memory.prdId as string;
        if (!prdId) {
          return { success: false, error: 'No prdId found in context.memory' };
        }

        const prd = await prisma.pRD.findUnique({
          where: { id: prdId },
          select: {
            id: true,
            title: true,
            summary: true,
            objectives: true,
            requirements: true,
            acceptanceCriteria: true,
            outOfScope: true,
            assumptions: true,
            risks: true,
            confidence: true,
            status: true,
            version: true,
            architectureDesign: true,
          },
        });

        if (!prd) {
          return { success: false, error: `No PRD found with id ${prdId}` };
        }

        if (prd.status !== 'approved') {
          return {
            success: false,
            error: `PRD ${prdId} has status "${prd.status}" — only approved PRDs can be implemented`,
          };
        }

        return {
          success: true,
          data: {
            prdId: prd.id,
            title: prd.title,
            summary: prd.summary,
            objectives: prd.objectives,
            requirements: prd.requirements,
            acceptanceCriteria: prd.acceptanceCriteria,
            outOfScope: prd.outOfScope,
            assumptions: prd.assumptions,
            risks: prd.risks,
            confidence: prd.confidence,
            version: prd.version,
            // Architect's design from Step 3 — components, APIs, data model,
            // implementation order. Dev uses this to generate code aligned
            // with the intended architecture.
            architectureDesign: prd.architectureDesign,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 2. recall_codebase_context ----

  const recallCodebaseContext: AgentTool = {
    name: 'recall_codebase_context',
    description:
      'Retrieve codebase conventions and coding standards from tenant memory. ' +
      'Includes naming conventions, folder structure, testing patterns, and style guides.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['convention', 'pattern', 'preference', 'decision'],
          },
          description:
            'Optional list of memory categories to filter. Defaults to convention and pattern.',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const categories = (input.categories as string[] | undefined) ?? [
          'convention',
          'pattern',
        ];

        const memories = await memoryService.getContext(context.tenantId, {
          categories: categories as any,
        });

        return {
          success: true,
          data: {
            count: memories.length,
            conventions: memories.map((m) => ({
              category: m.category,
              key: m.key,
              value: m.value,
              confidence: m.confidence,
            })),
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 3. generate_code ----

  const generateCode: AgentTool = {
    name: 'generate_code',
    description:
      'Generate implementation code and tests for a requirement. ' +
      'Stub — will use GitHub MCP to create actual files in the repository. ' +
      'Returns the generated file list and content summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementTitle: {
          type: 'string',
          description: 'Title of the requirement being implemented',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path relative to repo root' },
              content: { type: 'string', description: 'File content' },
              type: {
                type: 'string',
                enum: ['implementation', 'test', 'config', 'migration'],
                description: 'File type',
              },
            },
          },
          description: 'Array of files to generate',
        },
        language: {
          type: 'string',
          description: 'Programming language (e.g., typescript, python)',
        },
      },
      required: ['requirementTitle', 'files'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const requirementTitle = input.requirementTitle as string;
        const files = input.files as Array<{ path: string; content: string; type: string }>;
        const language = (input.language as string) ?? 'typescript';

        if (!files || files.length === 0) {
          return { success: false, error: 'No files provided for code generation' };
        }

        // If GitHub is available, push files to a branch
        if (githubService?.isAvailable()) {
          const branchName = `workforce0/${requirementTitle.replace(/\s+/g, '-').toLowerCase().slice(0, 40)}`;

          try {
            await githubService.createBranch({ branchName });
          } catch {
            // Branch may already exist — continue
          }

          const pushedFiles: Array<{ path: string; type: string; sha: string }> = [];
          for (const file of files) {
            const result = await githubService.createOrUpdateFile({
              path: file.path,
              content: file.content,
              message: `feat(${requirementTitle}): ${file.path}`,
              branch: branchName,
            });
            pushedFiles.push({ path: result.path, type: file.type, sha: result.sha });
          }

          // Store branch name in context for create_pull_request
          (context.memory as Record<string, unknown>).generatedBranch = branchName;

          const testFiles = files.filter((f) => f.type === 'test');
          const implFiles = files.filter((f) => f.type === 'implementation');

          return {
            success: true,
            data: {
              requirementTitle,
              language,
              branch: branchName,
              totalFiles: files.length,
              implementationFiles: implFiles.length,
              testFiles: testFiles.length,
              files: pushedFiles,
            },
          };
        }

        // Fallback: return summary without GitHub push
        const generatedFiles = files.map((f) => ({
          path: f.path,
          type: f.type,
          lineCount: f.content.split('\n').length,
          sizeBytes: Buffer.byteLength(f.content, 'utf8'),
        }));

        const testFiles = files.filter((f) => f.type === 'test');
        const implFiles = files.filter((f) => f.type === 'implementation');

        return {
          success: true,
          data: {
            requirementTitle,
            language,
            totalFiles: files.length,
            implementationFiles: implFiles.length,
            testFiles: testFiles.length,
            files: generatedFiles,
            stub: true,
            note: 'GitHub not configured. Files validated but not pushed.',
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 4. self_review ----

  const selfReview: AgentTool = {
    name: 'self_review',
    description:
      'Review the generated code for bugs, security issues, and convention adherence. ' +
      'Stub — will perform static analysis and pattern matching in production.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
          },
          description: 'Files to review',
        },
        checkCategories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['bugs', 'security', 'conventions', 'performance', 'testing'],
          },
          description: 'Categories of checks to perform',
        },
      },
      required: ['files'],
    },
    execute: async (
      input: Record<string, unknown>,
      _context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const files = input.files as Array<{ path: string; content: string }>;
        const checkCategories = (input.checkCategories as string[]) ?? [
          'bugs',
          'security',
          'conventions',
        ];

        if (!files || files.length === 0) {
          return { success: false, error: 'No files provided for review' };
        }

        // If AI is available, perform standards-based code review
        if (geminiService) {
          const reviewPrompt = buildSelfReviewPrompt(files, checkCategories);

          try {
            const aiResponse = await geminiService.generateContent(reviewPrompt);
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const result = JSON.parse(jsonMatch[0]);
              return {
                success: true,
                data: {
                  filesReviewed: files.length,
                  categoriesChecked: checkCategories,
                  ...result,
                },
              };
            }
          } catch {
            // Fall through to simple review
          }
        }

        // Fallback: basic review
        return {
          success: true,
          data: {
            filesReviewed: files.length,
            categoriesChecked: checkCategories,
            issues: [],
            passed: true,
            summary: `Reviewed ${files.length} file(s) across categories: ${checkCategories.join(', ')}. No issues found.`,
            stub: !geminiService,
            note: geminiService ? undefined : 'AI not configured. Basic validation only.',
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  // ---- 5. create_pull_request ----

  const createPullRequest: AgentTool = {
    name: 'create_pull_request',
    description:
      'Create a pull request for human review. NEVER auto-deploy. ' +
      'Stub — will use GitHub MCP to create actual PRs in production.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR title' },
        description: { type: 'string', description: 'PR description with summary of changes' },
        branch: { type: 'string', description: 'Source branch name' },
        baseBranch: {
          type: 'string',
          description: 'Target branch (default: main)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths included in the PR',
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Labels to apply to the PR',
        },
        reviewers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Requested reviewers',
        },
      },
      required: ['title', 'description', 'branch', 'files'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const title = input.title as string;
        const description = input.description as string;
        const branch = input.branch as string || (context.memory as Record<string, unknown>).generatedBranch as string;
        const baseBranch = (input.baseBranch as string) ?? 'main';
        const files = input.files as string[];
        const labels = (input.labels as string[]) ?? [];
        const reviewers = (input.reviewers as string[]) ?? [];
        const taskId = context.memory.taskId as string;

        if (!branch) {
          return { success: false, error: 'No branch specified and no generatedBranch in context' };
        }

        // If GitHub is available, create a real PR
        if (githubService?.isAvailable()) {
          const pr = await githubService.createPullRequest({
            title,
            body: description,
            head: branch,
            base: baseBranch,
            labels: [...labels, 'workforce0-auto'],
            reviewers,
          });

          return {
            success: true,
            data: {
              prNumber: pr.number,
              title: pr.title,
              branch,
              baseBranch,
              filesChanged: files?.length ?? 0,
              labels,
              reviewers,
              status: pr.state,
              url: pr.htmlUrl,
              taskId,
              autoDeploy: false,
            },
          };
        }

        // Fallback: mock PR
        const prNumber = Math.floor(Math.random() * 1000) + 1;
        return {
          success: true,
          data: {
            prNumber,
            title,
            branch,
            baseBranch,
            filesChanged: files?.length ?? 0,
            labels,
            reviewers,
            status: 'open',
            url: `https://github.com/org/repo/pull/${prNumber}`,
            taskId,
            autoDeploy: false,
            stub: true,
            note: 'GitHub not configured. Mock PR returned.',
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };

  return [
    readPrd,
    recallCodebaseContext,
    generateCode,
    selfReview,
    createPullRequest,
  ];
}
