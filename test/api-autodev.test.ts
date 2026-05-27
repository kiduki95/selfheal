import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { canConnect, setupTestDb, dropTestDb, truncateAll } from './helpers/testdb.js';
import { createApp } from '../src/api/app.js';
import { config } from '../src/config.js';
import type { Db } from '../src/db/db.js';
import type { ApiEnvelope, AgentRun, AuditEvent } from '../src/api/contract.js';

// v1-c: /api/agents (agent_runs → AgentRun, steps from events) and /api/activity (agent_run_events
// → AuditEvent) are now live. The route reads c.var.repo = config.targetRepo, so we seed under it.
const reachable = await canConnect();
const REPO = config.targetRepo;
const REF = 'sig-api000001';

async function seedRun(db: Db): Promise<string> {
  // Proposal + approval so the title/decision join populates.
  await db.query(
    `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence)
     VALUES ($1,'bug_fix',$2,'[bug] order crash','repro',90,'src/orders',NULL,'{}'::jsonb)`,
    [REPO, REF],
  );
  await db.decideProposal({ repo: REPO, kind: 'bug_fix', ref_id: REF, decision: 'approved' });

  const run = await db.createAgentRun({ repo: REPO, kind: 'bug_fix', ref_id: REF, status: 'queued' });
  const id = run!.id;
  for (const phase of ['preparing', 'planning', 'implementing', 'verifying']) {
    await db.appendRunEvent(id, phase, `${phase} step`, { phase });
  }
  await db.updateAgentRun(id, { status: 'pr_open', branch: 'selfheal/bug_fix-sig-api0', verdict: { ok: true, gates: [], changedFiles: ['src/orders/order.ts', 'src/orders/order.test.ts'] } });
  await db.appendRunEvent(id, 'pr_open', 'handoff', { artifactPath: '/tmp/x.patch' });
  return id;
}

describe.skipIf(!reachable)('Auto-Dev API (v1-c)', () => {
  let db: Db;
  beforeAll(async () => { db = await setupTestDb(); });
  afterAll(async () => { await dropTestDb(db); });
  beforeEach(async () => { await truncateAll(db); });

  it('GET /api/agents maps a run to the AgentRun contract with a step timeline', async () => {
    await seedRun(db);
    const app = createApp(db);
    const res = await app.request('/api/agents');
    expect(res.status).toBe(200);
    const env = (await res.json()) as ApiEnvelope<AgentRun[]>;
    expect(env.source).toBe('live');
    expect(env.data).toHaveLength(1);

    const a = env.data[0]!;
    expect(a.status).toBe('review-needed');     // pr_open → handoff awaiting review
    expect(a.title).toBe('[bug] order crash');  // joined from proposals
    expect(a.skill).toBe('debugging');          // kind → skill
    expect(a.progress).toBe(100);
    expect(a.diff.files).toBe(2);               // verdict.changedFiles count
    expect(a.steps).toHaveLength(5);
    expect(a.steps.every((s) => s.state === 'done')).toBe(true); // pr_open reached → all steps done
  });

  it('GET /api/activity maps run events to AuditEvents', async () => {
    await seedRun(db);
    const app = createApp(db);
    const res = await app.request('/api/activity');
    expect(res.status).toBe(200);
    const env = (await res.json()) as ApiEnvelope<AuditEvent[]>;
    expect(env.data.length).toBe(5); // 4 phases + pr_open

    const handoff = env.data.find((e) => e.type === 'pr_open')!;
    expect(handoff.actorKind).toBe('agent');
    expect(handoff.tone).toBe('good');
    expect(handoff.target).toBe('selfheal/bug_fix-sig-api0');
    expect(handoff.t).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns an empty live list (not 501) when there are no runs', async () => {
    const app = createApp(db);
    const res = await app.request('/api/agents');
    expect(res.status).toBe(200);
    const env = (await res.json()) as ApiEnvelope<AgentRun[]>;
    expect(env.source).toBe('live');
    expect(env.data).toEqual([]);
  });
});
