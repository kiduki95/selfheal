// pgvector literal 직렬화 ('[1,2,3]') 및 cosine 유틸.
export function toSqlVector(v: number[]): string {
  return '[' + v.join(',') + ']';
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
