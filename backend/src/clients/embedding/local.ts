import { createHash } from 'node:crypto';
import { EMBED_DIM } from '../../config.js';
import type { EmbeddingClient, EmbeddingResult } from './types.js';

// 결정론적 로컬 임베더. 진짜 의미 임베딩은 아니지만 — character n-gram을 해시로 버킷에
// 누적(feature hashing) 후 L2 정규화 → 같은 텍스트는 cosine 1.0, 어휘가 겹칠수록 높은 cosine.
// dedup(exact/near)·semanticCache 메커니즘을 키/비용 없이 end-to-end로 검증하기에 충분하다.
// 진짜 cross-lingual 의미 매칭이 필요하면 EMBEDDING_CLIENT=cohere로 교체 (spec §9 bake-off).
export class LocalEmbeddingClient implements EmbeddingClient {
  readonly kind = 'local' as const;
  readonly model = 'local-hash/v1';

  async embed(text: string): Promise<EmbeddingResult> {
    const vec = new Float64Array(EMBED_DIM);
    const norm = text.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

    // char 3-gram feature hashing (signed) — TF 가중
    const grams = charNGrams(norm, 3);
    for (const g of grams) {
      const h = hashToInt(g);
      const bucket = h % EMBED_DIM;
      const sign = (h >>> 31) & 1 ? 1 : -1; // signed hashing: 충돌 시 상쇄로 bias 완화
      vec[bucket] = (vec[bucket] ?? 0) + sign;
    }
    // word unigram도 일부 신호로 (paraphrase가 아닌 동일 어휘 강조)
    for (const w of norm.split(' ')) {
      if (!w) continue;
      const b = hashToInt('w:' + w) % EMBED_DIM;
      vec[b] = (vec[b] ?? 0) + 1.5;
    }

    // L2 정규화 → cosine = dot product
    let mag = 0;
    for (let i = 0; i < EMBED_DIM; i++) mag += vec[i]! * vec[i]!;
    mag = Math.sqrt(mag) || 1;
    const vector = Array.from(vec, (v) => v / mag);

    return { vector, model: this.model, dim: EMBED_DIM };
  }
}

function charNGrams(s: string, n: number): string[] {
  if (s.length < n) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}

function hashToInt(s: string): number {
  const h = createHash('md5').update(s).digest();
  // 상위 4바이트를 unsigned 32-bit로
  return h.readUInt32BE(0);
}
