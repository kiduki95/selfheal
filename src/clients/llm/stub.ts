import type {
  LlmClient,
  TranslateInput,
  TranslateOutput,
  ClassifyInput,
  ClassifyOutput,
  PrefilterEscalationOutput,
  LlmUsage,
} from './types.js';
import type { Category } from '../../contracts/processed-review.js';

// 규칙 기반 가짜 LLM. 키/비용 0, 결정론적. AnthropicLlmClient와 동일 인터페이스라
// LLM_CLIENT=anthropic로 언제든 교체 가능. 목적: 파이프라인 분기를 전부 굴려 검증.

const KO_EN = {
  bug: [
    '튕', '죽어', '죽음', '멈춤', '멈춰', '먹통', '강제종료', '강제 종료', '안 돼', '안돼', '안됨',
    '안 됨', '실행이', '로딩', '버그', '에러', '오류', '깨져', '깨짐', '안 열', '안열',
    'crash', 'crashes', 'crashing', 'freeze', 'frozen', 'error', 'bug', 'broken', "doesn't work",
    'does not work', 'force close', 'npe', 'nullpointer', 'exception', 'stuck', 'blank screen',
  ],
  feature_request: [
    '추가해', '추가됐으면', '있었으면', '있으면 좋', '됐으면', '지원해', '지원됐으면', '바랍니다',
    '바라요', '해주세요', '다크모드', '다크 모드', '기능',
    'please add', 'add a', 'add an', 'would be great if', 'wish', 'feature request', 'support for',
    'dark mode', 'it would be nice', 'can you add',
  ],
  praise: [
    '최고', '좋아요', '좋습니다', '감사', '훌륭', '완벽', '잘 쓰고', '잘쓰고', '대박', '굿',
    'love', 'great app', 'awesome', 'perfect', 'excellent', 'best', 'amazing', 'fantastic',
  ],
  complaint: [
    '불편', '별로', '실망', '느려', '느림', '광고', '짜증', '최악', '비싸', '환불',
    'slow', 'laggy', 'ads', 'too many ads', 'hate', 'worst', 'expensive', 'disappointed', 'refund',
  ],
  question: [
    '어떻게', '어디서', '방법', '가능한가요', '하나요', '되나요',
    'how do i', 'how to', 'where is', 'is it possible', 'can i', 'why does',
  ],
} satisfies Record<string, string[]>;

const RESOLUTION_CUES = [
  '이제 잘', '이제 돼', '이제 됩니다', '이제 됨', '고쳐졌', '고쳐짐', '해결됐', '해결됨',
  '업데이트 후 잘', '업데이트하니', '잘 돼요', '잘됩니다',
  'fixed now', 'works now', 'is fixed', 'resolved', 'after the update it works', 'no longer crashes',
];

const SEVERITY_CRITICAL = [
  '환불', '결제', '돈', '로그인 안', '로그인이 안', '데이터 날아', '데이터가 사라', '계정',
  'refund', 'charged', 'payment', "can't log in", 'cannot log in', 'lost my data', 'data loss',
  'account', 'money',
];

// affected_area 추정용 feature 키워드 → 자연어 영역
const AREA_MAP: { kw: string[]; area: string }[] = [
  { kw: ['결제', '구매', 'payment', 'checkout', 'purchase', 'billing'], area: '결제 화면' },
  { kw: ['로그인', '로그아웃', 'login', 'log in', 'sign in', 'auth'], area: '로그인/인증' },
  { kw: ['알림', '푸시', 'notification', 'push'], area: '푸시 알림' },
  { kw: ['검색', 'search'], area: '검색' },
  { kw: ['지도', '맵', 'map'], area: '지도' },
  { kw: ['프로필', 'profile', 'account'], area: '프로필/계정' },
  { kw: ['업로드', '사진', 'upload', 'photo', 'image'], area: '사진 업로드' },
];

function countHits(text: string, words: string[]): { n: number; hits: string[] } {
  const lower = text.toLowerCase();
  const hits = words.filter((w) => lower.includes(w.toLowerCase()));
  return { n: hits.length, hits };
}

function usage(model: string, tin: number, tout: number): LlmUsage {
  return { model, tokens_in: tin, tokens_out: tout, cached_tokens: 0, duration_ms: 1 };
}

