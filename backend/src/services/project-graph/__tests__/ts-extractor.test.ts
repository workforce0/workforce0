import { describe, it, expect } from 'vitest';
import { extractFromFile } from '../ts-extractor.js';

function fixture(relPath: string, contents: string) {
  return { relPath, absPath: `/fake/${relPath}`, contents };
}

describe('extractFromFile', () => {
  it('creates a file node + contains edges for every top-level declaration', () => {
    const src = `
      export class Foo {
        bar() { return 1; }
      }
      export function hello() {}
      export interface Bag {}
      export enum Color { Red, Blue }
      export type X = string;
    `;
    const out = extractFromFile(fixture('src/foo.ts', src));
    const fileNode = out.nodes.find((n) => n.kind === 'file');
    expect(fileNode).toBeDefined();
    expect(fileNode!.name).toBe('foo.ts');

    const names = out.nodes.map((n) => `${n.kind}:${n.name}`).sort();
    expect(names).toContain('class:Foo');
    expect(names).toContain('function:hello');
    expect(names).toContain('interface:Bag');
    expect(names).toContain('enum:Color');
    expect(names).toContain('type:X');
    expect(names).toContain('method:bar');

    // Contains edges from file → top-level symbols
    const containsEdges = out.edges.filter((e) => e.kind === 'contains');
    expect(containsEdges.length).toBeGreaterThanOrEqual(5);
    for (const e of containsEdges) {
      expect(e.confidence).toBe('EXTRACTED');
    }
  });

  it('records arrow-function const declarations as function nodes', () => {
    const src = `export const greet = (name: string) => \`hi \${name}\`;`;
    const out = extractFromFile(fixture('src/greet.ts', src));
    const fn = out.nodes.find((n) => n.kind === 'function' && n.name === 'greet');
    expect(fn).toBeDefined();
  });

  it('records a calls edge with the enclosing function as the caller', () => {
    const src = `
      function inner() { return 1; }
      function outer() { return inner(); }
    `;
    const out = extractFromFile(fixture('src/mod.ts', src));
    // outer → inner call is unresolved by name here; the service
    // resolves to the node id later.
    const call = out.unresolvedCalls.find(
      (c) => c.calleeName === 'inner' && c.fromId.endsWith(':function:outer'),
    );
    expect(call).toBeDefined();
  });

  it('records import specifiers (string-literal moduleSpecifier only)', () => {
    const src = `
      import { X } from './helpers.js';
      import * as fs from 'node:fs';
    `;
    const out = extractFromFile(fixture('src/thing.ts', src));
    const modules = out.imports.map((i) => i.modulePath).sort();
    expect(modules).toEqual(['./helpers.js', 'node:fs']);
  });

  it('records extends + implements as INFERRED edges', () => {
    const src = `
      export class Dog extends Animal implements Tamable {}
    `;
    const out = extractFromFile(fixture('src/dog.ts', src));
    const extendsEdge = out.edges.find((e) => e.kind === 'extends');
    const implementsEdge = out.edges.find((e) => e.kind === 'implements');
    expect(extendsEdge?.confidence).toBe('INFERRED');
    expect(implementsEdge?.confidence).toBe('INFERRED');
  });

  it('survives a malformed file without throwing (best-effort)', () => {
    // TS compiler is very forgiving; even this produces a tree.
    const src = `class { missing-name }`;
    expect(() => extractFromFile(fixture('src/broken.ts', src))).not.toThrow();
  });

  it('extracts method calls inside a method as coming from the method', () => {
    const src = `
      export class Svc {
        doThing() { return this.helper(); }
        helper() { return 1; }
      }
    `;
    const out = extractFromFile(fixture('src/svc.ts', src));
    const helperCall = out.unresolvedCalls.find((c) => c.calleeName === 'helper');
    expect(helperCall?.fromId).toContain(':method:doThing');
  });
});
