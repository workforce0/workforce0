import { describe, it, expect } from 'vitest';
import { extractFromPythonFile } from '../py-extractor.js';

function fixture(relPath: string, contents: string) {
  return { relPath, absPath: `/fake/${relPath}`, contents };
}

describe('extractFromPythonFile', () => {
  it('creates a file node + top-level class + top-level function', () => {
    const src = [
      'class Foo:',
      '    def bar(self):',
      '        pass',
      '',
      'def hello(name):',
      '    return name',
    ].join('\n');
    const out = extractFromPythonFile(fixture('src/mod.py', src));
    const names = out.nodes.map((n) => `${n.kind}:${n.name}`).sort();
    expect(names).toContain('file:mod.py');
    expect(names).toContain('class:Foo');
    expect(names).toContain('method:bar');
    expect(names).toContain('function:hello');
  });

  it('emits a contains edge for each declared symbol, EXTRACTED', () => {
    const src = 'class A:\n    def m(self): pass\n\ndef g(): pass\n';
    const out = extractFromPythonFile(fixture('a.py', src));
    const contains = out.edges.filter((e) => e.kind === 'contains');
    expect(contains.length).toBeGreaterThanOrEqual(2); // file→A, file→g, A→m
    for (const e of contains) expect(e.confidence).toBe('EXTRACTED');
  });

  it('captures class bases as INFERRED extends edges', () => {
    const out = extractFromPythonFile(
      fixture('a.py', 'class Dog(Animal, Tamable):\n    pass\n'),
    );
    const extendsEdges = out.edges.filter((e) => e.kind === 'extends');
    expect(extendsEdges.length).toBe(2);
    for (const e of extendsEdges) expect(e.confidence).toBe('INFERRED');
  });

  it('drops `metaclass=X` kwargs from the bases list', () => {
    const out = extractFromPythonFile(
      fixture('a.py', 'class Service(Base, metaclass=Meta):\n    pass\n'),
    );
    const extendsTargets = out.edges
      .filter((e) => e.kind === 'extends')
      .map((e) => e.to);
    // Base captured; metaclass skipped.
    expect(extendsTargets.some((t) => t.endsWith(':class:Base'))).toBe(true);
    expect(extendsTargets.some((t) => t.endsWith(':class:Meta'))).toBe(false);
  });

  it('captures async def the same way as def', () => {
    const src = 'async def fetch(url):\n    return url\n';
    const out = extractFromPythonFile(fixture('a.py', src));
    const fn = out.nodes.find((n) => n.kind === 'function' && n.name === 'fetch');
    expect(fn).toBeDefined();
  });

  it('records a relative from-import as an imports edge', () => {
    const src = 'from .helpers import thing\nfrom ..parent import x\n';
    const out = extractFromPythonFile(fixture('a.py', src));
    const modules = out.imports.map((i) => i.modulePath).sort();
    expect(modules).toEqual(['..parent', '.helpers']);
  });

  it('ignores non-relative imports (third-party / stdlib)', () => {
    const src = 'from json import loads\nimport os\n';
    const out = extractFromPythonFile(fixture('a.py', src));
    expect(out.imports).toHaveLength(0);
  });

  it('records call expressions inside a def as unresolvedCalls', () => {
    const src = [
      'def outer():',
      '    inner(x)',
      '    other_call()',
      '',
      'def inner(y): pass',
    ].join('\n');
    const out = extractFromPythonFile(fixture('a.py', src));
    const fromOuter = out.unresolvedCalls.filter((c) => c.fromId.endsWith(':function:outer'));
    const callees = fromOuter.map((c) => c.calleeName).sort();
    expect(callees).toEqual(['inner', 'other_call']);
  });

  it('filters out Python builtins from call targets', () => {
    const src = 'def f():\n    print(len(x))\n    my_helper()\n';
    const out = extractFromPythonFile(fixture('a.py', src));
    const callees = out.unresolvedCalls.map((c) => c.calleeName).sort();
    expect(callees).toEqual(['my_helper']);
  });

  it('filters out keyword-like tokens (if/while/for) from call scans', () => {
    const src = 'def f():\n    if (cond):\n        while (x):\n            helper()\n';
    const out = extractFromPythonFile(fixture('a.py', src));
    const callees = out.unresolvedCalls.map((c) => c.calleeName);
    expect(callees).toContain('helper');
    expect(callees).not.toContain('if');
    expect(callees).not.toContain('while');
  });

  it('attributes method-body calls to the method, not the enclosing class', () => {
    const src = [
      'class Svc:',
      '    def do_thing(self):',
      '        self.helper()',
      '',
      '    def helper(self):',
      '        pass',
    ].join('\n');
    const out = extractFromPythonFile(fixture('a.py', src));
    const fromDoThing = out.unresolvedCalls.filter((c) => c.calleeName === 'helper');
    expect(fromDoThing).toHaveLength(1);
    expect(fromDoThing[0].fromId).toContain(':method:do_thing');
    // The class itself is not a caller.
    expect(fromDoThing[0].fromId).not.toContain('class:Svc\0');
  });

  it('skips nested classes (known limitation)', () => {
    const src = [
      'class Outer:',
      '    class Inner:',
      '        pass',
    ].join('\n');
    const out = extractFromPythonFile(fixture('a.py', src));
    const classes = out.nodes.filter((n) => n.kind === 'class').map((n) => n.name);
    expect(classes).toEqual(['Outer']);
  });

  it('handles comments + blank lines without breaking indent tracking', () => {
    const src = [
      '# a comment at top',
      '',
      'class Foo:',
      '    # a method comment',
      '',
      '    def bar(self):',
      '        pass',
    ].join('\n');
    const out = extractFromPythonFile(fixture('a.py', src));
    expect(out.nodes.find((n) => n.name === 'Foo')).toBeDefined();
    expect(out.nodes.find((n) => n.name === 'bar' && n.kind === 'method')).toBeDefined();
  });
});
