import { spawn } from 'node:child_process';
import type {
  LlmClient,
  TranslateInput,
  TranslateOutput,
  ClassifyInput,
  ClassifyOutput,
  PrefilterEscalationOutput,
  LlmUsage,
  MapFeatureInput,
  MapFeatureOutput,
  DescribeFeatureInput,
  DescribeFeatureOutput,
  EnumerateSubFeaturesInput,
  EnumerateSubFeaturesOutput,
} from './types.js';
import { thresholds } from '../../config.js';

// 구독(subscription) Claude를 쓰는 클라이언트 — 로컬 `claude -p`(headless)를 호출한다.
// Anthropic API(충전식)가 아니라 PC에 로그인된 Claude Code 구독 한도를 소비. 개발 단계용.
// 구조화 출력은 tool-use 대신 "JSON만 출력" 프롬프트 + zod 검증 + bounded retry (spec §7).

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? (process.platform === 'win32' ? 'claude.exe' : 'claude');

interface CliResult {
  result: string;
  usage: LlmUsage;
}

function runClaude(prompt: string, model: 'sonnet' | 'haiku' | 'opus'): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--model', model];
    // shell 미사용(인자는 고정 상수, 프롬프트는 stdin) → 이스케이프/인젝션 무관.
    const child = spawn(CLAUDE_BIN, args, { shell: false });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err || out}`));
      try {
        const j = JSON.parse(out);
        const u = j.usage ?? {};
        resolve({
          result: j.result ?? '',
          usage: {
            model: `claude-cli/${model}`,
            tokens_in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            tokens_out: u.output_tokens ?? 0,
            cached_tokens: u.cache_read_input_tokens ?? 0,
            duration_ms: j.duration_ms ?? 0,
          },
        });
      } catch (e) {
        reject(new Error(`claude output parse failed: ${(e as Error).message}\n${out.slice(0, 500)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// 응답 텍스트에서 JSON 객체만 추출 (code fence/잡설 제거)
function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`no JSON object in response: ${text.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1));
}

const CLASSIFY_PROMPT = (input: ClassifyInput) => `You triage mobile app reviews for an automated bug-fixing system.
Classify the review and extract signals. Respond with ONLY a JSON object (no prose, no code fence) of this exact shape:
{
  "category": "bug|feature_request|praise|complaint|question|other",
  "category_confidence": 0.0-1.0,
  "sentiment": "positive|neutral|negative",
  "sentiment_score": -1.0..1.0,
  "severity": "low|medium|high|critical",
  "is_resolution_report": boolean,            // 과거 문제의 해소를 보고하는 리뷰인가
  "raw_feature_mentions": [string],           // 언급된 기능/화면 표면형 (원문 단어)
  "entities": [{"type": string, "value": string}],
  "is_spam": boolean,
  "spam_score": 0.0-1.0,
  "quality_score": 0.0-1.0,
  "defect": null | {                          // category=bug일 때만, 아니면 null
    "affected_area": string|null,
    "error_signature_raw": string|null,
    "reproduction_steps": [string],
    "expected_behavior": string|null,
    "actual_behavior": string|null,
    "regression_version_hint": string|null
  }
}
Review (rating=${input.rating ?? 'n/a'}, app_version=${input.app_version ?? 'n/a'}):
${input.text_redacted}${input.text_en ? `\n[EN] ${input.text_en}` : ''}`;

export class ClaudeCliLlmClient implements LlmClient {
  readonly kind = 'anthropic' as const; // 버전 태그 목적상 real-LLM 계열로 취급

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    const r = await runClaude(
      `Translate to natural English. Output ONLY the translation, no quotes or notes:\n${input.text_redacted}`,
      'haiku',
    );
    return { text_en: r.result.trim(), usage: r.usage };
  }

  async classifyExtractModerate(input: ClassifyInput): Promise<ClassifyOutput> {
    const run = async (model: 'sonnet' | 'opus') => {
      const r = await runClaude(CLASSIFY_PROMPT(input), model);
      return { json: extractJson(r.result), usage: r.usage };
    };
    let { json: o, usage } = await run('sonnet');
    let escalated = false;
    if ((o.category_confidence ?? 0) < thresholds.classifyLowConf) {
      escalated = true;
      ({ json: o, usage } = await run('opus'));
    }
    const defect = o.category === 'bug' && o.defect
      ? {
          affected_area: o.defect.affected_area ?? null,
          error_signature: o.defect.error_signature_raw
            ? { raw: o.defect.error_signature_raw, canonical: null, family: null, stacktrace_fingerprint: null }
            : null,
          reproduction_steps: o.defect.reproduction_steps ?? [],
          expected_behavior: o.defect.expected_behavior ?? null,
          actual_behavior: o.defect.actual_behavior ?? null,
          regression_version_hint: o.defect.regression_version_hint ?? null,
        }
      : null;
    return {
      classification: {
        category: o.category,
        category_confidence: o.category_confidence,
        sentiment: o.sentiment,
        sentiment_score: o.sentiment_score,
        severity: o.severity,
        is_resolution_report: !!o.is_resolution_report,
      },
      extraction: { raw_feature_mentions: o.raw_feature_mentions ?? [], entities: o.entities ?? [] },
      moderation: { is_spam: !!o.is_spam, spam_score: o.spam_score ?? 0, quality_score: o.quality_score ?? 0.5 },
      defect,
      usage,
      escalated,
    };
  }

  async prefilterEscalation(text: string): Promise<PrefilterEscalationOutput> {
    const r = await runClaude(`Is this app review spam? Reply ONLY "SPAM" or "OK".\n${text}`, 'haiku');
    return { is_spam: /SPAM/i.test(r.result), usage: r.usage };
  }

  // P1: Claude-as-judge feature mapping — 후보 전체를 주고 grounded/defective/gap 판단.
  async mapFeature(input: MapFeatureInput): Promise<MapFeatureOutput> {
    if (input.candidates.length === 0) return { state: 'gap', feature_id: null, confidence: 0.5, reason: 'no candidate features' };
    const list = input.candidates.map((c, i) => `${i + 1}. ${c.label} — ${c.description}`).join('\n');
    const prompt = `You map a user app review to the app's EXISTING features (derived from its codebase).
Features ("모듈 › 세부기능" 형식):
${list}

Review (category=${input.category}):
${input.text}${input.affected_area ? `\nAffected area: ${input.affected_area}` : ''}

Respond ONLY JSON:
{"feature": <feature number, or 0 for gap>, "state": "grounded"|"defective"|"enhancement"|"gap", "confidence": 0..1, "reason": "<short>"}
- "defective": 나열된 기능인데 고장/안 됨/에러.
- "grounded": 나열된 기능 일반 언급/칭찬/질문.
- "enhancement": 나열된 **특정 기능 그 자체**를 더 정밀/편리하게 개선 요청 (그 기능 번호 선택). 예: "RSI 값을 1단위로"→RSI 설정 기능 개선, "초성 검색"→종목 검색 기능 개선.
- "gap": 나열된 기능엔 없는 **새 기능/시스템** 요청 (feature=0). 같은 분야여도 별도로 만들어야 하면 gap. 예: 백테스팅, 해외주식/코인 지원, 텔레그램/외부 연동, 푸시 알림 = 모두 신규 시스템이라 gap.
핵심 판단: **"기존 기능을 손보면 되나?"(enhancement) vs "새 기능을 만들어야 하나?"(gap)**.`;
    const r = await runClaude(prompt, 'sonnet');
    const o = extractJson(r.result);
    const n = Number(o.feature ?? 0);
    const st = ['grounded', 'defective', 'enhancement', 'gap'].includes(o.state) ? o.state : 'grounded';
    const feature_id = st !== 'gap' && n >= 1 && n <= input.candidates.length ? input.candidates[n - 1]!.feature_id : null;
    return { state: feature_id ? st : 'gap', feature_id, confidence: o.confidence ?? 0.7, reason: o.reason ?? '', usage: r.usage };
  }

  // ② 코드 심볼 → 사용자어 기능명/설명 (스캔당 1회). 영문 심볼명을 그대로 두지 말고 한국어로.
  async describeFeature(input: DescribeFeatureInput): Promise<DescribeFeatureOutput> {
    const prompt = `다음은 한 주식 자동매매 앱 코드베이스의 UI 컴포넌트/기능이다.
Symbol: ${input.symbol}
Module/Path: ${input.module}
Signature: ${input.signature}

이 컴포넌트가 사용자에게 제공하는 기능을, **사용자가 부를 법한 짧은 한국어 기능명**으로 지어라.
영문 심볼명(예: StockGraph)을 그대로 두지 말고 반드시 한국어로 번역/의역하라 (예: StockGraph→"실시간 차트", StockTrade→"매수/매도 주문").
ONLY JSON: {"label":"<짧은 한국어 기능명>","description":"<한 줄 설명>"}`;
    const r = await runClaude(prompt, 'sonnet');
    try {
      const o = extractJson(r.result);
      return { label: o.label || input.symbol, description: o.description || '' };
    } catch {
      return { label: input.symbol, description: input.module };
    }
  }

  // ① 한 컴포넌트의 sub-feature 분해 (스캔당 1회). UI surface로 판단.
  async enumerateSubFeatures(input: EnumerateSubFeaturesInput): Promise<EnumerateSubFeaturesOutput> {
    const prompt = `한 주식 자동매매 앱의 컴포넌트 "${input.component}" (${input.module}) 내부 UI 요소 목록:
${input.uiSurface}

이 컴포넌트가 담고 있는 **서로 구별되는 사용자 기능(sub-feature)** 들을 한국어로 분해하라.
- 여러 기능이 한 화면에 모여있으면 각각 분리 (예: "골든크로스 매수 조건", "손절 조건", "RSI 매도 조건").
- 기능이 사실상 하나뿐인 단순 컴포넌트면 빈 배열 반환.
- anchors엔 관련 UI 요소 id/라벨을 넣어라.
ONLY JSON: {"subFeatures":[{"label":"<한국어>","description":"<한 줄>","anchors":["<ui id>"]}]}`;
    const r = await runClaude(prompt, 'sonnet');
    try {
      const o = extractJson(r.result);
      const subs = Array.isArray(o.subFeatures) ? o.subFeatures : [];
      return { subFeatures: subs.filter((s: any) => s && s.label).slice(0, 12).map((s: any) => ({ label: String(s.label), description: String(s.description ?? ''), anchors: Array.isArray(s.anchors) ? s.anchors.map(String) : [] })) };
    } catch {
      return { subFeatures: [] };
    }
  }
}
