import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { canConnect, setupTestDb, dropTestDb, truncateAll } from './helpers/testdb.js';
import { persistScan } from '../src/codeflow/persist.js';
import { runInsight } from '../src/insight/index.js';
import { StubLlmClient } from '../src/clients/llm/stub.js';
import { LocalEmbeddingClient } from '../src/clients/embedding/local.js';
import type { ScanResult } from '../src/codeflow/scan.js';
import type { Db } from '../src/db/db.js';

// Code-health P2: refactor proposals from persisted smells. We persist a scan carrying a god/hotspot file
// (+ a complex-function symbol on the SAME path), then assert the file-grouped candidate query and the
// runInsight refactor proposal (stable ref_id = path) behave as designed.
const reachable = await canConnect();
const REPO = 'test/refactor';
const embedder = new LocalEmbeddingClient();

function scanWithSmells(): ScanResult {
  return {
    repo: REPO,
    ref: 'workdir',
    nodes: [
      { key: 'src/big.js', kind: 'file', path: 'src/big.js', module: 'src', symbol: null, signature: null, description: 'big file', contentHash: 'h1',
        metrics: { loc: 900, cyclomatic: 120, fanIn: 2, fanOut: 1, churnCommits: 8, churnDays: 3, hasTest: false, health: 8 } },
      { key: 'src/big.js#mega', kind: 'symbol', path: 'src/big.js', module: 'src', symbol: 'mega', symbolKind: 'function', signature: 'function mega()', description: 'mega', contentHash: 'h2',
        metrics: { loc: 200, cyclomatic: 40 } },
      { key: 'src/clean.js', kind: 'file', path: 'src/clean.js', module: 'src', symbol: null, signature: null, description: 'clean', contentHash: 'h3',
        metrics: { loc: 30, cyclomatic: 3, fanIn: 0, fanOut: 0, churnCommits: 0, churnDays: 0, hasTest: true, health: 100 } },
    ],
    edges: [{ srcKey: 'src/big.js', dstKey: 'src/big.js#mega', kind: 'contains' }],
    features: [],
    // god_file + hotspot on the FILE; complex_function on the SYMBOL (same path → aggregates into the file).
    smells: [
      { artifactKey: 'src/big.js', kind: 'god_file', severity: 'critical', score: 100, evidence: { loc: 900, cyclomatic: 120 } },
      { artifactKey: 'src/big.js', kind: 'untested_hotspot', severity: 'high', score: 70, evidence: { churn: 8, cyclomatic: 120, fan_in: 2 } },
      { artifactKey: 'src/big.js#mega', kind: 'complex_function', severity: 'medium', score: 45, evidence: { cyclomatic: 40 } },
    ],
  };
}

describe.skipIf(!reachable)('code-health P2: refactor candidates + proposals', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); await persistScan(scanWithSmells(), db, embedder); });

  it('refactorCandidates groups smells per file (incl. its symbols) with file metrics; clean files excluded', async () => {
    const cands = await db.refactorCandidates(REPO);
    expect(cands).toHaveLength(1); // only the unhealthy file; clean.js has no smell
    const c = cands[0]!;
    expect(c.path).toBe('src/big.js');
    expect(c.kinds.sort()).toEqual(['complex_function', 'god_file', 'untested_hotspot']); // symbol smell folded in
    expect(c.max_score).toBe(100);
    expect(c.loc).toBe(900); // metrics come from the FILE row, not the symbol
    expect(c.churn_commits).toBe(8);
    expect(c.health_score).toBe(8);
  });

  it('runInsight emits a refactor proposal with a stable path ref_id and debt-interest priority', async () => {
    await runInsight(db, new StubLlmClient(), REPO);
    const rows = await db.query<{ ref_id: string; priority: string; target_module: string; evidence: any; title: string }>(
      `SELECT ref_id, priority::text, target_module, evidence, title FROM proposals WHERE repo=$1 AND kind='refactor'`,
      [REPO],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ref_id).toBe('src/big.js'); // stable across re-scans (path, not regenerated artifact id)
    expect(rows[0]!.target_module).toBe('src');
    expect(Number(rows[0]!.priority)).toBeGreaterThan(50); // smell 100 × churn-8 interest × 0.85 ≈ 80 (critical)
    expect(rows[0]!.evidence.smells).toHaveLength(3);
  });

  it('re-running insight keeps one refactor proposal (clear+regenerate, stable ref_id)', async () => {
    await runInsight(db, new StubLlmClient(), REPO);
    await runInsight(db, new StubLlmClient(), REPO);
    const n = await db.query<{ n: string }>(`SELECT count(*) n FROM proposals WHERE repo=$1 AND kind='refactor'`, [REPO]);
    expect(Number(n[0]!.n)).toBe(1);
  });
});
