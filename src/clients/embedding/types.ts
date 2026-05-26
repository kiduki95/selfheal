// 교체 가능한 임베딩 인터페이스.
//   LocalEmbeddingClient  — 결정론적 hashed char-ngram (키 0, 비용 0). 동일 텍스트=동일 벡터,
//                           어휘 유사 텍스트=높은 cosine → dedup/semanticCache 메커니즘 검증 가능.
//   CohereEmbeddingClient — embed-multilingual-v3 (키 생기면 EMBEDDING_CLIENT=cohere로 스위치)
export interface EmbeddingResult {
  vector: number[];
  model: string;
  dim: number;
}

export interface EmbeddingClient {
  readonly kind: 'local' | 'cohere';
  readonly model: string;
  embed(text: string): Promise<EmbeddingResult>;
}
