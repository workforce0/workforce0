// mvp/src/services/agents/qa/tools.ts

import type { AgentTool, AgentContext, ToolResult } from '../../agent-runtime/types.js';
import type { CommunicationRouter } from '../../communication/router.js';
import type { MemoryService } from '../../memory/memory.service.js';
import { COVERAGE_ANALYSIS_STANDARDS } from '../coding-standards.js';

/**
 * Build a coverage analysis prompt.
 * Moved here from coding-standards.ts (deprecated).
 *
 * @param requirements - PRD requirements
 * @param testFiles - Test files from the PR
 * @param coverageThreshold - Minimum coverage percentage
 * @returns Complete prompt string
 */
function buildCoverageAnalysisPrompt(
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

export interface QAToolDeps {
  prisma: any;
  commsRouter: CommunicationRouter;
  memoryService: MemoryService;
  githubService?: {
    isAvailable: () => boolean;
    getPRFiles: (owner: string | undefined, repo: string | undefined, prNumber: number) => Promise<Array<{
      filename: string; status: string; additions: number; deletions: number; patch?: string;
    }>>;
    getCheckRuns: (owner: string | undefined, repo: string | undefined, ref: string) => Promise<Array<{
      name: string; status: string; conclusion: string | null; htmlUrl: string;
    }>>;
    triggerWorkflow?: (input: { workflowId: string; ref: string; inputs?: Record<string, string> }) => Promise<void>;
  };
  geminiService?: {
    generateContent: (prompt: string) => Promise<string>;
  };
}

/**
 * Creates the 5 tools available to the QA Agent:
 *
 * 1. read_requirements   — Read PRD to validate against
 * 2. read_code_changes   — Read code from PR (stub — will use GitHub MCP)
 * 3. run_test_suite      — Execute tests (stub)
 * 4. check_coverage      — Verify test coverage (stub)
 * 5. report_issues       — Report issues back to Dev Agent or human
 */
export function createQATools(deps: QAToolDeps): AgentTool[] {
  const { prisma, commsRouter, memoryService, githubService, geminiService } = deps;

  // ---- 1. read_requirements ----

  const readRequirements: AgentTool = {
    name: 'read_requirements',
    description:
      'Read the approved PRD to understand the requirements that the code must satisfy. ' +
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
          },
        });

        if (!prd) {
          return { success: false, error: `No PRD found with id ${prdId}` };
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
            status: prd.status,
            version: prd.version,
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

  // ---- 2. read_code_changes ----

  const readCodeChanges: AgentTool = {
    name: 'read_code_changes',
    description:
      'Read code changes from a pull request to review. ' +
      'Stub — will use GitHub MCP to fetch actual PR diffs in production. ' +
      'The prNumber is taken from context.memory.prNumber.',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'number',
          description: 'Pull request number (overrides context if provided)',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const prNumber = (input.prNumber as number) ?? (context.memory.prNumber as number);
        if (!prNumber) {
          return { success: false, error: 'No prNumber found in input or context.memory' };
        }

        // If GitHub is available, fetch real PR files
        if (githubService?.isAvailable()) {
          const files = await githubService.getPRFiles(undefined, undefined, prNumber);
          const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
          const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

          return {
            success: true,
            data: {
              prNumber,
              filesChanged: files,
              additions: totalAdditions,
              deletions: totalDeletions,
              changedFiles: files.length,
            },
          };
        }

        // Fallback: stub
        return {
          success: true,
          data: {
            prNumber,
            filesChanged: [],
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            stub: true,
            note: 'GitHub not configured. Cannot read PR files.',
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

  // ---- 3. run_test_suite ----

  const runTestSuite: AgentTool = {
    name: 'run_test_suite',
    description:
      'Execute the test suite to verify code correctness. ' +
      'Stub — will run actual tests via CI pipeline in production.',
    inputSchema: {
      type: 'object',
      properties: {
        testPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific test file paths to run (optional — runs all if empty)',
        },
        testRunner: {
          type: 'string',
          enum: ['vitest', 'jest', 'mocha', 'pytest'],
          description: 'Test runner to use (default: vitest)',
        },
      },
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const testPaths = (input.testPaths as string[]) ?? [];
        const testRunner = (input.testRunner as string) ?? 'vitest';

        // If GitHub is available, trigger CI workflow and poll check runs
        if (githubService?.isAvailable() && githubService.triggerWorkflow) {
          const prNumber = context.memory.prNumber as number;
          const branch = (context.memory as Record<string, unknown>).generatedBranch as string;

          if (branch) {
            try {
              await githubService.triggerWorkflow({
                workflowId: 'test.yml',
                ref: branch,
              });

              // Wait briefly then check status
              await new Promise(resolve => setTimeout(resolve, 5000));

              const checkRuns = await githubService.getCheckRuns(undefined, undefined, branch);
              const testRun = checkRuns.find(cr => cr.name.toLowerCase().includes('test'));

              return {
                success: true,
                data: {
                  testRunner: 'github-actions',
                  branch,
                  checkRuns: checkRuns.map(cr => ({
                    name: cr.name,
                    status: cr.status,
                    conclusion: cr.conclusion,
                    url: cr.htmlUrl,
                  })),
                  passed: testRun?.conclusion === 'success' || testRun?.status === 'queued',
                  note: testRun?.status === 'in_progress' || testRun?.status === 'queued'
                    ? 'CI is still running. Check back later.'
                    : undefined,
                },
              };
            } catch (err) {
              // Fall through to stub
            }
          }
        }

        return {
          success: true,
          data: {
            testRunner,
            testsRun: 0,
            testsPassed: 0,
            testsFailed: 0,
            testsSkipped: 0,
            duration: 0,
            testPaths: testPaths.length > 0 ? testPaths : ['all'],
            passed: true,
            stub: true,
            note: 'GitHub CI not configured. Manual test verification needed.',
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

  // ---- 4. check_coverage ----

  const checkCoverage: AgentTool = {
    name: 'check_coverage',
    description:
      'Verify test coverage against requirements. ' +
      'Checks that each PRD requirement has corresponding test coverage. ' +
      'Stub — will analyze actual coverage reports in production.',
    inputSchema: {
      type: 'object',
      properties: {
        requirements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              acceptanceCriteria: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          description: 'Requirements to check coverage against',
        },
        coverageThreshold: {
          type: 'number',
          description: 'Minimum coverage percentage required (default: 80)',
        },
      },
      required: ['requirements'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const requirements = input.requirements as Array<{
          title: string;
          acceptanceCriteria: string[];
        }>;
        const coverageThreshold = (input.coverageThreshold as number) ?? 80;

        if (!requirements || requirements.length === 0) {
          return { success: false, error: 'No requirements provided for coverage check' };
        }

        // If AI is available, analyze coverage by cross-referencing code and requirements
        if (geminiService && githubService?.isAvailable()) {
          const prNumber = context.memory.prNumber as number;
          if (prNumber) {
            try {
              const prFiles = await githubService.getPRFiles(undefined, undefined, prNumber);
              const testFiles = prFiles.filter(f => f.filename.includes('test') || f.filename.includes('spec'));

              const coveragePrompt = buildCoverageAnalysisPrompt(
                requirements,
                testFiles,
                coverageThreshold,
              );

              const aiResponse = await geminiService.generateContent(coveragePrompt);
              const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return {
                  success: true,
                  data: {
                    totalRequirements: requirements.length,
                    coverageThreshold,
                    ...result,
                  },
                };
              }
            } catch {
              // Fall through to basic coverage
            }
          }
        }

        // Fallback: basic coverage estimation
        const requirementCoverage = requirements.map((req) => ({
          requirement: req.title,
          criteriaCount: req.acceptanceCriteria?.length ?? 0,
          coveredCriteria: 0,
          coveragePercent: 0,
          missingTests: req.acceptanceCriteria ?? [],
        }));

        return {
          success: true,
          data: {
            totalRequirements: requirements.length,
            coverageThreshold,
            overallCoverage: 0,
            meetsThreshold: false,
            requirementCoverage,
            stub: !geminiService,
            note: geminiService ? undefined : 'AI not configured. Coverage analysis requires manual review.',
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

  // ---- 5. report_issues ----

  const reportIssues: AgentTool = {
    name: 'report_issues',
    description:
      'Report QA issues back to the Dev Agent or human reviewers. ' +
      'Includes edge cases, missing tests, potential regressions, and coverage gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Issue title' },
              description: { type: 'string', description: 'Detailed description' },
              severity: {
                type: 'string',
                enum: ['critical', 'major', 'minor', 'info'],
                description: 'Issue severity',
              },
              category: {
                type: 'string',
                enum: [
                  'missing_test',
                  'edge_case',
                  'regression',
                  'coverage_gap',
                  'bug',
                  'security',
                  'performance',
                ],
                description: 'Issue category',
              },
              file: { type: 'string', description: 'Affected file path (if applicable)' },
              suggestion: { type: 'string', description: 'Suggested fix or improvement' },
            },
          },
          description: 'List of issues found during QA',
        },
        summary: {
          type: 'string',
          description: 'Overall QA summary',
        },
        verdict: {
          type: 'string',
          enum: ['approved', 'changes_requested', 'blocked'],
          description: 'QA verdict for the PR',
        },
        routeTo: {
          type: 'string',
          enum: ['dev_agent', 'tech_lead', 'cto'],
          description: 'Who to route the report to',
        },
      },
      required: ['issues', 'summary', 'verdict'],
    },
    execute: async (
      input: Record<string, unknown>,
      context: AgentContext,
    ): Promise<ToolResult> => {
      try {
        const issues = input.issues as Array<{
          title: string;
          severity: string;
          category: string;
        }>;
        const summary = input.summary as string;
        const verdict = input.verdict as string;
        const routeTo = (input.routeTo as string) ?? 'dev_agent';
        const taskId = context.memory.taskId as string;

        const criticalCount = issues.filter((i) => i.severity === 'critical').length;
        const majorCount = issues.filter((i) => i.severity === 'major').length;
        const minorCount = issues.filter((i) => i.severity === 'minor').length;

        // Send report via communication router
        const sendResult = await commsRouter.send({
          tenantId: context.tenantId,
          engagementId: context.engagementId,
          recipientRole: routeTo,
          messageType: 'notification',
          content: `QA Report — ${verdict.toUpperCase()}\n\n${summary}\n\nIssues: ${issues.length} (${criticalCount} critical, ${majorCount} major, ${minorCount} minor)`,
          metadata: {
            taskId,
            verdict,
            issueCount: issues.length,
            issues,
          },
          urgency: criticalCount > 0 ? 'high' : majorCount > 0 ? 'medium' : 'low',
        });

        return {
          success: true,
          data: {
            verdict,
            totalIssues: issues.length,
            critical: criticalCount,
            major: majorCount,
            minor: minorCount,
            routedTo: routeTo,
            messageSent: sendResult.success,
            channel: sendResult.channel,
            taskId,
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
    readRequirements,
    readCodeChanges,
    runTestSuite,
    checkCoverage,
    reportIssues,
  ];
}
