/**
 * =============================================================================
 * ARCHITECT SERVICE — design between brief and code
 * =============================================================================
 *
 * Step 3 of the Hermes end-to-end work. Bridges the gap between an
 * approved PRD and the Dev agent's implementation run. Takes:
 *   - Approved PRD
 *   - Any selected architecture option
 *   - Any recalled memory / prior architectural decisions for this tenant
 * and produces a structured design document containing:
 *   - Components (name, responsibility, dependencies)
 *   - APIs (endpoints + shapes) OR function signatures
 *   - Data model (tables / collections / state shape)
 *   - Risks + trade-offs
 *   - Implementation order
 * Stored on `PRD.architectureDesign` (JSONB). Dev agent reads from there.
 *
 * Non-ML-centric by design: the model call is a structured JSON output
 * prompt, parsed + validated. No council consensus here — we trust the
 * primary model since the brief already went through council.
 *
 * @module services/agent/architect
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import type { GeminiService } from '../ai/gemini.service.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'ArchitectService' });

export interface ArchitectureDesign {
  summary: string;
  components: Array<{
    name: string;
    responsibility: string;
    dependencies: string[];
  }>;
  apis: Array<{
    kind: 'http' | 'function' | 'queue' | 'webhook';
    name: string;
    description: string;
    input?: string;
    output?: string;
  }>;
  dataModel: Array<{
    name: string;
    fields: Array<{ name: string; type: string; nullable?: boolean; note?: string }>;
    notes?: string;
  }>;
  risks: Array<{ description: string; mitigation: string }>;
  implementationOrder: string[];
  generatedAt: string;
  generatedByModel: string;
}

const ARCHITECT_PROMPT_TEMPLATE = `You are a senior software architect designing the implementation for a PRODUCT BRIEF that has already been approved by the product team.

Your job: produce a concrete, implementation-ready design. Not another brief — the brief is done. Output the component breakdown, API signatures, data model, and implementation order a developer can follow.

Return STRICT JSON matching this shape (no prose outside the JSON, no code fences):

{
  "summary": "1-3 sentence architectural summary",
  "components": [
    { "name": "ComponentName", "responsibility": "one line", "dependencies": ["OtherComponent"] }
  ],
  "apis": [
    { "kind": "http"|"function"|"queue"|"webhook", "name": "POST /foo", "description": "one line", "input": "shape", "output": "shape" }
  ],
  "dataModel": [
    {
      "name": "TableName",
      "fields": [{ "name": "id", "type": "uuid", "nullable": false }],
      "notes": "optional"
    }
  ],
  "risks": [{ "description": "what could go wrong", "mitigation": "how we avoid it" }],
  "implementationOrder": ["Step 1", "Step 2", "Step 3"]
}

Brief:

{{BRIEF}}

Selected architecture option (if any):

{{SELECTED_ARCH}}
`;

export class ArchitectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gemini: GeminiService,
  ) {}

  /**
   * Design the implementation for an approved PRD. Writes the design
   * onto the PRD row and returns it. Idempotent — running twice
   * overwrites the previous design (the AI might produce a better one).
   *
   * `tenantId` is always required and matched in the WHERE clause so a
   * caller from tenant A cannot read or overwrite tenant B's PRD even
   * if they guess the id.
   */
  async designFromPrd(prdId: string, tenantId: string): Promise<ArchitectureDesign> {
    const prd = await this.prisma.pRD.findFirst({ where: { id: prdId, tenantId } });
    if (!prd) throw new Error(`PRD ${prdId} not found`);
    if (prd.status !== 'approved') {
      throw new Error(
        `PRD ${prdId} is not approved (status=${prd.status}). Architect only runs after approval.`,
      );
    }

    const brief = this.buildBriefSummary(prd);
    const selectedArch = prd.selectedArchitecture ?? 'No specific option selected.';
    const prompt = ARCHITECT_PROMPT_TEMPLATE
      .replace('{{BRIEF}}', brief)
      .replace('{{SELECTED_ARCH}}', selectedArch);

    logger.info('Generating architecture design', { prdId, tenantId });
    const modelResponse = await this.gemini.generateFreeformText(prompt);
    const design = this.parseDesign(modelResponse);

    const updated = await this.prisma.pRD.updateMany({
      where: { id: prdId, tenantId },
      data: { architectureDesign: design as any },
    });
    if (updated.count === 0) {
      throw new Error(`PRD ${prdId} not found`);
    }

    logger.info('Architecture design saved', {
      prdId,
      tenantId,
      components: design.components.length,
      apis: design.apis.length,
    });
    return design;
  }

  /** Read a previously-designed architecture for a PRD scoped to the caller's tenant. */
  async getDesign(prdId: string, tenantId: string): Promise<ArchitectureDesign | null> {
    const prd = await this.prisma.pRD.findFirst({
      where: { id: prdId, tenantId },
      select: { architectureDesign: true },
    });
    return (prd?.architectureDesign as ArchitectureDesign | null) ?? null;
  }

  private buildBriefSummary(prd: any): string {
    const parts: string[] = [
      `Title: ${prd.title}`,
      `Summary: ${prd.summary}`,
    ];
    const objectives = prd.objectives as string[] | undefined;
    if (objectives?.length) parts.push(`Objectives:\n${objectives.map((o) => `- ${o}`).join('\n')}`);
    const reqs = prd.requirements as Array<{ title?: string; description?: string }> | undefined;
    if (reqs?.length) {
      parts.push(`Requirements:\n${reqs
        .map((r) => `- ${r.title ?? ''}: ${r.description ?? ''}`)
        .join('\n')}`);
    }
    const acs = prd.acceptanceCriteria as string[] | undefined;
    if (acs?.length) parts.push(`Acceptance criteria:\n${acs.map((a) => `- ${a}`).join('\n')}`);
    return parts.join('\n\n');
  }

  private parseDesign(raw: string): ArchitectureDesign {
    const cleaned = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error(
        `Architect model output was not valid JSON: ${(err as Error).message}`,
        { cause: err },
      );
    }

    // Minimal shape validation; let downstream code handle loose fields.
    const design: ArchitectureDesign = {
      summary: String(parsed.summary ?? ''),
      components: Array.isArray(parsed.components) ? (parsed.components as any) : [],
      apis: Array.isArray(parsed.apis) ? (parsed.apis as any) : [],
      dataModel: Array.isArray(parsed.dataModel) ? (parsed.dataModel as any) : [],
      risks: Array.isArray(parsed.risks) ? (parsed.risks as any) : [],
      implementationOrder: Array.isArray(parsed.implementationOrder)
        ? (parsed.implementationOrder as string[])
        : [],
      generatedAt: new Date().toISOString(),
      generatedByModel: 'gemini',
    };
    return design;
  }
}
