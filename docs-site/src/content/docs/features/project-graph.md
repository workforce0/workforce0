---
title: Project Graph
description: Native AST extraction of your codebase. God-nodes feed the planner so briefs target what matters.
---

## The idea

A **project graph** is a directed graph whose nodes are files /
classes / interfaces / functions / methods and whose edges are
`contains`, `imports`, `calls`, `extends`, `implements`.

It gives the planner structural context about the codebase it's
operating on without us shipping the full repo to the LLM.

**Credit**: the overall shape, the `EXTRACTED` vs `INFERRED` edge
confidence tag, and the god-nodes concept come from
[safishamsi/graphify](https://github.com/safishamsi/graphify). The
Workforce0 implementation is a native TypeScript rewrite with zero
Python runtime dependency.

## What it extracts

### Supported today

- **TypeScript / JavaScript** — full TS compiler API. Files,
  classes, interfaces, functions, methods, enums, type aliases,
  imports, call expressions, extends / implements.
- **Python** — regex-based. Files, classes, functions, methods
  (one level), `from X import Y`, bare-name call expressions.
  Nested classes are deliberately skipped.

### Not yet supported

- Go, Rust, Java. Each can follow the Python pattern; first-class
  tree-sitter or language-native parsers for higher precision.

## Key concepts

### God-nodes

Nodes with the highest degree (incoming + outgoing edges) — the
symbols with the most dependencies in and out of them. These are
where most changes ripple through the repo.

Accessed via:

- UI: **Code Graph** page.
- API: `GET /api/project-graph/:projectId/god-nodes?limit=10`.

The top-5 god-nodes are piped into every chief-of-staff plan prompt
as **"Project landmarks."** The planner uses them to decompose around
core abstractions rather than inventing new ones.

### EXTRACTED vs INFERRED

Every edge carries a confidence tag:

- `EXTRACTED` — direct evidence from AST parsing. A `contains` edge
  between a file and a top-level class is `EXTRACTED`.
- `INFERRED` — heuristic. A `calls` edge from `foo()` to `bar()`
  based on bare-name matching is `INFERRED`, because we don't do
  full symbol resolution.

The UI renders this visually; the planner prompt uses `EXTRACTED`
edges for harder claims.

### Communities

[Louvain community detection](https://en.wikipedia.org/wiki/Louvain_method)
runs on the graph after build. Nodes are assigned to communities;
tightly-coupled symbols cluster together.

The UI's **Community** lookup in **Code Graph** shows you every
symbol in the same cluster as the one you entered.

## Building a graph

### From the UI

1. **Code Graph → Build graph**.
2. Paste a filesystem path on the server (`/srv/repos/acme-app`) and
   a repo label (`acme/app`).
3. Build.

First build of ~10k files takes ~10 seconds. Incremental builds
(`contentHash` match) are no-ops.

### From the API

```bash
curl -X POST https://workforce0/api/project-graph/<projectId>/build \
  -H "X-Project-Id: <projectId>" \
  -H "Content-Type: application/json" \
  -d '{ "repoPath": "/srv/repos/acme-app", "repoLabel": "acme/app" }'
```

### Auto-refresh

After the first build, pushes to the default branch auto-refresh the
graph — see [GitHub integration](/integrations/github/).

## Querying the graph

Six REST endpoints:

| Endpoint                                  | Purpose                                 |
| ----------------------------------------- | --------------------------------------- |
| `GET  /api/project-graph/:projectId`      | Summary (counts, languages, timestamp)  |
| `GET  /api/project-graph/:projectId/god-nodes?limit=N` | Top-N by degree              |
| `GET  /api/project-graph/:projectId/callers/:symbol` | Symbols that call the target      |
| `GET  /api/project-graph/:projectId/path?from=X&to=Y` | Shortest path in the dep graph     |
| `GET  /api/project-graph/:projectId/community/:symbol` | All symbols in the same Louvain community |
| `POST /api/project-graph/:projectId/build` | Build / refresh                         |

## Storage

Each `ProjectGraph` row stores:

- `contentHash` (SHA256 of the input file set). Incremental builds
  check this first.
- `graphJson` — serialized full graph (nodes, edges, communities).
- Denormalised counts (`nodeCount`, `edgeCount`, `communityCount`)
  for fast dashboard reads.
- `godNodeSlugs` — cached top-N for the planner prompt.
- `languages` — extractor coverage, for the audit UI ("TS + Python").
- `repoPath` — filesystem path for auto-refresh.
- `repoLabel` — GitHub `owner/name`, for webhook matching.

## Graph staleness

`ExecutionPlan` rows snapshot the `contentHash` from the graph that
fed the prompt (`graphContentHash`). When the graph rebuilds, older
plans get flagged `graphStale` in the library UI. Stale plans may
reference renamed / removed symbols.

See [Graph-staleness badge](/features/audit-approvals/#graph-staleness-badge).

## PRD ↔ code cross-links

Approved briefs (PRDs) are scanned for code-symbol mentions ("we'll
change the TaskRepository") and links are persisted to
`PRDSymbolLink`. The UI can then jump from brief text to the symbol's
file + line.

## Performance

- Extraction rate: ~5k files / second for TS (TS compiler dominates);
  ~20k files / second for Python (regex-only).
- Louvain community detection: linear-ish in edge count.
- Memory: ~1 GB transient during extraction of a 100k-file repo.

## Limitations (honest)

- **Regex-based Python** misses nested classes, dynamic class creation,
  metaclasses.
- **No full symbol resolution** — `calls` edges are by bare name.
  Ambiguity (two `save()` methods in different classes) resolves to
  all matches; the planner tolerates this.
- **No cross-repo**. Each graph is one repo. Multi-repo projects
  aggregate god-nodes at read time.

See [DEFERRED.md](https://github.com/workforce0/workforce0/blob/main/docs/DEFERRED.md)
for the language extractor backlog.
