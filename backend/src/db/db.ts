import pg from 'pg';
import { config } from '../config.js';
import { toSqlVector } from '../util/vector.js';
import { deriveTrend } from '../util/trend.js';
import type { Inferences, ProcessedReview } from '../contracts/processed-review.js';

const { Pool } = pg;

// Minimal query surface a transaction callback runs against (same shape as Db.query).
export interface Tx {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface RawReviewRow {
  id: string;
  source: string;
  source_id: string;
  payload: any;
}

export interface SemanticCacheHit {
  inferences: Inferences;
  cosine: number;
  source_review_id: string;
}

export interface RegistryMatch {
  id: string;
  slug?: string;
  cosine: number;
}

export interface CodeMatch {
  id: string;
  cosine: number;
  owners: string[];
  via: 'feature_link' | 'semantic_match' | 'historical_signature';
}

// Auto-Dev run statuses considered terminal (claim released, no reaping). `pr_open` is the dry-run
// success/handoff terminal (spec §2) — it MUST be here so the reaper never flips a finished handoff to
// timed_out and so updateAgentRun stamps ended_at on it. The partial-unique index predicate
// (008_autodev.sql), createAgentRun's ON CONFLICT WHERE, and reapStaleRuns are all derived from this
// one list (TERMINAL_SQL) so the four sets can never drift apart.
export const TERMINAL_RUN_STATUSES = ['pr_open', 'succeeded', 'failed', 'timed_out', 'rejected_by_verifier', 'canceled'] as const;
// SQL list literal built from the constant above (compile-time values only — no injection surface).
const TERMINAL_SQL = TERMINAL_RUN_STATUSES.map((s) => `'${s}'`).join(',');

export interface AgentRunRow {
  id: string;
  repo: string;
  kind: string;
  ref_id: string;
  branch: string | null;
  base_sha: string | null;
  status: string;
  attempt: number;
  workspace_path: string | null;
  pr_url: string | null;
  verdict: any;
  tokens: number | null;
  error: string | null;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

// pg는 bigint/numeric를 string으로 주므로 cosine 계산은 SQL에서 끝낸다.
export class Db {
  private pool: pg.Pool;
  constructor(connectionString = config.databaseUrl) {
    this.pool = new Pool({ connectionString });
  }
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params as any[]);
    return res.rows as T[];
  }
  async close() {
    await this.pool.end();
  }

