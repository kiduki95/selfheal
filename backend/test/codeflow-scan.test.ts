import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepo, type EdgeSpec } from '../src/codeflow/scan.js';
import { isCodeFile, isDeclarationFile, isTestSourceFile, scriptKindFor, resolveCandidates } from '../src/codeflow/languages.js';
import ts from 'typescript';

// No DB needed — scanRepo is a pure filesystem→graph function. Fixtures exercise the calls-edge
// resolution: named imports, default imports, and local-shadowing (B1, deferred review finding).
let root: string;

function calls(edges: EdgeSpec[]): Set<string> {
  return new Set(edges.filter((e) => e.kind === 'calls').map((e) => `${e.srcKey}->${e.dstKey}`));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'codeflow-scan-'));
  mkdirSync(join(root, 'src', 'lib'), { recursive: true });
  mkdirSync(join(root, 'src', 'app'), { recursive: true });

  // helper = named export, MainThing = default export.
  writeFileSync(
    join(root, 'src', 'lib', 'util.ts'),
    `export function helper() { return 1; }\nexport default function MainThing() { return 2; }\n`,
  );
  // Uses both the named and the default import → two calls edges expected.
  writeFileSync(
    join(root, 'src', 'app', 'page.ts'),
    `import { helper } from '../lib/util';\nimport MainThing from '../lib/util';\nexport function run() { return helper() + MainThing(); }\n`,
  );
  // Imports helper but shadows it with a local const → must NOT emit a calls edge to lib/util#helper.
  writeFileSync(
    join(root, 'src', 'app', 'shadow.ts'),
    `import { helper } from '../lib/util';\nexport function go() { const helper = () => 9; return helper(); }\n`,
  );
  // One function shadows `helper` with a param; a SIBLING function uses the real import. The sibling's
  // edge must survive (scope-aware free-use resolution), even though `helper` is bound elsewhere.
  writeFileSync(
    join(root, 'src', 'app', 'sibling.ts'),
    `import { helper } from '../lib/util';\nfunction shadowed(helper: () => number) { return helper(); }\nexport function real() { return helper(); }\n`,
  );
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('codeflow scan calls edges', () => {
  it('resolves named-import calls to the exported symbol', () => {
    const c = calls(scanRepo({ rootDir: root, repo: 'test/fixture' }).edges);
    expect(c.has('src/app/page.ts->src/lib/util.ts#helper')).toBe(true);
  });

  it('resolves default-import calls to the file default export symbol', () => {
    const c = calls(scanRepo({ rootDir: root, repo: 'test/fixture' }).edges);
    expect(c.has('src/app/page.ts->src/lib/util.ts#MainThing')).toBe(true);
  });

  it('skips a call to a locally-shadowed import name (no false edge)', () => {
    const c = calls(scanRepo({ rootDir: root, repo: 'test/fixture' }).edges);
    expect(c.has('src/app/shadow.ts->src/lib/util.ts#helper')).toBe(false);
  });

  it('keeps a sibling-scope import call even when another scope shadows the name', () => {
    const c = calls(scanRepo({ rootDir: root, repo: 'test/fixture' }).edges);
    // real() uses the genuine import → edge kept; shadowed()'s param use is correctly excluded.
    expect(c.has('src/app/sibling.ts->src/lib/util.ts#helper')).toBe(true);
  });
});

// F1: language registry helpers (pure, no DB/FS).
describe('language registry (F1)', () => {
  it('recognizes the JS/TS family but not .vue/.d.ts', () => {
    for (const f of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) expect(isCodeFile(f)).toBe(true);
    expect(isCodeFile('a.vue')).toBe(false);
    expect(isCodeFile('a.css')).toBe(false);
    expect(isDeclarationFile('a.d.ts')).toBe(true);
    expect(isDeclarationFile('a.d.mts')).toBe(true);
    expect(isDeclarationFile('a.ts')).toBe(false);
  });
  it('picks ScriptKind per extension (JSX for .jsx, JS for plain .js)', () => {
    expect(scriptKindFor('a.tsx')).toBe(ts.ScriptKind.TSX);
    expect(scriptKindFor('a.jsx')).toBe(ts.ScriptKind.JSX);
    expect(scriptKindFor('a.ts')).toBe(ts.ScriptKind.TS);
    expect(scriptKindFor('a.js')).toBe(ts.ScriptKind.JS);
    expect(scriptKindFor('a.mjs')).toBe(ts.ScriptKind.JS);
  });
  it('flags test/spec files across js/ts variants', () => {
    expect(isTestSourceFile('x.test.ts')).toBe(true);
    expect(isTestSourceFile('x.spec.jsx')).toBe(true);
    expect(isTestSourceFile('x.test.mjs')).toBe(true);
    expect(isTestSourceFile('x.ts')).toBe(false);
  });
  it('resolveCandidates expands an ext-less target across the family + index files', () => {
    const c = resolveCandidates('../lib/util');
    expect(c).toContain('../lib/util.ts');
    expect(c).toContain('../lib/util.js');
    expect(c).toContain('../lib/util/index.js');
  });
});

// F1: a JS/JSX repo (the kiduki-gcs case) now produces nodes + resolves intra-repo calls/imports.
describe('codeflow scan — JS/JSX family (F1)', () => {
  let jsRoot: string;
  beforeAll(() => {
    jsRoot = mkdtempSync(join(tmpdir(), 'codeflow-js-'));
    mkdirSync(join(jsRoot, 'client', 'lib'), { recursive: true });
    mkdirSync(join(jsRoot, 'client', 'views'), { recursive: true });
    // ES-module .js with a named export.
    writeFileSync(join(jsRoot, 'client', 'lib', 'math.js'), `export function add(a, b) { return a + b; }\n`);
    // .jsx that imports + calls it (JSX parsing must not choke on the tag).
    writeFileSync(
      join(jsRoot, 'client', 'views', 'Panel.jsx'),
      `import { add } from '../lib/math';\nexport function Panel() { return add(1, 2); }\n`,
    );
  });
  afterAll(() => { if (jsRoot) rmSync(jsRoot, { recursive: true, force: true }); });

  it('parses .js/.jsx under a client/ root and emits file + symbol nodes', () => {
    const scan = scanRepo({ rootDir: jsRoot, repo: 'test/js' });
    expect(scan.nodes.length).toBeGreaterThan(0);
    expect(scan.nodes.some((n) => n.path === 'client/lib/math.js' && n.kind === 'file')).toBe(true);
    expect(scan.nodes.some((n) => n.symbol === 'add')).toBe(true);
    expect(scan.nodes.some((n) => n.symbol === 'Panel')).toBe(true);
  });

  it('resolves an ext-less import + call across .jsx → .js', () => {
    const c = calls(scanRepo({ rootDir: jsRoot, repo: 'test/js' }).edges);
    expect(c.has('client/views/Panel.jsx->client/lib/math.js#add')).toBe(true);
  });
});
