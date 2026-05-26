import pg from 'pg';
import { config } from '../config.js';
import { toSqlVector } from '../util/vector.js';
import type { Inferences, ProcessedReview } from '../contracts/processed-review.js';

const { Pool } = pg;

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

  // --- P1: feature mapping (Claude-as-judge) ---
  // 타깃 repo의 grounded feature 후보 전체 (소규모 codebase는 임베딩 추림 없이 전부 LLM에).
  async featureCandidates(targetRepo: string, limit = 60): Promise<{ feature_id: string; label: string; description: string }[]> {
    // leaf(컴포넌트, parent_id NOT NULL) feature 우선 — grounding이 파일 단위로 내려감.
    const leaves = await this.query<{ feature_id: string; label: string; description: string }>(
      `SELECT id AS feature_id, pref_label AS label, COALESCE(description,'') AS description
       FROM feature_registry WHERE status='grounded' AND repo=$1 AND parent_id IS NOT NULL ORDER BY pref_label LIMIT $2`,
      [targetRepo, limit],
    );
    if (leaves.length) return leaves;
    // 컴포넌트 feature가 없으면 모듈 단위로 degrade
    return this.query<{ feature_id: string; label: string; description: string }>(
      `SELECT id AS feature_id, pref_label AS label, COALESCE(description,'') AS description
       FROM feature_registry WHERE status='grounded' AND repo=$1 ORDER BY pref_label LIMIT $2`,
      [targetRepo, limit],
    );
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
       ORDER BY corroboration_count DESC LIMIT 1`,
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
       ORDER BY representative_embedding <=> $1::vector ASC LIMIT 3`,
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
}