  // Run `fn` inside a single BEGIN/COMMIT on a dedicated client; ROLLBACK on throw. The callback
  // gets a Tx with the same query() shape so call sites stay identical. Used by destructive rebuilds
  // (e.g. codeflow persistScan) so a mid-scan failure can't leave the graph half-wiped.
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Tx = {
        async query<R = any>(sql: string, params: unknown[] = []): Promise<R[]> {
          const res = await client.query(sql, params as any[]);
          return res.rows as R[];
        },
      };
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be gone; pool will discard it */ }
      throw e;
    } finally {
      client.release();
    }
  }

  // --- raw_reviews ---
  async insertRawReview(source: string, source_id: string, payload: unknown, ingested_at: string): Promise<RawReviewRow> {
    const rows = await this.query<RawReviewRow>(
      `INSERT INTO raw_reviews (source, source_id, payload, ingested_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (source, source_id) DO UPDATE SET payload = EXCLUDED.payload
       RETURNING id, source, source_id, payload`,
      [source, source_id, JSON.stringify(payload), ingested_at],
    );
    return rows[0]!;
  }
  async setSimhash(rawReviewId: string, simhash: string) {
    await this.query(`UPDATE raw_reviews SET simhash = $2::bit(64) WHERE id = $1`, [rawReviewId, simhash]);
  }
  async markFiltered(rawReviewId: string, reason: string) {
    await this.query(`UPDATE raw_reviews SET is_filtered = true, filter_reason = $2, processed_at = now() WHERE id = $1`, [rawReviewId, reason]);
  }
  async markDuplicate(rawReviewId: string, duplicateOf: string) {
    await this.query(`UPDATE raw_reviews SET duplicate_of = $2, processed_at = now() WHERE id = $1`, [rawReviewId, duplicateOf]);
  }
  async markProcessed(rawReviewId: string) {
    await this.query(`UPDATE raw_reviews SET processed_at = now(), processing_error = NULL WHERE id = $1`, [rawReviewId]);
  }
  async markError(rawReviewId: string, error: string) {
    await this.query(`UPDATE raw_reviews SET processing_error = $2, retry_count = retry_count + 1 WHERE id = $1`, [rawReviewId, error]);
  }

  // --- review_stage_outputs (version-aware cache) ---
  async getStageOutput(rawReviewId: string, stageName: string, inputHash: string): Promise<any | null> {
    const rows = await this.query(
      `SELECT output FROM review_stage_outputs WHERE raw_review_id = $1 AND stage_name = $2 AND input_hash = $3`,
      [rawReviewId, stageName, inputHash],
    );
    return rows[0]?.output ?? null;
  }
  async putStageOutput(rawReviewId: string, stageName: string, stageVersion: string, inputHash: string, output: unknown, llmCall: unknown, durationMs: number) {
    await this.query(
      `INSERT INTO review_stage_outputs (raw_review_id, stage_name, stage_version, input_hash, output, llm_call, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (raw_review_id, stage_name, stage_version)
       DO UPDATE SET input_hash = EXCLUDED.input_hash, output = EXCLUDED.output, llm_call = EXCLUDED.llm_call, duration_ms = EXCLUDED.duration_ms, created_at = now()`,
      [rawReviewId, stageName, stageVersion, inputHash, JSON.stringify(output), llmCall ? JSON.stringify(llmCall) : null, durationMs],
    );
  }

  // --- dedup ---
  // SimHash 후보: Hamming ≤ threshold (어휘적). 자기 자신·이미 dup 처리된 것 제외.
  async simhashCandidates(rawReviewId: string, simhash: string, hamming: number): Promise<{ id: string }[]> {
    return this.query(
      `SELECT id FROM raw_reviews
       WHERE id <> $1 AND simhash IS NOT NULL AND duplicate_of IS NULL AND NOT is_filtered
         AND bit_count(simhash # $2::bit(64)) <= $3
       ORDER BY bit_count(simhash # $2::bit(64)) ASC LIMIT 5`,
      [rawReviewId, simhash, hamming],
    );
  }
  // 의미 후보(ANN): processed_reviews와 join, cosine 내림차순 top-k. 자기 자신(reprocess) 제외.
  async annNeighbors(vector: number[], k: number, excludeRawReviewId: string): Promise<{ raw_review_id: string; cosine: number }[]> {
    return this.query(
      `SELECT pr.raw_review_id, 1 - (e.embedding <=> $1::vector) AS cosine
       FROM review_embeddings e JOIN processed_reviews pr ON pr.id = e.processed_review_id
       WHERE pr.raw_review_id <> $3
       ORDER BY e.embedding <=> $1::vector ASC LIMIT $2`,
      [toSqlVector(vector), k, excludeRawReviewId],
    );
  }

  // --- semanticCache (4.5b) ---
  // 동일 classifier_version + cosine ≥ threshold + 고신뢰 적재분만 (poisoning 방어 #7).
  async semanticCacheLookup(vector: number[], threshold: number, classifierVersion: string, minConf: number, excludeRawReviewId: string): Promise<SemanticCacheHit | null> {
    // threshold 비교는 JS에서 (SQL은 최근접 1건만 가져옴)
    const rows = await this.query(
      `SELECT pr.id AS source_review_id, pr.inferences,
              1 - (e.embedding <=> $1::vector) AS cosine
       FROM review_embeddings e JOIN processed_reviews pr ON pr.id = e.processed_review_id
       WHERE pr.classifier_version = $2
         AND pr.raw_review_id <> $4
         AND (pr.inferences->'classification'->>'category_confidence')::float >= $3
       ORDER BY e.embedding <=> $1::vector ASC LIMIT 1`,
      [toSqlVector(vector), classifierVersion, minConf, excludeRawReviewId],
    );
    const r = rows[0];
    if (r && r.cosine >= threshold) return { inferences: r.inferences, cosine: r.cosine, source_review_id: r.source_review_id };
    return null;
  }

  // --- feature / code registry matching ---
  async featureExactMatch(mention: string): Promise<RegistryMatch | null> {
    const norm = mention.toLowerCase().trim();
    const rows = await this.query<RegistryMatch>(
      `SELECT id, canonical_slug AS slug, 1.0 AS cosine FROM feature_registry
       WHERE is_active AND (lower(pref_label) = $1 OR $1 = ANY (SELECT lower(unnest(alt_labels)))) LIMIT 1`,
      [norm],
    );
    return rows[0] ?? null;
  }
  async featureVectorMatch(vector: number[]): Promise<RegistryMatch[]> {
    return this.query<RegistryMatch>(
      `SELECT id, canonical_slug AS slug, 1 - (embedding <=> $1::vector) AS cosine
       FROM feature_registry WHERE is_active AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC LIMIT 3`,
      [toSqlVector(vector)],
    );
  }
  // feature → 코드 앵커. 모듈 노드(대표)를 우선 반환 → grounding을 모듈 1개로 깔끔하게.
  // 모듈 노드가 없으면(구버전 데이터) 파일 노드로 degrade.
  async codeMatchByFeatures(featureIds: string[]): Promise<CodeMatch[]> {
    if (featureIds.length === 0) return [];
    const mods = await this.query<CodeMatch>(
      `SELECT id, 1.0 AS cosine, owners, 'feature_link' AS via FROM code_artifact_registry
       WHERE is_active AND kind = 'module' AND feature_ids && $1::uuid[]`,
      [featureIds],
    );
    if (mods.length) return mods;
    return this.query<CodeMatch>(
      `SELECT DISTINCT ON (path) id, 1.0 AS cosine, owners, 'feature_link' AS via FROM code_artifact_registry
       WHERE is_active AND kind = 'file' AND feature_ids && $1::uuid[] ORDER BY path LIMIT 6`,
      [featureIds],
    );
  }
  async codeMatchByVector(vector: number[]): Promise<CodeMatch[]> {
    return this.query<CodeMatch>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS cosine, owners, 'semantic_match' AS via
       FROM code_artifact_registry WHERE is_active AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC LIMIT 3`,
      [toSqlVector(vector)],
    );
  }
  // Impact / blast-radius (codegraph-style): how many distinct files call each symbol, joined with risk.
  // High callers x high risk = high blast radius → feeds Insight priority / Auto-Dev "what breaks if I touch this".
  async codeBlastRadius(repo: string, limit = 20): Promise<{ path: string; symbol: string | null; module: string; risk_tier: string; callers: number }[]> {
    const rows = await this.query<{ path: string; symbol: string | null; module: string; risk_tier: string; callers: string }>(
      `SELECT a.path, a.symbol, a.module, a.risk_tier, count(DISTINCT e.src_id) AS callers
       FROM code_artifact_registry a JOIN code_edges e ON e.dst_id = a.id AND e.kind = 'calls'
       WHERE a.repo = $1 AND a.is_active
       GROUP BY a.id ORDER BY callers DESC, a.risk_tier DESC LIMIT $2`,
      [repo, limit],
    );
    return rows.map((r) => ({ path: r.path, symbol: r.symbol, module: r.module, risk_tier: r.risk_tier, callers: Number(r.callers) }));
  }

  // --- P1: feature mapping (Claude-as-judge) ---
  // 타깃 repo의 grounded feature 후보 전체 (소규모 codebase는 임베딩 추림 없이 전부 LLM에).
  async featureCandidates(targetRepo: string, limit = 90): Promise<{ feature_id: string; label: string; description: string }[]> {
    // 컴포넌트 + sub-feature 둘 다 후보(모듈만 제외). Claude가 적절한 granularity를 고름 —
    // 일반적 리뷰는 컴포넌트, 구체적 리뷰는 sub-feature로. parent 경로를 라벨에 붙여 맥락 제공.
    const rows = await this.query<{ feature_id: string; label: string; description: string; parent: string | null }>(
      `SELECT f.id AS feature_id, f.pref_label AS label, COALESCE(f.description,'') AS description, p.pref_label AS parent
       FROM feature_registry f LEFT JOIN feature_registry p ON f.parent_id = p.id
       WHERE f.status='grounded' AND f.repo=$1 AND f.parent_id IS NOT NULL ORDER BY f.pref_label LIMIT $2`,
      [targetRepo, limit],
    );
    return rows.map((r) => ({ feature_id: r.feature_id, label: r.parent ? `${r.parent} › ${r.label}` : r.label, description: r.description }));
  }
  // Scalable variant: ANN-shortlist candidates by embedding distance to the review vector, capped at k.
  // This is what keeps the Claude-judge payload bounded for large repos (vs sending every feature).
  async featureCandidatesByVector(targetRepo: string, vector: number[], k = 30): Promise<{ feature_id: string; label: string; description: string }[]> {
    const rows = await this.query<{ feature_id: string; label: string; description: string; parent: string | null }>(
      `SELECT f.id AS feature_id, f.pref_label AS label, COALESCE(f.description,'') AS description, p.pref_label AS parent
       FROM feature_registry f LEFT JOIN feature_registry p ON f.parent_id = p.id
       WHERE f.status='grounded' AND f.repo=$1 AND f.parent_id IS NOT NULL AND f.embedding IS NOT NULL
       ORDER BY f.embedding <=> $2::vector ASC LIMIT $3`,
      [targetRepo, toSqlVector(vector), k],
    );
    return rows.map((r) => ({ feature_id: r.feature_id, label: r.parent ? `${r.parent} › ${r.label}` : r.label, description: r.description }));
  }
  // gap = review-emergent floating feature. 후속 클러스터/promote는 P2.
  async upsertEmergentFeature(label: string, normalized: string, targetRepo: string): Promise<string> {
    const rows = await this.query<{ id: string }>(
      `INSERT INTO feature_registry (canonical_slug, pref_label, origin, status, repo)
       VALUES ($1,$2,'review_emergent','gap',$3)
       ON CONFLICT (canonical_slug) DO UPDATE SET pref_label = EXCLUDED.pref_label
       RETURNING id`,
      [`gap:${targetRepo}:${normalized}`.slice(0, 200), label, targetRepo],
    );
    return rows[0]!.id;
  }

  // --- unmatched feature candidates ---
  async upsertUnmatchedCandidate(rawMention: string, normalized: string, vector: number[], reviewId: string) {
    await this.query(
      `INSERT INTO unmatched_feature_candidates (raw_mention, normalized, embedding, example_review_ids)
       VALUES ($1,$2,$3::vector,ARRAY[$4]::uuid[])
       ON CONFLICT (normalized) DO UPDATE
         SET occurrence_count = unmatched_feature_candidates.occurrence_count + 1,
             last_seen = now(),
             example_review_ids = (unmatched_feature_candidates.example_review_ids || $4::uuid)`,
      [rawMention, normalized, toSqlVector(vector), reviewId],
    );
  }

  // --- human review queue ---
  async enqueueHumanReview(rawReviewId: string, reason: string, payload: unknown) {
    await this.query(`INSERT INTO human_review_queue (raw_review_id, reason, payload) VALUES ($1,$2,$3)`, [rawReviewId, reason, JSON.stringify(payload ?? {})]);
  }

  // === Phase 2: signal_groups (aggregateSignal §4.8b) ===

  // canonical error_signature 일치 + code_artifact 교집합(또는 그룹이 artifact 없음) — 가장 강한 그룹 키.
  async findGroupByCanonical(canonical: string, artifactIds: string[]): Promise<{ id: string } | null> {
    const rows = await this.query<{ id: string }>(
      `SELECT id FROM signal_groups
       WHERE status = 'open' AND error_signature = $1
         AND (code_artifact_ids = '{}' OR $2::uuid[] = '{}' OR code_artifact_ids && $2::uuid[])
       ORDER BY corroboration_count DESC, first_seen ASC, id ASC LIMIT 1`,
      [canonical, artifactIds],
    );
    return rows[0] ?? null;
  }

  // representative(medoid) 기준 cosine 최근접 그룹 + artifact 교집합 (complete-linkage 근사).
  async annGroups(vector: number[], artifactIds: string[]): Promise<{ id: string; cosine: number; max_radius: number | null }[]> {
    return this.query(
      `SELECT id, 1 - (representative_embedding <=> $1::vector) AS cosine, max_radius
       FROM signal_groups
       WHERE status = 'open' AND representative_embedding IS NOT NULL
         AND ($2::uuid[] = '{}' OR code_artifact_ids = '{}' OR code_artifact_ids && $2::uuid[])
       ORDER BY representative_embedding <=> $1::vector ASC, id ASC LIMIT 3`,
      [toSqlVector(vector), artifactIds],
    );
  }

  async createSignalGroup(p: {
    repReviewId: string; embedding: number[]; canonical: string | null; artifactIds: string[];
    regressionHint: string | null; firstSeen: string;
  }): Promise<string> {
    const rows = await this.query<{ id: string }>(
      `INSERT INTO signal_groups
         (representative_review_id, representative_embedding, centroid, max_radius, error_signature,
          code_artifact_ids, regression_version_hint, trend, first_seen, last_seen)
       VALUES ($1,$2::vector,$2::vector,0,$3,$4::uuid[],$5,'new',$6,$6)
       RETURNING id`,
      [p.repReviewId, toSqlVector(p.embedding), p.canonical, p.artifactIds, p.regressionHint, p.firstSeen],
    );
    return rows[0]!.id;
  }

  // 멤버십(processed_reviews.signal_group_id)에서 집계 파생 — self 제외(reprocess 멱등).
  async groupMemberAggregates(groupId: string, excludePrId: string): Promise<{ count: number; versions: string[]; platforms: string[] }> {
    const rows = await this.query<{ n: number; versions: string[]; platforms: string[] }>(
      `SELECT count(*)::int AS n,
              array_remove(array_agg(DISTINCT facts->>'app_version'), NULL) AS versions,
              array_remove(array_agg(DISTINCT facts->>'platform'), NULL) AS platforms
       FROM processed_reviews WHERE signal_group_id = $1 AND id <> $2`,
      [groupId, excludePrId],
    );
    const r = rows[0]!;
    return { count: r.n, versions: r.versions ?? [], platforms: r.platforms ?? [] };
  }

  async updateGroupAggregates(groupId: string, p: {
    count: number; versions: string[]; platforms: string[]; trend: string; lastSeen: string; newMemberVector: number[];
  }): Promise<void> {
    await this.query(
      `UPDATE signal_groups SET
         corroboration_count = $2,
         affected_versions = $3,
         affected_platforms = $4,
         trend = $5,
         last_seen = GREATEST(last_seen, $6::timestamptz),
         max_radius = GREATEST(COALESCE(max_radius,0), (representative_embedding <=> $7::vector))
       WHERE id = $1`,
      [groupId, p.count, p.versions, p.platforms, p.trend, p.lastSeen, toSqlVector(p.newMemberVector)],
    );
  }

  async setReviewSignal(prId: string, signal: unknown): Promise<void> {
    await this.query(`UPDATE processed_reviews SET inferences = jsonb_set(inferences, '{signal}', $2::jsonb) WHERE id = $1`, [prId, JSON.stringify(signal)]);
  }

  async writeSignalEvent(groupId: string, eventType: string, payload: unknown, actor: string): Promise<void> {
    await this.query(`INSERT INTO signal_group_events (signal_group_id, event_type, payload, actor) VALUES ($1,$2,$3,$4)`, [groupId, eventType, JSON.stringify(payload ?? {}), actor]);
  }

  // Recompute trend for all open groups from member report times vs wall-clock now (#4).
  // This is what makes 'stable'/'declining' reachable — the inline pass only sets provisional new/rising.
  async recomputeTrends(now: Date): Promise<void> {
    const groups = await this.query<{ id: string; times: (string | null)[] }>(
      `SELECT g.id, array_agg(pr.facts->>'created_at') AS times
       FROM signal_groups g JOIN processed_reviews pr ON pr.signal_group_id = g.id
       WHERE g.status = 'open' GROUP BY g.id`,
    );
    for (const g of groups) {
      const times = (g.times ?? []).filter((s): s is string => !!s).map((s) => Date.parse(s)).filter((n) => Number.isFinite(n));
      await this.query(`UPDATE signal_groups SET trend = $2 WHERE id = $1`, [g.id, deriveTrend(times, now.getTime())]);
    }
  }
  // Freshness stamps (#2): latest processing time vs latest proposal generation time.
  async processingStamps(repo: string): Promise<{ lastProcessed: string | null; lastProposal: string | null }> {
    const p = await this.query<{ t: string | null }>(`SELECT max(processed_at)::text AS t FROM processed_reviews`);
    const q = await this.query<{ t: string | null }>(`SELECT max(created_at)::text AS t FROM proposals WHERE repo = $1`, [repo]);
    return { lastProcessed: p[0]?.t ?? null, lastProposal: q[0]?.t ?? null };
  }
  // --- reconciliation merge (#3) ---
  async openSignalGroups(): Promise<{ id: string; error_signature: string | null; code_artifact_ids: string[]; first_seen: string }[]> {
    return this.query(`SELECT id, error_signature, code_artifact_ids, first_seen::text AS first_seen FROM signal_groups WHERE status = 'open'`);
  }
  // Merge dropIds into keepId: reassign members, recompute aggregates from members, close dropped (provenance kept).
  async mergeSignalGroups(keepId: string, dropIds: string[], unionArtifacts: string[]): Promise<void> {
    if (!dropIds.length) return;
    // signal_group_id is a GENERATED column from inferences.signal.signal_group_id — reassign membership
    // by mutating that JSON source (a direct UPDATE of the generated column is rejected by Postgres).
    await this.query(
      `UPDATE processed_reviews SET inferences = jsonb_set(inferences, '{signal,signal_group_id}', to_jsonb($1::text), true)
       WHERE signal_group_id = ANY($2::uuid[])`,
      [keepId, dropIds],
    );
    await this.query(
      `UPDATE signal_groups SET
         code_artifact_ids = $2::uuid[],
         corroboration_count = (SELECT count(*) FROM processed_reviews WHERE signal_group_id = $1),
         affected_versions = COALESCE((SELECT array_agg(DISTINCT facts->>'app_version') FROM processed_reviews WHERE signal_group_id = $1 AND facts->>'app_version' IS NOT NULL), '{}'),
         affected_platforms = COALESCE((SELECT array_agg(DISTINCT facts->>'platform') FROM processed_reviews WHERE signal_group_id = $1 AND facts->>'platform' IS NOT NULL), '{}')
       WHERE id = $1`,
      [keepId, unionArtifacts],
    );
    await this.query(`UPDATE signal_groups SET status = 'merged' WHERE id = ANY($1::uuid[])`, [dropIds]);
    await this.writeSignalEvent(keepId, 'MERGED', { dropped: dropIds }, 'reconciliation');
  }
  // Suppression inputs (#4 lifecycle): resolution reports + defect reports filed AFTER the latest one.
  async groupResolutionStats(groupId: string): Promise<{ resolutionReports: number; reportsSinceResolution: number }> {
    const rows = await this.query<{ resolution_reports: string; reports_since: string }>(
      `WITH res AS (
         SELECT max((pr.facts->>'created_at')::timestamptz) AS latest
         FROM resolution_signals rs JOIN processed_reviews pr ON pr.id = rs.processed_review_id
         WHERE rs.signal_group_id = $1
       )
       SELECT
         (SELECT count(*) FROM resolution_signals WHERE signal_group_id = $1) AS resolution_reports,
         (SELECT count(*) FROM processed_reviews pr, res
          WHERE pr.signal_group_id = $1 AND res.latest IS NOT NULL
            AND (pr.facts->>'created_at')::timestamptz > res.latest
            -- defensive: only true defect reports count as regression (exclude any resolution-report rows)
            AND pr.id NOT IN (SELECT processed_review_id FROM resolution_signals WHERE signal_group_id = $1)) AS reports_since`,
      [groupId],
    );
    return { resolutionReports: Number(rows[0]?.resolution_reports ?? 0), reportsSinceResolution: Number(rows[0]?.reports_since ?? 0) };
  }
  // Report times for a feature (incl. its merged-away gap members) → gap/enhancement trend (#2).
  async featureReportTimes(featureId: string): Promise<number[]> {
    const rows = await this.query<{ t: string | null }>(
      `SELECT pr.facts->>'created_at' AS t FROM processed_reviews pr
       WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid IN
         (SELECT $1::uuid UNION SELECT id FROM feature_registry WHERE merged_into = $1::uuid)`,
      [featureId],
    );
    return rows.map((r) => Date.parse(r.t ?? '')).filter((n) => Number.isFinite(n));
  }
  async recordResolution(groupId: string, prId: string, appVersion: string | null): Promise<void> {
    await this.query(`INSERT INTO resolution_signals (signal_group_id, processed_review_id, app_version) VALUES ($1,$2,$3)`, [groupId, prId, appVersion]);
    await this.query(`UPDATE signal_groups SET resolution_count = resolution_count + 1 WHERE id = $1`, [groupId]);
  }

  // 재처리 멱등성: (source, source_id)로 기존 processed_review id 조회 → pr.id를 안정적으로 재사용.
  async existingProcessedId(source: string, sourceId: string): Promise<string | null> {
    const rows = await this.query<{ id: string }>(`SELECT id FROM processed_reviews WHERE source = $1 AND source_id = $2`, [source, sourceId]);
    return rows[0]?.id ?? null;
  }

  // 재처리 시 PR이 속한 그룹 id 조회 (현재 저장된 membership)
  async currentGroupOf(prId: string): Promise<string | null> {
    const rows = await this.query<{ signal_group_id: string | null }>(`SELECT signal_group_id FROM processed_reviews WHERE id = $1`, [prId]);
    return rows[0]?.signal_group_id ?? null;
  }

  // === observability (§8) ===
  async latestMetricSnapshot(): Promise<Record<string, Record<string, number>> | null> {
    const rows = await this.query<{ distributions: Record<string, Record<string, number>> }>(`SELECT distributions FROM metric_snapshots ORDER BY created_at DESC LIMIT 1`);
    return rows[0]?.distributions ?? null;
  }
  async saveMetricSnapshot(runLabel: string, distributions: unknown): Promise<void> {
    await this.query(`INSERT INTO metric_snapshots (run_label, distributions) VALUES ($1,$2)`, [runLabel, JSON.stringify(distributions)]);
  }
  async scalar(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await this.query<{ n: string }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }

  // === Insight & Proposal Layer (P2) ===
  // 타깃 codebase 모듈 → 컴포넌트 기능 맵 (gap 배치 제안 입력)
  async moduleMap(repo: string): Promise<{ module: string; features: string[] }[]> {
    return this.query(
      `SELECT p.pref_label AS module, array_agg(DISTINCT c.pref_label) AS features
       FROM feature_registry p JOIN feature_registry c ON c.parent_id = p.id
       WHERE p.repo = $1 AND p.parent_id IS NULL
       GROUP BY p.pref_label ORDER BY p.pref_label`,
      [repo],
    );
  }
  // 모듈 간 실제 import 의존성 (code_edges 그래프 → gap 제안 grounding/검증의 ground truth)
  async moduleImports(repo: string): Promise<{ module: string; imports: string[] }[]> {
    return this.query(
      `SELECT s.module AS module, array_remove(array_agg(DISTINCT d.module), s.module) AS imports
       FROM code_edges e
       JOIN code_artifact_registry s ON s.id = e.src_id
       JOIN code_artifact_registry d ON d.id = e.dst_id
       WHERE e.repo = $1 AND e.kind = 'imports' AND s.module <> d.module
       GROUP BY s.module ORDER BY s.module`,
      [repo],
    );
  }
  // 타깃 repo의 실제 모듈 집합 (검증용)
  async moduleNames(repo: string): Promise<string[]> {
    const rows = await this.query<{ module: string }>(`SELECT DISTINCT module FROM code_artifact_registry WHERE repo=$1 AND kind='module'`, [repo]);
    return rows.map((r) => r.module);
  }

  // 액션 가능한 버그 신호그룹 (corroboration + 심각도 + 코드 모듈 + risk)
  async bugGroups(repo: string): Promise<any[]> {
    return this.query(
      `SELECT g.id, g.error_signature, g.corroboration_count, g.trend, g.affected_platforms, g.affected_versions,
        (SELECT max(CASE pr.inferences->'classification'->>'severity' WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
           FROM processed_reviews pr WHERE pr.signal_group_id = g.id) AS sev,
        (SELECT fr.pref_label FROM processed_reviews pr JOIN feature_registry fr ON fr.id=(pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid WHERE pr.signal_group_id = g.id ORDER BY pr.created_at LIMIT 1) AS feature,
        (SELECT (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') FROM processed_reviews pr WHERE pr.signal_group_id = g.id AND (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') IS NOT NULL ORDER BY pr.created_at LIMIT 1) AS feature_id,
        ca.path AS module_path, ca.module AS code_module, ca.risk_tier,
        (SELECT array_agg(t) FROM (SELECT pr.facts->>'text_redacted' AS t FROM processed_reviews pr WHERE pr.signal_group_id = g.id ORDER BY pr.created_at LIMIT 3) s) AS samples
       FROM signal_groups g
       LEFT JOIN LATERAL (SELECT path, module, risk_tier FROM code_artifact_registry WHERE id = ANY(g.code_artifact_ids) ORDER BY risk_score DESC LIMIT 1) ca ON true
       WHERE g.status = 'open'
       ORDER BY g.corroboration_count DESC`,
    );
  }
  // Module-level blast-radius: per target module, # distinct external files that call/import into it.
  // (calls + imports so it has data even before a calls-aware re-scan.) Feeds Insight bug priority.
  async moduleBlastRadius(repo: string): Promise<Record<string, number>> {
    const rows = await this.query<{ module: string; callers: string }>(
      `SELECT tgt.module AS module, count(DISTINCT src.path) AS callers
       FROM code_edges e
       JOIN code_artifact_registry tgt ON tgt.id = e.dst_id
       JOIN code_artifact_registry src ON src.id = e.src_id
       WHERE e.repo = $1 AND e.kind IN ('calls','imports') AND src.module <> tgt.module
       GROUP BY tgt.module`,
      [repo],
    );
    return Object.fromEntries(rows.map((r) => [r.module, Number(r.callers)]));
  }
  // 클러스터링 입력 — 아직 안 묶인 gap 전부 (id/label/대표 샘플)
  async gapFeaturesRaw(repo: string): Promise<{ id: string; label: string; sample: string }[]> {
    return this.query(
      `SELECT f.id, f.pref_label AS label,
        COALESCE((SELECT pr.facts->>'text_redacted' FROM processed_reviews pr WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id') = f.id::text LIMIT 1), f.pref_label) AS sample
       FROM feature_registry f WHERE f.status='gap' AND f.repo=$1 AND f.merged_into IS NULL`,
      [repo],
    );
  }
  // gap 클러스터 병합 — rest를 canon으로 merged_into, canon 라벨을 대표명으로.
  async mergeGapFeatures(canonId: string, restIds: string[], label: string): Promise<void> {
    if (restIds.length) await this.query(`UPDATE feature_registry SET merged_into = $1 WHERE id = ANY($2::uuid[])`, [canonId, restIds]);
    await this.query(`UPDATE feature_registry SET pref_label = $2 WHERE id = $1`, [canonId, label]);
  }
  // canonical gap만 + demand/samples를 클러스터(canon + merged 멤버) 전체에서 합산
  async gapFeatures2(repo: string): Promise<any[]> {
    return this.query(
      `SELECT f.id, f.pref_label,
        (SELECT count(DISTINCT COALESCE(rr.payload->'author'->>'id', rr.payload->'author'->>'name', pr.source_id))
           FROM processed_reviews pr JOIN raw_reviews rr ON rr.id = pr.raw_review_id
           WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid IN
           (SELECT f.id UNION SELECT mm.id FROM feature_registry mm WHERE mm.merged_into = f.id)) AS demand,
        (SELECT array_agg(t) FROM (SELECT pr.facts->>'text_redacted' AS t FROM processed_reviews pr
           WHERE (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid IN
             (SELECT f.id UNION SELECT mm.id FROM feature_registry mm WHERE mm.merged_into = f.id) LIMIT 3) s) AS samples
       FROM feature_registry f WHERE f.status='gap' AND f.repo=$1 AND f.merged_into IS NULL ORDER BY demand DESC`,
      [repo],
    );
  }
  async enhancementItems(repo: string): Promise<any[]> {
    return this.query(
      `SELECT fr.id, fr.pref_label,
              count(DISTINCT COALESCE(rr.payload->'author'->>'id', rr.payload->'author'->>'name', pr.source_id))::int AS demand,
              array_agg(pr.facts->>'text_redacted') AS samples
       FROM processed_reviews pr
       JOIN raw_reviews rr ON rr.id = pr.raw_review_id
       JOIN feature_registry fr ON fr.id = (pr.inferences->'extraction'->'feature_mapping'->>'feature_id')::uuid
       WHERE pr.inferences->'extraction'->'feature_mapping'->>'state' = 'enhancement' AND fr.repo = $1
       GROUP BY fr.id, fr.pref_label ORDER BY demand DESC`,
      [repo],
    );
  }
  async clearProposals(repo: string): Promise<void> {
    await this.query(`DELETE FROM proposals WHERE repo = $1`, [repo]);
  }

  // --- HITL approval gate (proposal_reviews) ---
  // Resolve a (regenerated) proposal UUID → its stable identity, so the decision survives re-runs.
  async getProposalRef(id: string): Promise<{ repo: string; kind: string; ref_id: string; title: string } | null> {
    const rows = await this.query<{ repo: string; kind: string; ref_id: string | null; title: string }>(
      `SELECT repo, kind, ref_id, title FROM proposals WHERE id = $1`, [id]);
    const r = rows[0];
    if (!r || !r.ref_id) return null; // no stable key → can't persist a decision
    return { repo: r.repo, kind: r.kind, ref_id: r.ref_id, title: r.title };
  }
  // Upsert a human decision keyed on the stable identity.
  async decideProposal(p: { repo: string; kind: string; ref_id: string; decision: string; note?: string; title?: string; by?: string }): Promise<void> {
    await this.query(
      `INSERT INTO proposal_reviews (repo, kind, ref_id, decision, note, decided_by, title_snap)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (repo, kind, ref_id) DO UPDATE
         SET decision = EXCLUDED.decision, note = EXCLUDED.note, decided_by = EXCLUDED.decided_by,
             title_snap = EXCLUDED.title_snap, decided_at = now()`,
      [p.repo, p.kind, p.ref_id, p.decision, p.note ?? null, p.by ?? null, p.title ?? null],
    );
  }
  // ⑧ Calibration signal: approval/rejection rate per impact band. If high bands aren't approved more
  // than low bands, the impact weights are miscalibrated. (Measurement only — auto-tuning needs more data.)
  // Snapshot semantics: counts start from the CURRENT proposals; decisions on proposals no longer
  // regenerated (their signal disappeared) aren't counted here. Fine for a live snapshot.
  async decisionsByBand(repo: string): Promise<{ band: string; total: number; approved: number; rejected: number }[]> {
    const rows = await this.query<{ band: string | null; total: string; approved: string; rejected: string }>(
      `SELECT p.evidence->>'band' AS band,
              count(*) AS total,
              count(*) FILTER (WHERE pr.decision = 'approved') AS approved,
              count(*) FILTER (WHERE pr.decision = 'rejected') AS rejected
       FROM proposals p
       LEFT JOIN proposal_reviews pr ON pr.repo = p.repo AND pr.kind = p.kind AND pr.ref_id = p.ref_id
       WHERE p.repo = $1 GROUP BY p.evidence->>'band' ORDER BY 1`,
      [repo],
    );
    return rows.map((r) => ({ band: r.band ?? 'unknown', total: Number(r.total), approved: Number(r.approved), rejected: Number(r.rejected) }));
  }
  // Approved proposals (current generation) — Auto-Dev's input queue.
  async approvedProposals(repo: string): Promise<any[]> {
    return this.query(
      `SELECT p.*, pr.decided_at, pr.note AS decision_note
       FROM proposals p JOIN proposal_reviews pr
         ON pr.repo = p.repo AND pr.kind = p.kind AND pr.ref_id = p.ref_id
       WHERE p.repo = $1 AND pr.decision = 'approved' ORDER BY p.priority DESC`,
      [repo],
    );
  }
  // Refactor candidates (code-health P2) — files with ≥1 smell, smells aggregated per FILE (the file's
  // own god_file/hotspot + its symbols' complex_function, joined on shared path), with file metrics.
  async refactorCandidates(repo: string): Promise<{ path: string; module: string; loc: number | null; cyclomatic: number | null; fan_in: number | null; churn_commits: number | null; health_score: number | null; kinds: string[]; max_score: number; smells: { kind: string; score: number; severity: string }[] }[]> {
    const rows = await this.query<{ path: string; module: string; loc: number | null; cyclomatic: number | null; fan_in: number | null; churn_commits: number | null; health_score: number | null; kinds: string[]; max_score: number; smells: { kind: string; score: number; severity: string }[] }>(
      `SELECT f.path, f.module, f.loc, f.cyclomatic, f.fan_in, f.churn_commits, f.health_score,
              sm.kinds, sm.max_score, sm.smells
       FROM code_artifact_registry f
       JOIN LATERAL (
         SELECT array_agg(DISTINCT s.kind) AS kinds,
                max(s.score) AS max_score,
                jsonb_agg(jsonb_build_object('kind', s.kind, 'score', s.score, 'severity', s.severity) ORDER BY s.score DESC) AS smells
         FROM code_smells s JOIN code_artifact_registry a ON a.id = s.artifact_id
         WHERE s.repo = f.repo AND a.path = f.path
       ) sm ON sm.max_score IS NOT NULL
       WHERE f.repo = $1 AND f.kind = 'file'
       ORDER BY sm.max_score DESC`,
      [repo],
    );
    return rows.map((r) => ({
      ...r,
      max_score: Number(r.max_score),
      loc: r.loc === null ? null : Number(r.loc),
      cyclomatic: r.cyclomatic === null ? null : Number(r.cyclomatic),
      fan_in: r.fan_in === null ? null : Number(r.fan_in),
      churn_commits: r.churn_commits === null ? null : Number(r.churn_commits),
      health_score: r.health_score === null ? null : Number(r.health_score),
    }));
  }

  // Top change-coupling partners of a file ("왜 바뀌나" — what changes together with it). Drives the
  // refactor proposal's responsibility narrative. hidden/cross_module are the high-signal kinds.
  async cochangePartnersFor(repo: string, srcPath: string, limit = 6): Promise<{ dst_path: string; confidence: number; support: number; hidden: boolean; cross_module: boolean }[]> {
    const rows = await this.query<{ dst_path: string; confidence: number; support: number; hidden: boolean; cross_module: boolean }>(
      `SELECT dst_path, confidence, support, hidden, cross_module
       FROM code_cochange WHERE repo=$1 AND src_path=$2 ORDER BY confidence DESC, support DESC LIMIT $3`,
      [repo, srcPath, limit],
    );
    return rows.map((r) => ({ ...r, confidence: Number(r.confidence), support: Number(r.support) }));
  }

  async insertProposal(p: { repo: string; kind: string; ref_id: string | null; title: string; body: string; priority: number; target_module: string | null; placement: string | null; evidence: unknown; prerequisite?: string | null }): Promise<void> {
    await this.query(
      `INSERT INTO proposals (repo, kind, ref_id, title, body, priority, target_module, placement, evidence, prerequisite)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.repo, p.kind, p.ref_id, p.title, p.body, p.priority, p.target_module, p.placement, JSON.stringify(p.evidence ?? {}), p.prerequisite ?? null],
    );
  }

  // Landing-zone gate (P3): is a proposal's prerequisite refactor already in progress/done? The blocked
  // proposal stays held until the refactor it depends on has been picked up (decision in_dev/done).
  async prerequisiteSatisfied(repo: string, refactorRefId: string): Promise<boolean> {
    const rows = await this.query<{ decision: string }>(
      `SELECT decision FROM proposal_reviews WHERE repo=$1 AND kind='refactor' AND ref_id=$2`,
      [repo, refactorRefId],
    );
    const d = rows[0]?.decision;
    // in_dev = picked up by Auto-Dev; done/merged = completed. Any of these releases the held proposal
    // (merged included so a refactor that progresses in_dev→merged doesn't re-hold an already-released one).
    return d === 'in_dev' || d === 'done' || d === 'merged';
  }

  // --- persist (tx) ---
  async persistProcessed(pr: ProcessedReview, vector: number[] | null, embedderModel: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 멱등성: (source, source_id) conflict 시 기존 row의 id가 유지되므로 RETURNING으로 실제 id를 받아
      // review_embeddings FK에 사용한다 (reprocess 시 새 UUID로 FK 위반 방지).
      const ins = await client.query(
        `INSERT INTO processed_reviews (id, source, source_id, raw_review_id, facts, inferences, versions, created_at, processed_at, llm_calls)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (source, source_id) DO UPDATE
           SET facts = EXCLUDED.facts, inferences = EXCLUDED.inferences, versions = EXCLUDED.versions,
               processed_at = EXCLUDED.processed_at, llm_calls = EXCLUDED.llm_calls
         RETURNING id`,
        [pr.id, pr.source, pr.source_id, pr.raw_review_id, JSON.stringify(pr.facts), JSON.stringify(pr.inferences), JSON.stringify(pr.versions), pr.facts.created_at, pr.processed_at, JSON.stringify(pr.llm_calls)],
      );
      const actualId = ins.rows[0]!.id as string;
      if (vector) {
        await client.query(
          `INSERT INTO review_embeddings (processed_review_id, embedding, model)
           VALUES ($1,$2::vector,$3)
           ON CONFLICT (processed_review_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
          [actualId, toSqlVector(vector), embedderModel],
        );
      }
      await client.query(`UPDATE raw_reviews SET processed_at = now(), processing_error = NULL WHERE id = $1`, [pr.raw_review_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // === Auto-Dev Layer (layer 5) — agent_runs / agent_run_events ===

  // Claim a proposal for a run by inserting against the partial-unique active index. If a non-terminal
  // run already exists for (repo, kind, ref_id), ON CONFLICT DO NOTHING returns no row → claim refused.
  // This is the single serialization point that prevents double-dispatch (spec §2 invariant).
  async createAgentRun(p: { repo: string; kind: string; ref_id: string; status?: string }): Promise<AgentRunRow | null> {
    const rows = await this.query<AgentRunRow>(
      `INSERT INTO agent_runs (repo, kind, ref_id, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (repo, kind, ref_id) WHERE status NOT IN (${TERMINAL_SQL})
       DO NOTHING
       RETURNING *`,
      [p.repo, p.kind, p.ref_id, p.status ?? 'queued'],
    );
    return rows[0] ?? null;
  }

  // Patch a run row. Only provided fields are written; updated_at is always bumped, ended_at is set
  // automatically when transitioning into a terminal status.
  async updateAgentRun(id: string, p: Partial<Pick<AgentRunRow, 'status' | 'attempt' | 'branch' | 'base_sha' | 'workspace_path' | 'pr_url' | 'tokens' | 'error'>> & { verdict?: unknown }): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (p.status !== undefined) push('status', p.status);
    if (p.attempt !== undefined) push('attempt', p.attempt);
    if (p.branch !== undefined) push('branch', p.branch);
    if (p.base_sha !== undefined) push('base_sha', p.base_sha);
    if (p.workspace_path !== undefined) push('workspace_path', p.workspace_path);
    if (p.pr_url !== undefined) push('pr_url', p.pr_url);
    if (p.tokens !== undefined) push('tokens', p.tokens);
    if (p.error !== undefined) push('error', p.error);
    if (p.verdict !== undefined) push('verdict', JSON.stringify(p.verdict));
    sets.push('updated_at = now()');
    if (p.status !== undefined && (TERMINAL_RUN_STATUSES as readonly string[]).includes(p.status)) sets.push('ended_at = now()');
    await this.query(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = $1`, vals);
  }

  // Append a progress event (audit/stream source).
  async appendRunEvent(runId: string, phase: string, message: string | null, payload?: unknown): Promise<void> {
    await this.query(
      `INSERT INTO agent_run_events (run_id, phase, message, payload) VALUES ($1, $2, $3, $4)`,
      [runId, phase, message, payload === undefined ? null : JSON.stringify(payload)],
    );
  }

  // The active (non-terminal) run for a proposal, if any. Used to filter the dispatch queue so an
  // already-running or already-succeeded proposal isn't claimed again.
  async activeRunFor(repo: string, kind: string, ref_id: string): Promise<AgentRunRow | null> {
    const rows = await this.query<AgentRunRow>(
      `SELECT * FROM agent_runs
       WHERE repo = $1 AND kind = $2 AND ref_id = $3
         AND status NOT IN ('failed','timed_out','rejected_by_verifier','canceled')
       ORDER BY started_at DESC LIMIT 1`,
      [repo, kind, ref_id],
    );
    return rows[0] ?? null;
  }

  async getAgentRun(id: string): Promise<AgentRunRow | null> {
    const rows = await this.query<AgentRunRow>(`SELECT * FROM agent_runs WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  // Reaper (spec §2): a crashed/stalled run holds the active claim forever (the partial-unique index
  // only frees on a terminal status). Move any non-terminal run whose updated_at is older than
  // `staleMs` to 'timed_out' so its claim releases and the proposal can be re-dispatched. Returns the
  // reaped run ids. `nowSql` is injectable so tests can drive it deterministically against seeded rows.
  async reapStaleRuns(staleMs: number, nowSql = 'now()'): Promise<string[]> {
    const rows = await this.query<{ id: string }>(
      `UPDATE agent_runs
         SET status = 'timed_out', error = COALESCE(error, 'reaped: stalled past threshold'),
             updated_at = ${nowSql}, ended_at = ${nowSql}
       WHERE status NOT IN (${TERMINAL_SQL})
         AND updated_at < ${nowSql} - ($1::bigint * interval '1 millisecond')
       RETURNING id`,
      [Math.floor(staleMs)],
    );
    return rows.map((r) => r.id);
  }

  // List runs for a repo (newest first) with the proposal title + HITL decision joined — the
  // /api/agents source. LATERAL keeps it one row per run even if proposals regenerated duplicates.
  async listAgentRuns(repo: string, limit = 50): Promise<(AgentRunRow & { title: string | null; decision: string | null })[]> {
    return this.query(
      `SELECT r.*, p.title, rv.decision
       FROM agent_runs r
       LEFT JOIN LATERAL (SELECT title FROM proposals WHERE repo = r.repo AND kind = r.kind AND ref_id = r.ref_id LIMIT 1) p ON true
       LEFT JOIN proposal_reviews rv ON rv.repo = r.repo AND rv.kind = r.kind AND rv.ref_id = r.ref_id
       WHERE r.repo = $1 ORDER BY r.started_at DESC LIMIT $2`,
      [repo, limit],
    );
  }

  // Progress events for a repo's runs (newest first) with run context joined — the source for both
  // the /api/activity feed and the per-run step timeline on /api/agents.
  async listAgentRunEvents(repo: string, limit = 200): Promise<{ id: string; run_id: string; ts: string; phase: string; message: string | null; payload: any; branch: string | null; kind: string; ref_id: string }[]> {
    return this.query(
      `SELECT e.id::text AS id, e.run_id, e.ts::text AS ts, e.phase, e.message, e.payload,
              r.branch, r.kind, r.ref_id
       FROM agent_run_events e JOIN agent_runs r ON r.id = e.run_id
       WHERE r.repo = $1 ORDER BY e.ts DESC LIMIT $2`,
      [repo, limit],
    );
  }
}
