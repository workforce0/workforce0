/**
 * Python regex-based extractor.
 *
 * Deliberate trade-off: we use regex instead of a real Python parser
 * so this stays a pure-TS extractor with **zero Python runtime**
 * dependency. The cost is precision — nested classes, decorators,
 * dynamically-created classes, and `locals()` / `globals()` tricks
 * won't be captured. In return, any self-hosted Workforce0 install
 * can extract a Python project graph without adding a language stack
 * to the server.
 *
 * What it finds:
 *   - `class Foo:` / `class Foo(Bar):` → class node + extends edge
 *   - `def foo(...)`  → function node (module-level) or method node
 *     (directly inside a class)
 *   - `async def foo(...)` → same, ignoring the `async` keyword
 *   - `from .x import y` → relative import edge (package imports skipped)
 *   - bare-name `foo(...)` call expressions inside a def body →
 *     call edges, same resolution rules as the TS extractor
 *
 * Nested classes + methods-of-nested-classes are dropped on purpose;
 * if that turns out to be load-bearing we bring back
 * `web-tree-sitter` + the Python grammar. This first version is
 * "good enough to surface the god nodes," not a perfect AST shadow.
 *
 * Credit: the overall graph shape + EXTRACTED/INFERRED tagging is
 * inspired by https://github.com/safishamsi/graphify.
 *
 * @module services/project-graph/py-extractor
 */

import type { GraphNode, GraphEdge, FileInput } from './types.js';
import type { FileExtraction } from './ts-extractor.js';

const PY_IDENT = '[A-Za-z_][A-Za-z0-9_]*';

const CLASS_RE = new RegExp(
  `^(?<indent>[ \\t]*)class[ \\t]+(?<name>${PY_IDENT})[ \\t]*(?:\\((?<bases>[^\\)]*)\\))?[ \\t]*:`,
);

const DEF_RE = new RegExp(
  `^(?<indent>[ \\t]*)(?:async[ \\t]+)?def[ \\t]+(?<name>${PY_IDENT})[ \\t]*\\(`,
);

const FROM_IMPORT_RE = /^[ \t]*from[ \t]+(\.+[\w\.]*)[ \t]+import[ \t]+/;

const CALL_RE = new RegExp(`\\b(${PY_IDENT})[ \\t]*\\(`, 'g');

const PY_BUILTINS = new Set([
  'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple',
  'open', 'type', 'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
  'super', 'zip', 'map', 'filter', 'enumerate', 'sorted', 'reversed', 'sum', 'min', 'max',
  'abs', 'all', 'any', 'iter', 'next', 'repr', 'format', 'bytes', 'bytearray', 'frozenset',
  'callable', 'id', 'hash', 'input', 'eval', 'compile', 'chr', 'ord', 'hex', 'oct',
  'bin', 'divmod', 'pow', 'round', 'globals', 'locals', 'vars', 'dir', 'staticmethod',
  'classmethod', 'property',
]);

const PY_KEYWORDS_WITH_PARENS = new Set([
  'if', 'while', 'for', 'return', 'elif', 'yield', 'and', 'or', 'not', 'in',
]);

export function extractFromPythonFile(input: FileInput): FileExtraction {
  const fileNodeId = `${input.relPath}:file:${basename(input.relPath)}`;
  const nodes: GraphNode[] = [
    { id: fileNodeId, kind: 'file', name: basename(input.relPath), file: input.relPath, line: 1 },
  ];
  const edges: GraphEdge[] = [];
  const unresolvedCalls: Array<{ fromId: string; calleeName: string }> = [];
  const imports: Array<{ fromFileId: string; modulePath: string }> = [];

  const lines = input.contents.split(/\r?\n/);

  interface Frame {
    id: string;
    indent: number;
    kind: 'class' | 'function' | 'method';
  }
  const stack: Frame[] = [];

  const closeFramesTo = (targetIndent: number): void => {
    while (stack.length > 0 && stack[stack.length - 1].indent >= targetIndent) {
      stack.pop();
    }
  };

  const enclosingNonClass = (): Frame | null => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind !== 'class') return stack[i];
    }
    return null;
  };

  const enclosingClass = (): Frame | null => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind === 'class') return stack[i];
    }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    if (stack.length === 0) {
      const rel = line.match(FROM_IMPORT_RE);
      if (rel) {
        imports.push({ fromFileId: fileNodeId, modulePath: rel[1] });
        continue;
      }
    }

    const classMatch = line.match(CLASS_RE);
    if (classMatch && classMatch.groups) {
      const indent = classMatch.groups.indent.length;
      closeFramesTo(indent);
      if (stack.length > 0) continue; // skip nested classes
      const name = classMatch.groups.name;
      const classId = `${input.relPath}:class:${name}`;
      nodes.push({
        id: classId,
        kind: 'class',
        name,
        file: input.relPath,
        line: i + 1,
      });
      edges.push({
        id: `${fileNodeId}--contains->-${classId}`,
        from: fileNodeId,
        to: classId,
        kind: 'contains',
        confidence: 'EXTRACTED',
      });
      const bases = (classMatch.groups.bases ?? '')
        .split(',')
        .map((b) => b.trim().split('=')[0].trim())
        .filter((b) => b && /^[A-Za-z_][A-Za-z0-9_\.]*$/.test(b));
      for (const base of bases) {
        const baseName = base.split('.').pop()!;
        const baseId = `${input.relPath}:class:${baseName}`;
        edges.push({
          id: `${classId}--extends->-${baseId}`,
          from: classId,
          to: baseId,
          kind: 'extends',
          confidence: 'INFERRED',
        });
      }
      stack.push({ id: classId, indent, kind: 'class' });
      continue;
    }

    const defMatch = line.match(DEF_RE);
    if (defMatch && defMatch.groups) {
      const indent = defMatch.groups.indent.length;
      closeFramesTo(indent);
      const name = defMatch.groups.name;
      const cls = enclosingClass();

      if (stack.length === 0) {
        const id = `${input.relPath}:function:${name}`;
        nodes.push({
          id,
          kind: 'function',
          name,
          file: input.relPath,
          line: i + 1,
        });
        edges.push({
          id: `${fileNodeId}--contains->-${id}`,
          from: fileNodeId,
          to: id,
          kind: 'contains',
          confidence: 'EXTRACTED',
        });
        stack.push({ id, indent, kind: 'function' });
      } else if (cls && stack[stack.length - 1] === cls) {
        const methodId = `${cls.id}:method:${name}`;
        nodes.push({
          id: methodId,
          kind: 'method',
          name,
          file: input.relPath,
          line: i + 1,
        });
        edges.push({
          id: `${cls.id}--contains->-${methodId}`,
          from: cls.id,
          to: methodId,
          kind: 'contains',
          confidence: 'EXTRACTED',
        });
        stack.push({ id: methodId, indent, kind: 'method' });
      } else {
        stack.push({ id: `${input.relPath}:_nested:${name}`, indent, kind: 'function' });
      }
      continue;
    }

    const host = enclosingNonClass();
    if (!host) continue;
    if (/^\s*(async\s+)?def\s+/.test(line) || /^\s*class\s+/.test(line)) continue;

    for (const m of line.matchAll(CALL_RE)) {
      const callee = m[1];
      if (!callee) continue;
      if (PY_BUILTINS.has(callee)) continue;
      if (PY_KEYWORDS_WITH_PARENS.has(callee)) continue;
      unresolvedCalls.push({ fromId: host.id, calleeName: callee });
    }
  }

  return { nodes, edges, unresolvedCalls, imports };
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}
