import { describe, it, expect } from 'vitest';
import { normalize } from '../src/stages/normalize.js';
import { extractPII } from '../src/stages/extract-pii.js';
import { detectLanguage } from '../src/stages/detect-language.js';
import { prefilter } from '../src/stages/prefilter.js';
import { StubLlmClient } from '../src/clients/llm/stub.js';
import { LocalEmbeddingClient } from '../src/clients/embedding/local.js';
import { cosine } from '../src/util/vector.js';
import { classifyCodeRisk } from '../src/util/code-risk.js';
import { canonicalizeErrorSignature } from '../src/util/error-signature.js';
import { InMemoryMetrics } from '../src/observability/metrics.js';
import { psi, psiLabel } from '../src/observability/psi.js';
import type { RawReview } from '../src/contracts/raw-review.js';

const llm = new StubLlmClient();
const rr = (text: string, extra: Partial<RawReview> = {}): RawReview => ({
  source: 'app_store', source_id: 's', text, created_at: '2026-05-20T00:00:00Z', ingested_at: '2026-05-20T01:00:00Z', raw_payload: {}, ...extra,
});

describe('normalize', () => {
  it('tab/multi-space collapse + trim', () => {
    expect(normalize('  a\t\tb   c  ').text_normalized).toBe('a b c');
  });
  it('zero-width removal', () => {
    expect(normalize('a​b').text_normalized).toBe('ab');
  });
});

describe('detectLanguage', () => {
  it('한글 감지', () => expect(detectLanguage('결제가 안 돼요').language).toBe('ko'));
  it('영어 감지', () => expect(detectLanguage('the app keeps crashing on launch').language).toBe('en'));
});

describe('extractPII', () => {
  it('구조적 PII 마스킹 + 일반명사 미오탐', () => {
    const r = extractPII('홍길동님 hong@x.com 010-1234-5678. 먹통이에요');
    expect(r.text_redacted).toContain('<EMAIL>');
    expect(r.text_redacted).toContain('<PHONE>');
    expect(r.text_redacted).toContain('<PERSON>님');
    expect(r.text_redacted).toContain('먹통이에요'); // false positive 없음
  });
  it('Luhn 통과 카드만 마스킹', () => {
    expect(extractPII('카드 4111 1111 1111 1111').text_redacted).toContain('<CARD>');
  });
});

describe('prefilter', () => {
  it('단일문자 도배 drop', async () => expect((await prefilter(rr('ㅋ'.repeat(30)), llm)).kept).toBe(false));
  it('URL 폭격 drop', async () => expect((await prefilter(rr('a http://x http://y http://z'), llm)).kept).toBe(false));
  it('정상 리뷰 keep', async () => expect((await prefilter(rr('로그인이 안 돼요'), llm)).kept).toBe(true));
});

describe('classify (stub)', () => {
  it('결제 크래시 → bug/critical', async () => {
    const o = await llm.classifyExtractModerate({ text_redacted: '결제할 때 앱이 튕기고 환불 안 됨', text_en: null, rating: 1, app_version: '1.0' });
    expect(o.classification.category).toBe('bug');
    expect(o.classification.severity).toBe('critical');
    expect(o.defect?.affected_area).toBe('결제 화면');
  });
  it('칭찬 → praise', async () => {
    const o = await llm.classifyExtractModerate({ text_redacted: '최고의 앱이에요 완벽합니다', text_en: null, rating: 5, app_version: null });
    expect(o.classification.category).toBe('praise');
  });
});

describe('code-risk (bug-hunter triage 이식)', () => {
  it('결제/인증 → critical', () => {
    expect(classifyCodeRisk('Sources/Payment/PaymentView.swift', 'Payment').tier).toBe('critical');
    expect(classifyCodeRisk('Sources/Auth/LoginViewModel.swift').tier).toBe('critical');
  });
  it('upload → high, 일반화면 → low', () => {
    expect(classifyCodeRisk('PhotoUploader.upload()').tier).toBe('high');
    expect(classifyCodeRisk('Sources/Map/MapView.swift', 'Map').tier).toBe('low');
  });
});

describe('error-signature canonicalize (Phase 2 그룹 키)', () => {
  it('강제종료/튕 → crash', () => {
    expect(canonicalizeErrorSignature('강제종료됩니다').family).toBe('crash');
    expect(canonicalizeErrorSignature('force closes').family).toBe('crash');
  });
  it('NPE → null_deref, 멈춤 → hang', () => {
    expect(canonicalizeErrorSignature('NullPointerException').family).toBe('null_deref');
    expect(canonicalizeErrorSignature('멈춤 현상').family).toBe('hang');
  });
  it('null raw → null canonical', () => {
    expect(canonicalizeErrorSignature(null).canonical).toBeNull();
  });
});

describe('observability metrics (§8)', () => {
  it('counter/ratio/percentile/dist', () => {
    const m = new InMemoryMetrics();
    m.inc('funnel.in'); m.inc('funnel.in'); m.inc('funnel.drop');
    expect(m.getCounter('funnel.in')).toBe(2);
    expect(m.ratio('funnel.drop', 'funnel.in')).toBe(0.5);
    [0.6, 0.8, 0.9, 0.95].forEach((v) => m.observe('conf', v));
    const p = m.percentiles('conf');
    expect(p.count).toBe(4);
    expect(p.p50).toBeGreaterThanOrEqual(0.8);
    m.count('cat', 'bug'); m.count('cat', 'bug'); m.count('cat', 'praise');
    expect(m.getDist('cat')).toEqual({ bug: 2, praise: 1 });
  });
});

describe('drift PSI (§8)', () => {
  it('동일 분포 → ~0 (stable)', () => {
    const d = { ko: 10, en: 5 };
    expect(psi(d, { ko: 10, en: 5 })).toBeLessThan(0.01);
    expect(psiLabel(psi(d, { ko: 10, en: 5 }))).toBe('stable');
  });
  it('분포 급변 → significant', () => {
    const v = psi({ ko: 19, en: 1 }, { ko: 1, en: 19 });
    expect(v).toBeGreaterThan(0.25);
    expect(psiLabel(v)).toBe('significant');
  });
});

describe('local embedder', () => {
  it('동일 텍스트 cosine=1, 무관 텍스트 낮음', async () => {
    const e = new LocalEmbeddingClient();
    const a = (await e.embed('로그인이 안 돼요')).vector;
    const a2 = (await e.embed('로그인이 안 돼요')).vector;
    const b = (await e.embed('정말 최고의 앱입니다')).vector;
    expect(cosine(a, a2)).toBeCloseTo(1, 5);
    expect(cosine(a, b)).toBeLessThan(0.5);
  });
});
