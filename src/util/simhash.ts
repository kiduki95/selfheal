import { createHash } from 'node:crypto';

// 64-bit SimHash (spec §4.4) — 어휘적 정확/근사 중복 후보 생성. bit(64) 문자열로 반환.
export function simhash64(text: string): string {
  const norm = text.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  const tokens = ngrams(norm, 3);
  const v = new Array<number>(64).fill(0);
  for (const tok of tokens) {
    const h = hash64(tok);
    for (let i = 0; i < 64; i++) {
      const bit = (h[i >> 3]! >> (7 - (i & 7))) & 1;
      v[i]! += bit ? 1 : -1;
    }
  }
  let out = '';
  for (let i = 0; i < 64; i++) out += v[i]! > 0 ? '1' : '0';
  return out;
}

function ngrams(s: string, n: number): string[] {
  if (s.length < n) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}

function hash64(s: string): Buffer {
  return createHash('md5').update(s).digest().subarray(0, 8); // 8 bytes = 64 bits
}