export class StubLlmClient implements LlmClient {
  readonly kind = 'stub' as const;

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    // 진짜 번역은 안 함 — 비-영어임을 표시하고 원문 보존(파이프라인 분기 검증 목적).
    return {
      text_en: `[stub-translated from ${input.language}] ${input.text_redacted}`,
      usage: usage('stub/translate', input.text_redacted.length, input.text_redacted.length),
    };
  }

  async classifyExtractModerate(input: ClassifyInput): Promise<ClassifyOutput> {
    const text = `${input.text_redacted} ${input.text_en ?? ''}`;
    const lower = text.toLowerCase();

    // 카테고리 점수
    const scores: Record<Category, number> = {
      bug: countHits(text, KO_EN.bug).n,
      feature_request: countHits(text, KO_EN.feature_request).n,
      praise: countHits(text, KO_EN.praise).n,
      complaint: countHits(text, KO_EN.complaint).n,
      question: countHits(text, KO_EN.question).n + (text.includes('?') ? 1 : 0),
      other: 0,
    };
    // rating 신호 가미
    if (input.rating != null) {
      if (input.rating <= 2) {
        scores.bug += 0.5;
        scores.complaint += 0.5;
      } else if (input.rating >= 4) scores.praise += 0.5;
    }

    let category: Category = 'other';
    let top = 0;
    let second = 0;
    for (const [cat, s] of Object.entries(scores) as [Category, number][]) {
      if (s > top) {
        second = top;
        top = s;
        category = cat;
      } else if (s > second) second = s;
    }
    if (top === 0) category = 'other';

    // confidence: 1등이 2등을 얼마나 앞서는가 (margin) 기반
    let category_confidence: number;
    if (top === 0) category_confidence = 0.45; // 단서 없음 → 낮음 → escalation 후보
    else {
      const margin = (top - second) / top;
      category_confidence = Math.min(0.95, 0.6 + 0.35 * margin + Math.min(top, 3) * 0.03);
    }

    // graduated escalation 시뮬레이션 (spec §4.6): conf<0.6면 더 큰 모델 재호출 → 약간 보정
    let escalated = false;
    if (category_confidence < 0.6) {
      escalated = true;
      category_confidence = Math.min(0.7, category_confidence + 0.2);
    }

    // sentiment
    const isRes = countHits(text, RESOLUTION_CUES).n > 0;
    let sentiment: 'positive' | 'neutral' | 'negative';
    let sentiment_score: number;
    if (category === 'praise' || (isRes && (input.rating ?? 3) >= 3)) {
      sentiment = 'positive';
      sentiment_score = 0.7;
    } else if (category === 'bug' || category === 'complaint') {
      sentiment = 'negative';
      sentiment_score = -0.6;
    } else {
      sentiment = 'neutral';
      sentiment_score = 0;
    }
    if (input.rating != null) sentiment_score = Math.max(-1, Math.min(1, sentiment_score + (input.rating - 3) * 0.15));

    // severity
    const critical = countHits(text, SEVERITY_CRITICAL).n > 0;
    let severity: 'low' | 'medium' | 'high' | 'critical';
    if (category === 'bug' && critical) severity = 'critical';
    else if (category === 'bug') severity = 'high';
    else if (category === 'complaint') severity = 'medium';
    else severity = 'low';

    // moderation
    const spamScore = gibberishRatio(input.text_redacted);
    const moderation = {
      is_spam: spamScore > 0.6,
      spam_score: round2(spamScore),
      quality_score: round2(Math.max(0.1, Math.min(1, input.text_redacted.length / 80))),
    };

    // raw_feature_mentions: AREA_MAP 키워드에서 추출
    const mentions = new Set<string>();
    for (const { kw } of AREA_MAP) for (const k of kw) if (lower.includes(k.toLowerCase())) mentions.add(k);

    // entities (간단): app_version 언급
    const entities: { type: string; value: string }[] = [];
    if (input.app_version) entities.push({ type: 'app_version', value: input.app_version });

    // defect (bug일 때만)
    let defect: ClassifyOutput['defect'] = null;
    if (category === 'bug') {
      const area = AREA_MAP.find(({ kw }) => kw.some((k) => lower.includes(k.toLowerCase())))?.area ?? null;
      const errRaw = extractErrorSignature(text);
      const repro = extractReproSteps(input.text_redacted);
      defect = {
        affected_area: area,
        error_signature: errRaw
          ? { raw: errRaw, canonical: null, family: null, stacktrace_fingerprint: null }
          : null,
        reproduction_steps: repro,
        expected_behavior: null,
        actual_behavior: null,
        regression_version_hint: extractVersionHint(text) ?? input.app_version,
      };
    }

    return {
      classification: {
        category,
        category_confidence: round2(category_confidence),
        sentiment,
        sentiment_score: round2(sentiment_score),
        severity,
        is_resolution_report: isRes,
      },
      extraction: { raw_feature_mentions: [...mentions], entities },
      moderation,
      defect,
      usage: usage('stub/sonnet-4.6', text.length, 120),
      escalated,
    };
  }

  async prefilterEscalation(text: string): Promise<PrefilterEscalationOutput> {
    return { is_spam: gibberishRatio(text) > 0.7, usage: usage('stub/haiku-4.5', text.length, 5) };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// 반복문자/특수문자 비율로 spam/gibberish 추정
function gibberishRatio(text: string): number {
  if (!text) return 1;
  const t = text.trim();
  if (t.length < 3) return 0.9;
  const repeat = /(.)\1{5,}/.test(t) ? 0.5 : 0; // aaaaaa
  const urlBomb = (t.match(/https?:\/\//g)?.length ?? 0) >= 3 ? 0.5 : 0;
  const nonWord = (t.replace(/[\p{L}\p{N}\s]/gu, '').length / t.length) > 0.5 ? 0.4 : 0;
  return Math.min(1, repeat + urlBomb + nonWord);
}

function extractErrorSignature(text: string): string | null {
  const m =
    text.match(/null\s*pointer|nullpointerexception|npe|nil\b/i) ??
    text.match(/\b[45]\d{2}\b\s*(error|에러)?/i) ??
    text.match(/강제\s*종료|튕(겨|김|기)|크래시|crash|force\s*close/i) ?? // crash류
    text.match(/멈춤|멈춰|먹통|freeze|frozen|무한\s*로딩/i) ?? // hang류
    text.match(/\b(error|에러|오류)\s*(code\s*)?[:#]?\s*\w+/i);
  return m ? m[0] : null;
}

function extractReproSteps(text: string): string[] {
  const steps: string[] = [];
  // "~할 때", "~누르면", "~하면" 패턴
  const patterns = [/([^.。!?\n]{4,40}?)(할 때|누르면|하면|을 누르면|를 누르면)/g];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) steps.push(`${m[1] ?? ''}${m[2] ?? ''}`.trim());
  }
  return steps.slice(0, 3);
}

function extractVersionHint(text: string): string | null {
  const m = text.match(/\b(?:v|버전\s*)?(\d+\.\d+(?:\.\d+)?)\b/i);
  return m ? m[1]! : null;
}
