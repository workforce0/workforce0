/**
 * TypeScript / JavaScript AST extractor.
 *
 * Walks a single `.ts` / `.tsx` / `.js` / `.jsx` source file using the
 * TypeScript compiler API and produces the graph nodes + edges it
 * finds there.
 *
 * Deliberately conservative:
 *   - Only top-level declarations get nodes (classes, interfaces,
 *     enums, type aliases, top-level functions). Local variables /
 *     inline arrow functions don't — keeps the graph useful as a
 *     navigation map rather than a syntax tree dump.
 *   - Class methods get their own `method` nodes since they're the
 *     thing people call and grep for.
 *   - Edges:
 *       `contains`   — file → declared-symbol, class → method
 *       `imports`    — file → the module (file or package) it imports
 *       `calls`      — caller-symbol → callee-symbol (INFERRED; we
 *                      resolve by bare name since full type-resolution
 *                      would require a real Program + tsc, which is
 *                      heavyweight per-file)
 *       `extends`    — class → class (EXTRACTED where base is in the
 *                      same file; INFERRED otherwise)
 *       `implements` — class → interface
 *
 * Call-edge resolution (the INFERRED `calls` edges) is the one place
 * we're deliberately loose: a symbol `foo()` in one file can mean any
 * of N declared `foo`s across the graph. The service layer decides
 * how to join bare names to absolute nodes after all files have been
 * parsed (see `ProjectGraphService.resolveCallEdges`).
 *
 * Credit: the overall graph shape + extracted/inferred tagging is
 * inspired by https://github.com/safishamsi/graphify.
 *
 * @module services/project-graph/ts-extractor
 */

import ts from 'typescript';
import type { GraphNode, GraphEdge, GraphNodeKind, FileInput } from './types.js';

/** Output of extracting a single file. */
export interface FileExtraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Call targets by bare name — resolved to node ids by the service. */
  unresolvedCalls: Array<{ fromId: string; calleeName: string }>;
  /** Imported module names — resolved to file ids by the service when
   *  the import resolves to a file inside the repo. */
  imports: Array<{ fromFileId: string; modulePath: string }>;
}

/**
 * Parse a single TypeScript/JavaScript source file and extract nodes +
 * edges. Pure function; returns nothing if the file fails to parse
 * (logged by the caller so a single malformed file doesn't break a
 * whole-repo build).
 */
export function extractFromFile(input: FileInput): FileExtraction {
  const sourceFile = ts.createSourceFile(
    input.relPath,
    input.contents,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    scriptKindFor(input.relPath),
  );

  const fileNodeId = `${input.relPath}:file:${basename(input.relPath)}`;
  const nodes: GraphNode[] = [
    { id: fileNodeId, kind: 'file', name: basename(input.relPath), file: input.relPath, line: 1 },
  ];
  const edges: GraphEdge[] = [];
  const unresolvedCalls: Array<{ fromId: string; calleeName: string }> = [];
  const imports: Array<{ fromFileId: string; modulePath: string }> = [];

  /** Scratch stack so nested `call()` tokens know which enclosing
   *  function / method is the caller. */
  const enclosingStack: string[] = [];

  const addNode = (n: GraphNode) => {
    nodes.push(n);
    edges.push({
      id: edgeId(fileNodeId, 'contains', n.id),
      from: fileNodeId,
      to: n.id,
      kind: 'contains',
      confidence: 'EXTRACTED',
    });
  };

  const visit = (node: ts.Node): void => {
    // — imports —
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec)) {
        imports.push({ fromFileId: fileNodeId, modulePath: spec.text });
      }
      return;
    }

    // — top-level class —
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classId = `${input.relPath}:class:${className}`;
      addNode({
        id: classId,
        kind: 'class',
        name: className,
        file: input.relPath,
        line: lineOf(sourceFile, node),
      });

      for (const heritage of node.heritageClauses ?? []) {
        for (const type of heritage.types) {
          if (!ts.isIdentifier(type.expression) && !ts.isPropertyAccessExpression(type.expression)) continue;
          const baseName = textOf(type.expression);
          const baseKind: GraphNodeKind = heritage.token === ts.SyntaxKind.ExtendsKeyword ? 'class' : 'interface';
          const baseId = `${input.relPath}:${baseKind}:${baseName}`; // best-effort local; service resolves cross-file
          edges.push({
            id: edgeId(classId, heritage.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements', baseId),
            from: classId,
            to: baseId,
            kind: heritage.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements',
            confidence: 'INFERRED',
          });
        }
      }

      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = textOf(member.name);
          const methodId = `${classId}:method:${methodName}`;
          nodes.push({
            id: methodId,
            kind: 'method',
            name: methodName,
            file: input.relPath,
            line: lineOf(sourceFile, member),
          });
          edges.push({
            id: edgeId(classId, 'contains', methodId),
            from: classId,
            to: methodId,
            kind: 'contains',
            confidence: 'EXTRACTED',
          });
          enclosingStack.push(methodId);
          ts.forEachChild(member, visit);
          enclosingStack.pop();
        }
      }
      return;
    }

    // — top-level interface —
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      addNode({
        id: `${input.relPath}:interface:${name}`,
        kind: 'interface',
        name,
        file: input.relPath,
        line: lineOf(sourceFile, node),
      });
      return;
    }

    // — top-level enum —
    if (ts.isEnumDeclaration(node)) {
      const name = node.name.text;
      addNode({
        id: `${input.relPath}:enum:${name}`,
        kind: 'enum',
        name,
        file: input.relPath,
        line: lineOf(sourceFile, node),
      });
      return;
    }

    // — top-level type alias —
    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      addNode({
        id: `${input.relPath}:type:${name}`,
        kind: 'type',
        name,
        file: input.relPath,
        line: lineOf(sourceFile, node),
      });
      return;
    }

    // — top-level function / exported arrow —
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const id = `${input.relPath}:function:${name}`;
      addNode({
        id,
        kind: 'function',
        name,
        file: input.relPath,
        line: lineOf(sourceFile, node),
      });
      enclosingStack.push(id);
      ts.forEachChild(node, visit);
      enclosingStack.pop();
      return;
    }
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.length === 1 &&
      node.declarationList.declarations[0].initializer &&
      (ts.isArrowFunction(node.declarationList.declarations[0].initializer) ||
        ts.isFunctionExpression(node.declarationList.declarations[0].initializer))
    ) {
      const decl = node.declarationList.declarations[0];
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text;
        const id = `${input.relPath}:function:${name}`;
        addNode({
          id,
          kind: 'function',
          name,
          file: input.relPath,
          line: lineOf(sourceFile, decl),
        });
        enclosingStack.push(id);
        ts.forEachChild(decl.initializer!, visit);
        enclosingStack.pop();
        return;
      }
    }

    // — call expressions inside the currently-enclosing function/method —
    if (ts.isCallExpression(node) && enclosingStack.length > 0) {
      const callee = calleeNameOf(node.expression);
      if (callee) {
        unresolvedCalls.push({
          fromId: enclosingStack[enclosingStack.length - 1],
          calleeName: callee,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return { nodes, edges, unresolvedCalls, imports };
}

// ————————————————————————————————————————————————————————————
// helpers
// ————————————————————————————————————————————————————————————

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function textOf(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isStringLiteral(node)) return node.text;
  return node.getText();
}

function calleeNameOf(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

function edgeId(from: string, kind: string, to: string): string {
  return `${from}--${kind}->-${to}`;
}
