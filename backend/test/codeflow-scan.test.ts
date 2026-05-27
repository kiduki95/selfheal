import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepo, type EdgeSpec } from '../src/codeflow/scan.js';
import { isCodeFile, isDeclarationFile, isTestSourceFile, isVendoredFile, scriptKindFor, resolveCandidates, prepareSource } from '../src/codeflow/languages.js';
import { extractCommonJs } from '../src/codeflow/commonjs.js';
import ts from 'typescript';

const srcFile = (code: string, name = 'm.js') => ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

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
  it('recognizes the JS/TS family + .vue, but not .css/.d.ts', () => {
    for (const f of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.vue']) expect(isCodeFile(f)).toBe(true);
    expect(isCodeFile('a.css')).toBe(false);
    expect(isDeclarationFile('a.d.ts')).toBe(true);
    expect(isDeclarationFile('a.d.mts')).toBe(true);
    expect(isDeclarationFile('a.ts')).toBe(false);
    // vendored/minified bundles are excluded from the graph (code-health noise).
    expect(isVendoredFile('swiper-bundle.min.js')).toBe(true);
    expect(isVendoredFile('app.bundle.js')).toBe(true);
    expect(isVendoredFile('app.js')).toBe(false);
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

// CommonJS extraction (pure AST → facts).
describe('extractCommonJs', () => {
  it('captures require specifiers + the local binding name', () => {
    const x = extractCommonJs(srcFile(`const a = require('./m'); var b = require('pkg'); require('./side');`));
    expect(x.requires).toEqual([
      { local: 'a', spec: './m' },
      { local: 'b', spec: 'pkg' },
      { local: null, spec: './side' },
    ]);
  });
  it('captures module.exports.X / exports.X as named symbols with kind', () => {
    const x = extractCommonJs(srcFile(`module.exports.getUser = function () {}; exports.Helper = class {}; module.exports.flag = 1;`));
    expect(x.exports.find((e) => e.name === 'getUser')?.kind).toBe('function');
    expect(x.exports.find((e) => e.name === 'Helper')?.kind).toBe('class');
    expect(x.exports.find((e) => e.name === 'flag')?.kind).toBe('var');
  });
  it('module.exports = { a, b } → each key a symbol; named function → defaultExportName', () => {
    expect(extractCommonJs(srcFile(`module.exports = { alpha, beta };`)).exports.map((e) => e.name).sort()).toEqual(['alpha', 'beta']);
    const named = extractCommonJs(srcFile(`module.exports = function Router() {};`));
    expect(named.defaultExportName).toBe('Router');
    expect(named.exports.some((e) => e.name === 'Router')).toBe(true);
    expect(extractCommonJs(srcFile(`const Svc = {}; module.exports = Svc;`)).defaultExportName).toBe('Svc');
  });
});

// .vue <script> extraction (prepareSource seam).
describe('prepareSource (.vue)', () => {
  it('extracts the <script> block as JS and keeps the full SFC as uiText', () => {
    const sfc = `<template><h1>Map</h1></template>\n<script>\nimport X from './x';\nexport default { name: 'MapView' };\n</script>\n<style>.a{}</style>`;
    const p = prepareSource('client/src/views/MapView.vue', sfc);
    expect(p.scriptKind).toBe(ts.ScriptKind.JS);
    expect(p.code).toContain(`export default { name: 'MapView' }`);
    expect(p.code).not.toContain('<template>');
    expect(p.uiText).toBe(sfc); // template still available for UI-surface extraction
  });
  it('honors lang="ts" and passes non-vue files through unchanged', () => {
    expect(prepareSource('A.vue', `<script lang="ts">export default {}</script>`).scriptKind).toBe(ts.ScriptKind.TS);
    const pass = prepareSource('a.ts', `export const x = 1;`);
    expect(pass.code).toBe('export const x = 1;');
    expect(pass.scriptKind).toBe(ts.ScriptKind.TS);
  });
});

// CommonJS + .vue at the scan level (the kiduki-gcs shapes).
describe('codeflow scan — CommonJS + Vue (coverage)', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'codeflow-cjs-'));
    mkdirSync(join(root, 'server', 'services'), { recursive: true });
    mkdirSync(join(root, 'server', 'routes'), { recursive: true });
    mkdirSync(join(root, 'client', 'views'), { recursive: true });
    // CJS module exporting named functions.
    writeFileSync(join(root, 'server', 'services', 'user.service.js'), `module.exports.getUser = function (id) { return id; };\nmodule.exports.saveUser = function (u) { return u; };\n`);
    // CJS consumer: require + namespace member calls.
    writeFileSync(
      join(root, 'server', 'routes', 'users.route.js'),
      `var svc = require('../services/user.service');\nfunction handler(req) { return svc.getUser(req.id); }\nmodule.exports = handler;\n`,
    );
    // Vue SFC (Options API) importing a relative .js.
    writeFileSync(
      join(root, 'client', 'views', 'MapView.vue'),
      `<template>\n  <h1>Mission Map</h1>\n</template>\n<script>\nimport user from '../../server/services/user.service';\nexport default { name: 'MapView', methods: {} };\n</script>\n`,
    );
    // Shadowing: top-level `svc` binds user.service (which HAS getUser), but a function-local `svc`
    // shadows it and calls getUser on the LOCAL object → must NOT emit a calls edge to user.service#getUser.
    writeFileSync(
      join(root, 'server', 'routes', 'shadow.route.js'),
      `var svc = require('../services/user.service');\nfunction handler() { const svc = { getUser() { return 1; } }; return svc.getUser(); }\nmodule.exports = handler;\n`,
    );
    // Vue 3 dual-block SFC: <script setup> (imports) + <script> (Options export default). The component
    // symbol lives in the SECOND block — both must be parsed.
    writeFileSync(
      join(root, 'client', 'views', 'DronePanel.vue'),
      `<template>\n  <h1>Drone Panel</h1>\n</template>\n<script setup>\nimport user from '../../server/services/user.service';\n</script>\n<script>\nexport default { name: 'DronePanel' };\n</script>\n`,
    );
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('CJS: require → imports edge, module.exports.X → symbols', () => {
    const scan = scanRepo({ rootDir: root, repo: 'test/cjs' });
    expect(scan.nodes.some((n) => n.symbol === 'getUser')).toBe(true);
    expect(scan.nodes.some((n) => n.symbol === 'saveUser')).toBe(true);
    const imports = new Set(scan.edges.filter((e) => e.kind === 'imports').map((e) => `${e.srcKey}->${e.dstKey}`));
    expect(imports.has('server/routes/users.route.js->server/services/user.service.js')).toBe(true);
  });

  it('CJS: best-effort member call svc.getUser() → user.service#getUser', () => {
    const c = calls(scanRepo({ rootDir: root, repo: 'test/cjs' }).edges);
    expect(c.has('server/routes/users.route.js->server/services/user.service.js#getUser')).toBe(true);
  });

  it('Vue: SFC yields a file node, a component symbol, and a UI surface', () => {
    const scan = scanRepo({ rootDir: root, repo: 'test/cjs' });
    expect(scan.nodes.some((n) => n.path === 'client/views/MapView.vue' && n.kind === 'file')).toBe(true);
    expect(scan.nodes.some((n) => n.path === 'client/views/MapView.vue' && n.symbol === 'MapView')).toBe(true);
    const fileNode = scan.nodes.find((n) => n.path === 'client/views/MapView.vue' && n.kind === 'file');
    // uiSurface is carried on component features; assert the heading was harvested from <template>.
    const feat = scan.features.find((f) => f.fileKey === 'client/views/MapView.vue');
    expect(feat?.uiSurface ?? '').toContain('Mission Map');
    expect(fileNode).toBeTruthy();
  });

  it('CJS: a function-local shadow of a require-binding does NOT emit a false member-call edge', () => {
    const c = calls(scanRepo({ rootDir: root, repo: 'test/cjs' }).edges);
    // svc.getUser() inside handler() targets the LOCAL object, not the top-level user.service binding.
    expect(c.has('server/routes/shadow.route.js->server/services/user.service.js#getUser')).toBe(false);
  });

  it('Vue: dual-block SFC (<script setup> + <script>) still finds the Options component symbol', () => {
    const scan = scanRepo({ rootDir: root, repo: 'test/cjs' });
    expect(scan.nodes.some((n) => n.path === 'client/views/DronePanel.vue' && n.symbol === 'DronePanel')).toBe(true);
  });
});
