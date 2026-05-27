import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { cyclomaticComplexity, loc, fileLoc } from '../src/codeflow/metrics.js';
import { detectSmells, healthFromSmells, type ArtifactMetric } from '../src/codeflow/smells.js';
import { scanRepo } from '../src/codeflow/scan.js';

// Pure code-health units — no DB. Metrics (AST), smell thresholds, and scan-level wiring.

describe('metrics (cyclomatic + loc)', () => {
  const fn = (code: string): ts.Node => {
    const sf = ts.createSourceFile('m.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return sf.statements[0]!;
  };
  it('counts decision points (+1 base): if, for, &&, ?:', () => {
    // base 1 + if + for + && + ?: = 5
    const c = cyclomaticComplexity(fn(`function f(a, b) { if (a) return 1; for (;;) {} return a && b ? 1 : 2; }`));
    expect(c).toBe(5);
  });
  it('a straight-line function is complexity 1', () => {
    expect(cyclomaticComplexity(fn(`function f() { return 1; }`))).toBe(1);
  });
  it('loc spans the node lines; fileLoc counts the whole source', () => {
    const sf = ts.createSourceFile('m.ts', `function f() {\n  return 1;\n}\n`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(loc(sf.statements[0]!, sf)).toBe(3);
    expect(fileLoc(sf)).toBeGreaterThanOrEqual(3);
  });
});

describe('detectSmells (thresholds)', () => {
  const file = (over: Partial<ArtifactMetric>): ArtifactMetric => ({
    key: 'f.js', kind: 'file', loc: 100, cyclomatic: 5, fanIn: 0, fanOut: 0, churnCommits: 0, hasTest: true, symbolCount: 3, ...over,
  });
  it('god_file needs BOTH large size AND many symbols/complexity', () => {
    expect(detectSmells([file({ loc: 800, symbolCount: 30 })]).some((s) => s.kind === 'god_file')).toBe(true);
    expect(detectSmells([file({ loc: 800, symbolCount: 3, cyclomatic: 5 })]).some((s) => s.kind === 'god_file')).toBe(false); // big but simple
    expect(detectSmells([file({ loc: 100, symbolCount: 30 })]).some((s) => s.kind === 'god_file')).toBe(false); // many symbols but small
  });
  it('complex_function fires on a symbol over the cyclomatic threshold', () => {
    const sym: ArtifactMetric = { key: 'f.js#big', kind: 'symbol', symbolKind: 'function', loc: 50, cyclomatic: 20, fanIn: 0, fanOut: 0, churnCommits: 0, hasTest: true };
    expect(detectSmells([sym]).find((s) => s.kind === 'complex_function')?.severity).toBeDefined();
    expect(detectSmells([{ ...sym, cyclomatic: 10 }]).some((s) => s.kind === 'complex_function')).toBe(false);
    // a class's cyclomatic is the SUM over its methods — must NOT be mislabeled complex_function.
    expect(detectSmells([{ ...sym, symbolKind: 'class', cyclomatic: 25 }]).some((s) => s.kind === 'complex_function')).toBe(false);
  });
  it('untested_hotspot = churn × complexity on an UNtested file; has_test suppresses it', () => {
    const hot = file({ churnCommits: 12, cyclomatic: 25, fanIn: 4, hasTest: false });
    const s = detectSmells([hot]).find((x) => x.kind === 'untested_hotspot');
    expect(s).toBeDefined();
    expect(s!.score).toBeGreaterThanOrEqual(25);
    expect(detectSmells([{ ...hot, hasTest: true }]).some((x) => x.kind === 'untested_hotspot')).toBe(false); // tested → no hotspot
    expect(detectSmells([{ ...hot, churnCommits: 0 }]).some((x) => x.kind === 'untested_hotspot')).toBe(false); // no churn → no hotspot
  });
  it('healthFromSmells compounds scores (100 - Σ, clamped)', () => {
    expect(healthFromSmells([])).toBe(100);
    expect(healthFromSmells([40, 30])).toBe(30);
    expect(healthFromSmells([90, 50])).toBe(0); // clamped
  });
});

describe('scan-level code-health wiring', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'codeflow-health-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    // A complex, untested function (16 branches → cyclomatic 17 > 15).
    const big = `export function big(x) {\n` + Array.from({ length: 16 }, (_, i) => `  if (x === ${i}) return ${i};`).join('\n') + `\n  return -1;\n}\n`;
    writeFileSync(join(root, 'src', 'm.js'), big);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('per-symbol cyclomatic + per-file metrics flow into nodes', () => {
    const scan = scanRepo({ rootDir: root, repo: 'test/health' });
    const sym = scan.nodes.find((n) => n.key === 'src/m.js#big');
    expect(sym?.metrics?.cyclomatic).toBe(17);
    const file = scan.nodes.find((n) => n.key === 'src/m.js' && n.kind === 'file');
    expect(file?.metrics?.loc).toBeGreaterThan(15);
    expect(file?.metrics?.cyclomatic).toBeGreaterThanOrEqual(17);
    expect(typeof file?.metrics?.health).toBe('number');
  });

  it('detects complex_function, and untested_hotspot when churn is injected', () => {
    const withChurn = scanRepo({ rootDir: root, repo: 'test/health', churn: new Map([['src/m.js', { commits: 10, days: 5 }]]) });
    expect(withChurn.smells.some((s) => s.kind === 'complex_function' && s.artifactKey === 'src/m.js#big')).toBe(true);
    expect(withChurn.smells.some((s) => s.kind === 'untested_hotspot' && s.artifactKey === 'src/m.js')).toBe(true);
    // No churn injected → no hotspot (but the complex_function still stands).
    const noChurn = scanRepo({ rootDir: root, repo: 'test/health' });
    expect(noChurn.smells.some((s) => s.kind === 'untested_hotspot')).toBe(false);
    expect(noChurn.smells.some((s) => s.kind === 'complex_function')).toBe(true);
  });
});
