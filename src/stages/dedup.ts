import type { Db } from '../db/db.js';
import { thresholds } from '../config.js';

// 4.4 dedup — 2-source 후보(SimHash 어휘 + 임베딩 ANN 의미) + cosine 2-band 검증.
//   cosine ≥ 0.95          → is_duplicate (ProcessedReview 안 만듦, raw.duplicate_of 기록)
//   0.90 ≤ cosine < 0.95   → near_duplicate (dedup 안 함, 클러스터 힌트만)
export interface DedupOutput {
  is_duplicate: boolean;
  duplicate_of?: string; // raw_review_id
  near_duplicates: string[];
  band: 'exact' | 'near' | 'none';
}

export async function dedup(
  rawReviewId: string,
  simhash: string,
  vector: number[],
  db: Db,
): Promise<DedupOutput> {
  // (a) SimHash 어휘 후보 (Hamming ≤ 3)
  const simCandidates = await db.simhashCandidates(rawReviewId, simhash, thresholds.simhashHamming);
  // (b) 임베딩 ANN 후보 (paraphrase/번역 중복) — processed_reviews 기준
  const annCandidates = await db.annNeighbors(vector, 5, rawReviewId);

  const near: string[] = [];
  // ANN 후보를 cosine band로 검증
  for (const c of annCandidates) {
    if (c.cosine >= thresholds.dedupExact) {
      return { is_duplicate: true, duplicate_of: c.raw_review_id, near_duplicates: [], band: 'exact' };
    }
    if (c.cosine >= thresholds.dedupNear) near.push(c.raw_review_id);
  }
  // SimHash로 어휘적 완전중복 잡힘(아직 미처리분 포함) → exact로 간주
  if (simCandidates.length > 0) {
    return { is_duplicate: true, duplicate_of: simCandidates[0]!.id, near_duplicates: near, band: 'exact' };
  }

  return { is_duplicate: false, near_duplicates: near, band: near.length ? 'near' : 'none' };
}
