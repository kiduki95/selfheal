// 4.3 extractPII — hybrid regex(구조적) + 경량 NER backstop(비구조적). LLM 0.
// text_redacted가 이후 모든 LLM/embed의 입력. 원본은 vector DB로 안 나간다 (compliance).

interface PiiResult {
  text_redacted: string;
  pii_found: { type: string; count: number }[];
}

// Pass 1 — regex (구조적, 일부 checksum)
const REGEX_RULES: { type: string; token: string; re: RegExp; validate?: (m: string) => boolean }[] = [
  { type: 'URL', token: '<URL>', re: /https?:\/\/[^\s<]+/gi },
  { type: 'EMAIL', token: '<EMAIL>', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { type: 'RRN', token: '<RRN>', re: /\b\d{6}[-\s]?[1-4]\d{6}\b/g }, // 한국 주민등록번호
  { type: 'CARD', token: '<CARD>', re: /\b(?:\d[ -]?){15,16}\b/g, validate: luhn },
  { type: 'PHONE', token: '<PHONE>', re: /(\+?\d{1,3}[-\s]?)?(\(?0\d{1,2}\)?[-\s]?)?\d{3,4}[-\s]?\d{4}\b/g },
  { type: 'ORDER', token: '<ORDER>', re: /\b(?:ORD|ORDER|주문번호[:\s]*)[-#]?\d{6,}\b/gi },
];

// Pass 2 — NER backstop (stub: 휴리스틱, 보수적). 진짜 NER(Presidio/GLiNER)로 교체 가능.
// 한국어는 호칭(님/씨)이 붙은 이름만, 영어는 "my name is X" 패턴만 — false positive 최소화.
// (일반 명사 "먹통이에요" 등이 오탐되지 않도록 흔한 종결어미는 트리거에서 제외)
const NER_RULES: { type: string; token: string; re: RegExp }[] = [
  // 호칭(님/씨)은 lookahead라 소비하지 않음 → 이름만 <PERSON>으로 치환, 호칭은 보존
  { type: 'PERSON', token: '<PERSON>', re: /[가-힣]{2,4}(?=님)/g },
  { type: 'PERSON', token: '<PERSON>', re: /[가-힣]{2,4}(?=씨(?:[\s,.]|$))/g },
  { type: 'PERSON', token: '<PERSON>', re: /\b(?:my name is|name is)\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/g },
];

export function extractPII(textNormalized: string): PiiResult {
  let text = textNormalized;
  const counts = new Map<string, number>();

  const apply = (rules: { type: string; token: string; re: RegExp; validate?: (m: string) => boolean }[]) => {
    for (const rule of rules) {
      text = text.replace(rule.re, (m) => {
        if (rule.validate && !rule.validate(m)) return m;
        counts.set(rule.type, (counts.get(rule.type) ?? 0) + 1);
        return rule.token;
      });
    }
  };

  apply(REGEX_RULES); // Pass 1
  apply(NER_RULES); // Pass 2

  return {
    text_redacted: text,
    pii_found: [...counts.entries()].map(([type, count]) => ({ type, count })),
  };
}

function luhn(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  if (digits.length < 15 || digits.length > 16) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}
