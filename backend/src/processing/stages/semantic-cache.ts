import type { Db } from '../../db/db.js';
import type { Inferences } from '../../contracts/processed-review.js';
import { thresholds } from '../../config.js';

// 4.5b semanticCache — classify LLM 호출 전에 의미적으로 동일한 과거 결과 재사용.
// poisoning 방어(#7): 동일 classifier_version + 고신뢰(≥0.85) 적재분만 소스로.
export interface SemanticCacheOutput {
  hit: boolean;
  cached_inferences?: Inferences;
  cosine?: number;
  source_review_id?: string;
}

export async function semanticCache(
  vector: number[],
  classifierVersion: string,
  db: Db,
  excludeRawReviewId: string,
): Promise<SemanticCacheOutput> {
  const hit = await db.semanticCacheLookup(vector, thresholds.semanticCache, classifierVersion, thresholds.cacheEligibleConf, excludeRawReviewId);
  if (!hit) return { hit: false };
  return { hit: true, cached_inferences: hit.inferences, cosine: hit.cosine, source_review_id: hit.source_review_id };
}
