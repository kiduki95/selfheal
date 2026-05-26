import type { EmbeddingClient } from '../../clients/embedding/types.js';

// 4.8 embed — text_redacted를 그대로 임베딩 (원문 임베딩, spec §4.8/§9 결정).
// 의존성 순서상 dedup ANN·semanticCache가 벡터를 필요로 해서 파이프라인에서 일찍 1회 계산해 재사용.
export async function embed(textRedacted: string, embedder: EmbeddingClient) {
  return embedder.embed(textRedacted);
}
