import type { EmbeddingClient, EmbeddingResult } from './types.js';

// 진짜 Cohere embed-multilingual-v3 — 키 생기면 EMBEDDING_CLIENT=cohere로 활성화.
// ⚠️ Cohere v3 차원은 1024 → migration의 vector(1536)을 1024로 바꿔야 함 (spec §9 차원 재검토).
export class CohereEmbeddingClient implements EmbeddingClient {
  readonly kind = 'cohere' as const;
  readonly model = 'cohere-embed-multilingual-v3/v1';
  constructor(private apiKey: string) {}

  async embed(text: string): Promise<EmbeddingResult> {
    const res = await fetch('https://api.cohere.com/v2/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: 'embed-multilingual-v3.0',
        texts: [text],
        input_type: 'clustering',
        embedding_types: ['float'],
      }),
    });
    if (!res.ok) throw new Error(`Cohere API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as any;
    const vector = json.embeddings?.float?.[0] as number[];
    return { vector, model: this.model, dim: vector.length };
  }
}
