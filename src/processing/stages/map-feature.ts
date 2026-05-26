import type { Db } from '../../db/db.js';
import type { LlmClient } from '../../clients/llm/types.js';
import type { z } from 'zod';
import type { FeatureMappingSchema } from '../../contracts/processed-review.js';
import { thresholds } from '../../config.js';

type FeatureMapping = z.infer<typeof FeatureMappingSchema>;

// 4.7' mapFeature (P1) — review를 타깃 codebase의 기존 기능에 매핑하거나 gap(floating)으로.
// 후보 추림: review 임베딩 ↔ feature 임베딩 ANN으로 top-K만 LLM에 보낸다 (repo 크기와 무관하게 payload 고정).
// reviewVector가 없으면(구 경로) 전체 후보로 degrade. 판단은 LLM(Claude-as-judge) — 모듈/심볼명↔사용자어.
export async function mapFeature(
  input: { text: string; affected_area: string | null; category: string; mentions: string[]; reviewVector?: number[] | null },
  db: Db,
  llm: LlmClient,
  targetRepo: string,
): Promise<FeatureMapping> {
  const candidates = input.reviewVector
    ? await db.featureCandidatesByVector(targetRepo, input.reviewVector, thresholds.featureShortlistK)
    : await db.featureCandidates(targetRepo);
  const dec = await llm.mapFeature({
    text: input.text,
    affected_area: input.affected_area,
    category: input.category,
    candidates,
  });

  let feature_id = dec.feature_id;
  if (dec.state === 'gap') {
    // floating — 미구현/요청 기능. emergent feature로 박제 (nearest-module 제안은 Insight 책임).
    const label = (input.affected_area || input.mentions[0] || input.text).trim().slice(0, 80);
    feature_id = await db.upsertEmergentFeature(label, label.toLowerCase().replace(/\s+/g, '_'), targetRepo);
  }
  return { state: dec.state, feature_id, confidence: round2(dec.confidence), reason: dec.reason || null };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
