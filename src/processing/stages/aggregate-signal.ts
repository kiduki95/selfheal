import type { Db } from '../../db/db.js';
import type { Inferences } from '../../contracts/processed-review.js';
import { thresholds } from '../../config.js';

// 4.8b aggregateSignal — Phase 2, cross-review, stateful. "inline은 멍청하게, 똑똑함은 비동기로".
// inline: 보수적·provisional 배정만. merge/split/representative 재선정은 reconciliation(별도, stub).
// 입력은 이미 persist된 ProcessedReview(=bug, defect 보유). signal 스냅샷을 그룹에서 파생해 돌려준다.

export const SIGNAL_ASSIGN_COSINE = 0.88; // representative 직접 cosine (centroid 아님 = complete-linkage 근사)

export interface AggregateInput {
  processed_review_id: string;
  embedding: number[];
  inferences: Inferences;
  app_version: string | null;
  platform: string | null;
  created_at: string;
}

export interface AggregateResult {
  signal: NonNullable<Inferences['signal']>;
  created_group: boolean;
  matched_by: 'error_signature' | 'embedding' | 'new';
}

export async function aggregateSignal(input: AggregateInput, db: Db): Promise<AggregateResult | null> {
  const defect = input.inferences.defect;
  if (!defect) return null; // bug(=defect)만 그룹핑

  const prId = input.processed_review_id;
  const canonical = defect.error_signature?.canonical ?? null;
  const artifactIds = defect.artifact_matches.map((a) => a.artifact_id);
  const regressionHint = defect.regression_version_hint ?? input.app_version;

  // --- (1) inline provisional 배정 ---
  let groupId: string | null = null;
  let matchedBy: AggregateResult['matched_by'] = 'new';

  // 재처리면 기존 그룹 유지 (멱등)
  groupId = await db.currentGroupOf(prId);
  if (groupId) matchedBy = 'error_signature'; // 재배정 안 함

  // (a) canonical error_signature 일치 = 가장 신뢰
  if (!groupId && canonical) {
    const g = await db.findGroupByCanonical(canonical, artifactIds);
    if (g) {
      groupId = g.id;
      matchedBy = 'error_signature';
    }
  }
  // (b) representative cosine ≥ 0.88 + artifact 교집합
  if (!groupId) {
    const cands = await db.annGroups(input.embedding, artifactIds);
    const best = cands[0];
    if (best && best.cosine >= SIGNAL_ASSIGN_COSINE) {
      groupId = best.id;
      matchedBy = 'embedding';
    }
  }
  // (c) 없으면 새 그룹 (애매하면 새로 — 나중에 merge가 안전)
  let createdGroup = false;
  if (!groupId) {
    groupId = await db.createSignalGroup({ repReviewId: prId, embedding: input.embedding, canonical, artifactIds, regressionHint, firstSeen: input.created_at });
    createdGroup = true;
    matchedBy = 'new';
    await db.writeSignalEvent(groupId, 'CREATED', { review: prId, canonical, artifactIds }, 'aggregateSignal');
  }

  // membership 기반 집계 (self 제외 후 self 합산 — reprocess 멱등)
  const existing = await db.groupMemberAggregates(groupId, prId);
  const versions = uniq([...existing.versions, input.app_version]);
  const platforms = uniq([...existing.platforms, input.platform]);
  const count = existing.count + 1;
  const trend = count === 1 ? 'new' : 'rising';

  await db.updateGroupAggregates(groupId, { count, versions, platforms, trend, lastSeen: input.created_at, newMemberVector: input.embedding });
  if (!createdGroup) {
    await db.writeSignalEvent(groupId, 'MEMBER_ADDED', { review: prId, matched_by: matchedBy, count }, 'aggregateSignal');
  }

  const signal: NonNullable<Inferences['signal']> = {
    signal_group_id: groupId,
    corroboration_count: count,
    affected_versions: versions,
    affected_platforms: platforms,
    trend: trend as 'new' | 'rising' | 'stable' | 'declining',
    first_seen: input.created_at,
    last_seen: input.created_at,
  };
  await db.setReviewSignal(prId, signal);

  return { signal, created_group: createdGroup, matched_by: matchedBy };
}

// 해소 리포트(#5) — defect가 아니라 negative evidence. 후보 그룹에 resolution으로 기록(로직은 캡처만).
export async function recordResolutionReport(input: AggregateInput, db: Db): Promise<boolean> {
  const cands = await db.annGroups(input.embedding, []);
  const best = cands[0];
  if (best && best.cosine >= thresholds.semanticCache) {
    await db.recordResolution(best.id, input.processed_review_id, input.app_version);
    await db.writeSignalEvent(best.id, 'STATUS_CHANGED', { resolution_report: input.processed_review_id }, 'aggregateSignal');
    return true;
  }
  return false;
}

function uniq(arr: (string | null)[]): string[] {
  return [...new Set(arr.filter((x): x is string => !!x))];
}
