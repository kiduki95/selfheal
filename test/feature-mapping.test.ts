import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { canConnect, setupTestDb, dropTestDb, truncateAll } from './helpers/testdb.js';
import { mapFeature } from '../src/processing/stages/map-feature.js';
import { StubLlmClient } from '../src/clients/llm/stub.js';
import { LocalEmbeddingClient } from '../src/clients/embedding/local.js';
import { toSqlVector } from '../src/util/vector.js';
import type { Db } from '../src/db/db.js';
import type { MapFeatureInput } from '../src/clients/llm/types.js';

// #6 scalability: feature candidates must be ANN-shortlisted (bounded K) so the Claude-judge payload
// stays fixed regardless of repo size, while still recalling the right feature.
const reachable = await canConnect();
const embedder = new LocalEmbeddingClient();

async function seedLeaf(db: Db, repo: string, parentId: string, i: number, label: string, desc: string): Promise<string> {
  const e = await embedder.embed(`${label} ${desc}`);
  const r = await db.query<{ id: string }>(
    `INSERT INTO feature_registry (canonical_slug, pref_label, description, embedding, origin, status, repo, parent_id)
     VALUES ($1,$2,$3,$4::vector,'code_derived','grounded',$5,$6) RETURNING id`,
    [`${repo}#code.mod.${i}`, label, desc, toSqlVector(e.vector), repo, parentId],
  );
  return r[0]!.id;
}

describe.skipIf(!reachable)('feature mapping shortlist (#6 scalability)', () => {
  let db: Db;
  const repo = 'test/repo';
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  async function seedLargeRegistry(n: number): Promise<string> {
    const pe = await embedder.embed('module parent');
    const p = await db.query<{ id: string }>(
      `INSERT INTO feature_registry (canonical_slug, pref_label, description, embedding, origin, status, repo)
       VALUES ($1,$2,$3,$4::vector,'code_derived','grounded',$5) RETURNING id`,
      [`${repo}#code.mod`, 'mod', 'module', toSqlVector(pe.vector), repo],
    );
    const parentId = p[0]!.id;
    const target = await seedLeaf(db, repo, parentId, 0, '주가 차트', '실시간 주가 차트와 캔들 표시');
    for (let i = 1; i < n; i++) await seedLeaf(db, repo, parentId, i, `기능${i}`, `임의 기능 설명 ${i}`);
    return target;
  }

  it('shortlist is bounded by K regardless of registry size, and recalls the target', async () => {
    const targetId = await seedLargeRegistry(150); // way more than K
    const rv = (await embedder.embed('주가 차트가 안 떠요 계속 빈 화면입니다')).vector;
    const shortlist = await db.featureCandidatesByVector(repo, rv, 30);
    expect(shortlist.length).toBe(30); // bounded — not 150
    expect(shortlist.map((s) => s.feature_id)).toContain(targetId); // recall@30
  });

  it('mapFeature sends only the bounded shortlist to the judge (payload capped)', async () => {
    await seedLargeRegistry(150);
    let seenCandidates = -1;
    class SpyLlm extends StubLlmClient {
      async mapFeature(i: MapFeatureInput) { seenCandidates = i.candidates.length; return super.mapFeature(i); }
    }
    const rv = (await embedder.embed('주가 차트가 안 떠요')).vector;
    await mapFeature({ text: '주가 차트가 안 떠요', affected_area: null, category: 'bug', mentions: [], reviewVector: rv }, db, new SpyLlm(), repo);
    expect(seenCandidates).toBeGreaterThan(0);
    expect(seenCandidates).toBeLessThanOrEqual(30); // bounded, not 150
  });
});
