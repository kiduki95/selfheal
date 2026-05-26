import type { Db } from '../db/db.js';
import type { EmbeddingClient } from '../clients/embedding/types.js';
import type { FeatureMatchSchema } from '../contracts/processed-review.js';
import type { z } from 'zod';
import { thresholds } from '../config.js';

type FeatureMatch = z.infer<typeof FeatureMatchSchema>;

// 4.7 extractFeatureIds — exact alias → embedding 2-band (0.90/0.80). LLM 0.
//   exact / ≥0.90 → auto_verified (feature_ids 반영)
//   0.80~0.90     → pending_review (사람 큐, 자동 반영 안 함)
//   <0.80         → unmatched_feature_candidates 누적
export interface ExtractFeatureOutput {
  feature_ids: string[];
  feature_matches: FeatureMatch[];
  unmatched: string[];
}

export async function extractFeatureIds(
  rawMentions: string[],
  reviewId: string,
  db: Db,
  embedder: EmbeddingClient,
): Promise<ExtractFeatureOutput> {
  const feature_ids = new Set<string>();
  const feature_matches: FeatureMatch[] = [];
  const unmatched: string[] = [];

  for (const mention of dedupeStrings(rawMentions)) {
    // 1) exact alias match
    const exact = await db.featureExactMatch(mention);
    if (exact) {
      feature_ids.add(exact.id);
      feature_matches.push({ feature_id: exact.id, score: 1, status: 'auto_verified' });
      continue;
    }
    // 2) embedding 2-band
    const { vector } = await embedder.embed(mention);
    const matches = await db.featureVectorMatch(vector);
    const best = matches[0];
    if (best && best.cosine >= thresholds.featureAuto) {
      feature_ids.add(best.id);
      feature_matches.push({ feature_id: best.id, score: round2(best.cosine), status: 'auto_verified' });
    } else if (best && best.cosine >= thresholds.featurePending) {
      feature_matches.push({ feature_id: best.id, score: round2(best.cosine), status: 'pending_review' });
    } else {
      unmatched.push(mention);
      await db.upsertUnmatchedCandidate(mention, mention.toLowerCase().trim(), vector, reviewId);
    }
  }

  return { feature_ids: [...feature_ids], feature_matches, unmatched };
}

function dedupeStrings(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
