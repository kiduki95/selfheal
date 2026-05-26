import { Db } from '../../src/db/db.js';
import { StubLlmClient } from '../../src/clients/llm/stub.js';
import { LocalEmbeddingClient } from '../../src/clients/embedding/local.js';
import { InMemoryMetrics, type MetricsSink } from '../../src/observability/metrics.js';
import { pipelineVersions } from '../../src/config.js';
import type { PipelineCtx } from '../../src/contracts/stage.js';
import type { RawReview } from '../../src/contracts/raw-review.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Test harness: an isolated `ouroboros_test` database (created/migrated/dropped per run) + a
// PipelineCtx forced onto StubLlmClient + LocalEmbeddingClient → fully deterministic, no claude-cli,
// no API cost. This is what lets every fix be gated by a fast, repeatable test instead of eyeballing.
const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://ouroboros:ouroboros@localhost:5433/ouroboros';
const TEST_DB = process.env.TEST_DB_NAME ?? 'ouroboros_test';
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'db', 'migrations');

function testUrl(): string {
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + TEST_DB;
  return u.toString();
}

// Is a Postgres reachable? Tests skip cleanly (describe.skipIf) when not (e.g., CI without docker).
export async function canConnect(): Promise<boolean> {
  const db = new Db(ADMIN_URL);
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await db.close().catch(() => {});
  }
}

export async function setupTestDb(): Promise<Db> {
  const admin = new Db(ADMIN_URL);
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.close();
  const db = new Db(testUrl());
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.query(readFileSync(join(migrationsDir, f), 'utf8'));
  }
  return db;
}

export async function dropTestDb(db: Db): Promise<void> {
  await db.close();
  const admin = new Db(ADMIN_URL);
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
  await admin.close();
}

// Clear all dynamic rows between tests (keeps schema). Fast isolation without recreating the DB.
export async function truncateAll(db: Db): Promise<void> {
  const rows = await db.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (names) await db.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

// Deterministic context: stub LLM + local (hash) embedder, fixed clock.
export function makeTestCtx(db: Db, metrics: MetricsSink = new InMemoryMetrics()): PipelineCtx {
  return {
    db,
    llm: new StubLlmClient(),
    embedder: new LocalEmbeddingClient(),
    metrics,
    versions: pipelineVersions(),
    now: () => new Date('2026-05-26T00:00:00Z'),
  };
}

let seq = 0;
// Minimal valid RawReview fixture.
export function review(text: string, opts: Partial<Pick<RawReview, 'source' | 'source_id' | 'rating' | 'app_version' | 'platform' | 'locale' | 'created_at'>> = {}): RawReview {
  seq++;
  const t = '2026-05-20T00:00:00Z';
  return {
    source: opts.source ?? 'app_store',
    source_id: opts.source_id ?? `fix-${seq}`,
    text,
    rating: opts.rating,
    app_version: opts.app_version,
    platform: opts.platform,
    locale: opts.locale ?? 'ko',
    created_at: opts.created_at ?? t,
    ingested_at: t,
    raw_payload: {},
  };
}
