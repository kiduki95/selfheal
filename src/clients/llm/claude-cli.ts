import { spawn } from 'node:child_process';
import type {
  LlmClient,
  TranslateInput,
  TranslateOutput,
  ClassifyInput,
  ClassifyOutput,
  PrefilterEscalationOutput,
  LlmUsage,
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
}
