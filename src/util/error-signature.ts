// error_signature 정규화 v1 (deterministic). 스펙 §3은 canonical/family를 "후속"으로 뒀지만,
// Phase 2 그룹핑의 "가장 신뢰하는 키"가 canonical이라 null이면 집계가 안 된다. 그래서 경량 v1을 둔다:
// raw 에러 표현(한/영) → family(에러 패밀리) + canonical(그룹 키). 진짜 정규화 엔진은 후속.

export interface CanonicalSig {
  canonical: string | null;
  family: string | null;
}

const RULES: { family: string; re: RegExp }[] = [
  { family: 'null_deref', re: /null\s*pointer|nullpointerexception|\bnpe\b|\bnil\b/i },
  { family: 'http_5xx', re: /\b5\d{2}\b|5xx|server error|internal error/i },
  { family: 'http_4xx', re: /\b4\d{2}\b|4xx|not found|unauthorized|forbidden/i },
  { family: 'crash', re: /강제\s*종료|튕|크래시|crash|force\s*close|죽(어|음)|뻗/i },
  { family: 'hang', re: /멈춤|멈춰|먹통|응답\s*없|freeze|frozen|hang|stuck|무한\s*로딩|로딩만/i },
  { family: 'timeout', re: /타임아웃|timeout|시간\s*초과/i },
  { family: 'auth_error', re: /로그인.*안|login.*fail|인증\s*실패|auth.*error/i },
];

export function canonicalizeErrorSignature(raw: string | null): CanonicalSig {
  if (!raw) return { canonical: null, family: null };
  for (const r of RULES) {
    if (r.re.test(raw)) return { canonical: r.family, family: r.family };
  }
  // 패밀리 미상 — 숫자/버전 제거한 소문자 표현을 canonical로 (최소한의 정규화)
  const canonical = raw.toLowerCase().replace(/\d+(\.\d+)*/g, '').replace(/\s+/g, ' ').trim();
  return { canonical: canonical || null, family: null };
}
