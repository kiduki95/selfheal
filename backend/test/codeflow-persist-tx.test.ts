import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { canConnect, setupTestDb, dropTestDb } from './helpers/testdb.js';
import { persistScan } from '../src/codeflow/persist.js';
import { LocalEmbeddingClient } from '../src/clients/embedding/local.js';
import { EMBED_DIM } from '../src/config.js';
import type { Db } from '../src/db/db.js';
import type { EmbeddingClient } from '../src/clients/embedding/types.js';
import type { ScanResult } from '../src/codeflow/scan.js';

// S2 (deferred review finding): persistScan does DELETE-then-rebuild. It must run in one transaction
// so a mid-scan failure rolls back to the prior graph instead of leaving the repo half-wiped.
const reachable = await canConnect();
const REPO = 'test/codeflow-tx';

function fixtureScan(): ScanResult {
  return {
    repo: REPO,
    ref: 'workdir',
    nodes: [
      { key: 'a.ts', kind: 'file', path: 'a.ts', module: 'm', symbol: null, signature: null, description: 'file a', contentHash: 'h1' },
      { key: 'a.ts#Foo', kind: 'symbol', path: 'a.ts', module: 'm', symbol: 'Foo', symbolKind: 'function', signature: 'function Foo()', description: 'Foo', contentHash: 'h2' },
    ],
    edges: [{ srcKey: 'a.ts', dstKey: 'a.ts#Foo', kind: 'contains' }],
    features: [],
    smells: [],
    cochange: [],
  };
}

// Throws on the Nth embed() call → forces a failure after the in-transaction DELETE has run.
class FailingEmbedder implements EmbeddingClient {
  readonly kind = 'local' as const;
  readonly model = 'failing';
  private n = 0;
  constructor(private readonly failAt: number) {}
  async embed(): Promise<{ vector: number[]; model: string; dim: number }> {
    if (++this.n >= this.failAt) throw new Error('boom');
    return { vector: new Array(EMBED_DIM).fill(0), model: 'failing', dim: EMBED_DIM };
  }
}

async function artifactCount(db: Db): Promise<number> {
  const r = await db.query<{ n: string }>(`SELECT count(*) n FROM code_artifact_registry WHERE repo = $1`, [REPO]);
  return Number(r[0]!.n);
}

describe.skipIf(!reachable)('persistScan transaction', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => {
    await db.query(`DELETE FROM code_edges WHERE repo = $1`, [REPO]);
    await db.query(`DELETE FROM code_artifact_registry WHERE repo = $1`, [REPO]);
    await db.query(`DELETE FROM codeflow_runs WHERE repo = $1`, [REPO]);
  });

  it('persists the full graph on success', async () => {
    const stats = await persistScan(fixtureScan(), db, new LocalEmbeddingClient());
    expect(stats.nodes).toBe(2);
    expect(await artifactCount(db)).toBe(2);
  });

  it('rolls back to the prior graph when the rebuild fails mid-scan', async () => {
    await persistScan(fixtureScan(), db, new LocalEmbeddingClient()); // seed a good graph (2 nodes)
    expect(await artifactCount(db)).toBe(2);

    // failAt=2 → DELETE runs, first node inserts, second node's embed throws inside the tx.
    await expect(persistScan(fixtureScan(), db, new FailingEmbedder(2))).rejects.toThrow('boom');

    // The DELETE was rolled back: the prior graph is intact, not half-wiped.
    expect(await artifactCount(db)).toBe(2);
    const failed = await db.query<{ n: string }>(`SELECT count(*) n FROM codeflow_runs WHERE repo=$1 AND status='failed'`, [REPO]);
    expect(Number(failed[0]!.n)).toBe(1); // run record preserved with failed status (outside the tx)
  });
});
