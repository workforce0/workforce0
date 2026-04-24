// =============================================================================
// Memory System Types — 4-Tier Hierarchy
// =============================================================================

export type MemoryTier = 'hot' | 'warm' | 'long_term' | 'archive';
export type MemoryCategory = 'preference' | 'convention' | 'pattern' | 'decision' | 'feedback';

export interface MemoryEntry {
  key: string;
  category: MemoryCategory;
  value: unknown;
  source: string;
  confidence: number;
}

export interface MemoryQuery {
  tenantId: string;
  categories?: MemoryCategory[];
  limit?: number;
}
