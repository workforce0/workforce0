/**
 * PRD Template Service
 *
 * Manages PRD templates (system defaults + tenant custom).
 */

import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'PRDTemplates' });

export const DEFAULT_TEMPLATES = [
  {
    name: 'Feature Request',
    description: 'Standard product feature specification with requirements, acceptance criteria, and risks.',
    sections: [
      { name: 'summary', label: 'Executive Summary', required: true, description: 'Brief overview of the feature and its value' },
      { name: 'objectives', label: 'Objectives', required: true, description: 'What this feature aims to achieve' },
      { name: 'requirements', label: 'Requirements', required: true, description: 'Functional and non-functional requirements' },
      { name: 'acceptanceCriteria', label: 'Acceptance Criteria', required: true, description: 'How to verify the feature works correctly' },
      { name: 'outOfScope', label: 'Out of Scope', required: false, description: 'What is explicitly not included' },
      { name: 'assumptions', label: 'Assumptions', required: false, description: 'Key assumptions being made' },
      { name: 'risks', label: 'Risks & Mitigations', required: false, description: 'Potential risks and how to address them' },
      { name: 'timeline', label: 'Timeline', required: false, description: 'Estimated implementation timeline' },
    ],
    isDefault: true,
  },
  {
    name: 'Bug Report',
    description: 'Structured bug report with reproduction steps, impact assessment, and fix criteria.',
    sections: [
      { name: 'summary', label: 'Bug Summary', required: true, description: 'What is broken and its impact' },
      { name: 'reproductionSteps', label: 'Steps to Reproduce', required: true, description: 'Exact steps to reproduce the issue' },
      { name: 'expectedBehavior', label: 'Expected Behavior', required: true, description: 'What should happen' },
      { name: 'actualBehavior', label: 'Actual Behavior', required: true, description: 'What actually happens' },
      { name: 'impact', label: 'Impact Assessment', required: true, description: 'Users affected, severity, frequency' },
      { name: 'acceptanceCriteria', label: 'Fix Criteria', required: true, description: 'How to verify the fix works' },
      { name: 'rootCause', label: 'Root Cause', required: false, description: 'Suspected or confirmed root cause' },
    ],
    isDefault: false,
  },
  {
    name: 'Technical Debt',
    description: 'Technical improvement proposal with justification, approach, and migration plan.',
    sections: [
      { name: 'summary', label: 'Problem Statement', required: true, description: 'What technical debt exists and why it matters' },
      { name: 'currentState', label: 'Current State', required: true, description: 'How things work today' },
      { name: 'proposedState', label: 'Proposed State', required: true, description: 'How things should work after improvement' },
      { name: 'approach', label: 'Approach', required: true, description: 'How to get from current to proposed state' },
      { name: 'risks', label: 'Risks & Rollback', required: true, description: 'What could go wrong and how to roll back' },
      { name: 'effort', label: 'Effort Estimate', required: false, description: 'Engineering effort required' },
    ],
    isDefault: false,
  },
  {
    name: 'Process Change',
    description: 'Proposal for changing a team process with rationale and rollout plan.',
    sections: [
      { name: 'summary', label: 'Change Summary', required: true, description: 'What process is changing and why' },
      { name: 'currentProcess', label: 'Current Process', required: true, description: 'How the process works today' },
      { name: 'proposedProcess', label: 'Proposed Process', required: true, description: 'How the process should work' },
      { name: 'rationale', label: 'Rationale', required: true, description: 'Why this change is needed' },
      { name: 'impactedTeams', label: 'Impacted Teams', required: true, description: 'Who is affected by this change' },
      { name: 'rolloutPlan', label: 'Rollout Plan', required: false, description: 'How to phase in the change' },
      { name: 'successMetrics', label: 'Success Metrics', required: false, description: 'How to measure if the change worked' },
    ],
    isDefault: false,
  },
  {
    name: 'Continuous Improvement',
    description: 'For Gemba walk observations, shop floor improvements, and operational optimization',
    industry: 'manufacturing',
    sections: [
      { name: 'problemObserved', label: 'Problem Observed', required: true, description: 'What was seen on the floor — specific location, time, conditions' },
      { name: 'impact', label: 'Impact', required: true, description: 'How this affects production, quality, safety, or cost' },
      { name: 'rootCauseAnalysis', label: 'Root Cause Analysis', required: true, description: '5 Whys or fishbone analysis of why this is happening' },
      { name: 'correctiveAction', label: 'Corrective Action', required: true, description: 'Specific steps to fix the problem' },
      { name: 'owner', label: 'Owner', required: true, description: 'Person responsible for implementation' },
      { name: 'deadline', label: 'Deadline', required: true, description: 'Target completion date' },
      { name: 'resourcesRequired', label: 'Resources Required', required: false, description: 'Budget, equipment, personnel needed' },
      { name: 'verificationMethod', label: 'Verification Method', required: true, description: 'How to confirm the fix worked — metrics, inspections, tests' },
      { name: 'preventiveAction', label: 'Preventive Action', required: false, description: 'Steps to prevent recurrence' },
    ],
    isDefault: false,
  },
  {
    name: 'Safety Incident Report',
    description: 'For documenting safety observations, near-misses, and incidents',
    industry: 'manufacturing',
    sections: [
      { name: 'incidentDescription', label: 'Incident Description', required: true, description: 'What happened — who, what, where, when' },
      { name: 'severity', label: 'Severity', required: true, description: 'Near-miss, first aid, recordable, lost time' },
      { name: 'immediateActionsTaken', label: 'Immediate Actions Taken', required: true, description: 'What was done right away to secure the area' },
      { name: 'rootCause', label: 'Root Cause', required: true, description: 'Why it happened — equipment, training, process, environment' },
      { name: 'correctiveActions', label: 'Corrective Actions', required: true, description: 'Steps to prevent recurrence' },
      { name: 'owner', label: 'Owner', required: true, description: 'Person responsible' },
      { name: 'followUpDate', label: 'Follow-up Date', required: true, description: 'When to verify corrective actions are effective' },
    ],
    isDefault: false,
  },
];

/**
 * Seed default PRD templates into the database.
 */
export async function seedDefaultTemplates(prisma: any): Promise<void> {
  for (const template of DEFAULT_TEMPLATES) {
    const existing = await prisma.pRDTemplate.findFirst({
      where: { tenantId: null, name: template.name },
    });

    if (!existing) {
      await prisma.pRDTemplate.create({
        data: {
          tenantId: null,
          ...template,
        },
      });
      logger.info(`Seeded default template: ${template.name}`);
    }
  }
}

/**
 * Get all templates available to a tenant (system + custom).
 */
export async function getTemplatesForTenant(prisma: any, tenantId: string) {
  return prisma.pRDTemplate.findMany({
    where: {
      OR: [
        { tenantId: null },
        { tenantId },
      ],
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}
