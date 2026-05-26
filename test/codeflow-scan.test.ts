import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepo, type EdgeSpec } from '../src/codeflow/scan.js';

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
