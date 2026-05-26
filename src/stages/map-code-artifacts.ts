import type { Db } from '../db/db.js';
import type { EmbeddingClient } from '../clients/embedding/types.js';
import type { ArtifactMatchSchema } from '../contracts/processed-review.js';
import type { z } from 'zod';
import { thresholds } from '../config.js';

type ArtifactMatch = z.infer<typeof ArtifactMatchSchema>;

// 4.7b mapCodeArtifacts — defect를 repo 위치에 grounding (provenance 필수, #4). LLM 0.
//   1) feature_id → code_artifact 직접 링크 (feature_link)
//   2) affected_area 임베딩 ↔ code_artifact 임베딩 (semantic_match)
export interface MapCodeOutput {
  artifact_matches: ArtifactMatch[];
  owners: string[];
}

export async function mapCodeArtifacts(
  featureIds: string[],
  affectedArea: string | null,
  db: Db,
  embedder: EmbeddingClient,
): Promise<MapCodeOutput> {
  const byId = new Map<string, ArtifactMatch>();
  const owners = new Set<string>();

  // 1) feature_link
  for (const cm of await db.codeMatchByFeatures(featureIds)) {
    byId.set(cm.id, { artifact_id: cm.id, score: 1, source: 'feature_link', reason: 'feature ↔ code 직접 링크' });
    cm.owners.forEach((o) => owners.add(o));
  }

  // 2) semantic_match (affected_area)
  if (affectedArea) {
    const { vector } = await embedder.embed(affectedArea);
    for (const cm of await db.codeMatchByVector(vector)) {
      if (cm.cosine < thresholds.codeMatch) continue;
      if (!byId.has(cm.id)) {
        byId.set(cm.id, { artifact_id: cm.id, score: round2(cm.cosine), source: 'semantic_match', reason: `affected_area "${affectedArea}" 유사` });
        cm.owners.forEach((o) => owners.add(o));
      }
    }
  }

  return { artifact_matches: [...byId.values()], owners: [...owners] };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
