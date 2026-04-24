/**
 * ProjectGraph data types — shared between the AST extractor, the
 * service layer, and the serialized `graphJson` blob stored on
 * ProjectGraph rows.
 *
 * Keep these narrow: the whole graph lives in a JSON column, and the
 * LLM-facing prompt helpers serialize parts of it. Every extra field
 * costs tokens when it appears in a chief_of_staff planner prompt.
 *
 * @module services/project-graph/types
 */

/** A node in the project graph — a file, a class, a function, etc. */
export interface GraphNode {
  /** Stable id: `<relPath>:<kind>:<name>` (unique across the graph). */
  id: string;
  /** `file` | `class` | `interface` | `function` | `method` | `enum` | `type`. */
  kind: GraphNodeKind;
  /** Bare name without a qualifier — e.g. `TaskRepository`, `createTask`. */
  name: string;
  /** Relative path (from the repo root) + line number where the symbol is declared. */
  file: string;
  line?: number;
  /** Degree computed after the graph is built. Cached on the node so the
   *  chief_of_staff prompt enrichment doesn't have to re-count. */
  degree?: number;
  /** Community id assigned by Louvain, once clustering runs. */
  community?: number;
}

export type GraphNodeKind =
  | 'file'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'enum'
  | 'type';

/** An edge between two nodes — contains, calls, imports. */
export interface GraphEdge {
  /** Stable id: `<fromId>--<kind>->-<toId>`. */
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /** Evidence tag: EXTRACTED (direct AST match) or INFERRED (heuristic). */
  confidence: 'EXTRACTED' | 'INFERRED';
}

export type GraphEdgeKind = 'contains' | 'imports' | 'calls' | 'extends' | 'implements';

/** Cluster of related symbols detected via community detection. */
export interface GraphCommunity {
  /** 0-indexed community id assigned by Louvain. */
  id: number;
  /** How many nodes are in this community. */
  size: number;
  /** Top 3 most connected nodes in the community, by degree. Used as a
   *  cheap human-readable label when the full graph view needs to show
   *  what this cluster "is." */
  topNodes: string[];
}

/** The serialized graph blob stored on ProjectGraph.graphJson. */
export interface SerializedGraph {
  /** Schema version. Bump when shape changes so old rows stay readable. */
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
  /** Build stats — included so the audit UI can show them without a
   *  separate query. */
  stats: {
    nodeCount: number;
    edgeCount: number;
    extractedEdges: number;
    inferredEdges: number;
    fileCount: number;
  };
}

/** A file on disk the extractor is asked to process. */
export interface FileInput {
  /** Relative path from the repo root (stored as-is in node.file). */
  relPath: string;
  /** Absolute path the extractor opens; never stored on nodes. */
  absPath: string;
  contents: string;
}
