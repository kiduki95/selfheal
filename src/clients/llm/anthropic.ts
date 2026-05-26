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

// 진짜 Anthropic 구현 — 키 생기면 LLM_CLIENT=anthropic로 활성화. SDK 없이 fetch만 사용.
// 모델: classify=Sonnet 4.6, translate=Haiku 4.5, escalation=Opus 4.7 (spec §7).
// tool use로 structured output 강제(category enum). 프롬프트 캐싱은 system을 ephemeral로.

const API = 'https://api.anthropic.com/v1/messages';
const MODELS = {
  translate: 'claude-haiku-4-5-20251001',
  classify: 'claude-sonnet-4-6',
  escalate: 'claude-opus-4-7',
} as const;

const CLASSIFY_TOOL = {
  name: 'extract_review_signals',
  description: 'Extract structured classification, extraction, moderation, and (for bugs) defect signals from an app review.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['bug', 'feature_request', 'praise', 'complaint', 'question', 'other'] },
      category_confidence: { type: 'number' },
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
      sentiment_score: { type: 'number' },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      is_resolution_report: { type: 'boolean' },
      raw_feature_mentions: { type: 'array', items: { type: 'string' } },
      entities: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, value: { type: 'string' } }, required: ['type', 'value'] } },
      is_spam: { type: 'boolean' },
      spam_score: { type: 'number' },
      quality_score: { type: 'number' },
      defect: {
        type: ['object', 'null'],
        properties: {
          affected_area: { type: ['string', 'null'] },
          error_signature_raw: { type: ['string', 'null'] },
          reproduction_steps: { type: 'array', items: { type: 'string' } },
          expected_behavior: { type: ['string', 'null'] },
          actual_behavior: { type: ['string', 'null'] },
          regression_version_hint: { type: ['string', 'null'] },
        },
      },
    },
    required: ['category', 'category_confidence', 'sentiment', 'sentiment_score', 'severity', 'is_resolution_report', 'raw_feature_mentions', 'entities', 'is_spam', 'spam_score', 'quality_score'],
  },
} as const;

const SYSTEM = `You triage mobile app reviews for an automated bug-fixing system. Output ONLY via the extract_review_signals tool. Be precise: category must reflect the dominant intent. category_confidence in [0,1]. For category=bug, fill defect with the affected feature area, any error signature mentioned, and reproduction steps if present.`;

export class AnthropicLlmClient implements LlmClient {
  readonly kind = 'anthropic' as const;
  constructor(private apiKey: string) {}

  private async call(body: unknown): Promise<{ json: any; usage: LlmUsage; model: string }> {
    const t0 = Date.now();
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as any;
    const model = (body as any).model as string;
    const usage: LlmUsage = {
      model,
      tokens_in: json.usage?.input_tokens ?? 0,
      tokens_out: json.usage?.output_tokens ?? 0,
      cached_tokens: json.usage?.cache_read_input_tokens ?? 0,
      duration_ms: Date.now() - t0,
    };
    return { json, usage, model };
  }

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    const { json, usage } = await this.call({
      model: MODELS.translate,
      max_tokens: 1024,
      system: [{ type: 'text', text: 'Translate the user text to natural English. Output only the translation.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: input.text_redacted }],
    });
    const text_en = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    return { text_en, usage };
  }

  async classifyExtractModerate(input: ClassifyInput): Promise<ClassifyOutput> {
    const userText = input.text_en
      ? `Review (original + EN):\n${input.text_redacted}\n---\n${input.text_en}`
      : `Review:\n${input.text_redacted}`;
    const meta = `\n(rating=${input.rating ?? 'n/a'}, app_version=${input.app_version ?? 'n/a'})`;

    const run = (model: string) =>
      this.call({
        model,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
        messages: [{ role: 'user', content: userText + meta }],
      });

    let { json, usage } = await run(MODELS.classify);
    let out = toolInput(json);
    let escalated = false;
    if ((out.category_confidence ?? 0) < thresholds.classifyLowConf) {
      escalated = true;
      ({ json, usage } = await run(MODELS.escalate));
      out = toolInput(json);
    }

    const defect = out.defect
      ? {
          affected_area: out.defect.affected_area ?? null,
          error_signature: out.defect.error_signature_raw
            ? { raw: out.defect.error_signature_raw, canonical: null, family: null, stacktrace_fingerprint: null }
            : null,
          reproduction_steps: out.defect.reproduction_steps ?? [],
          expected_behavior: out.defect.expected_behavior ?? null,
          actual_behavior: out.defect.actual_behavior ?? null,
          regression_version_hint: out.defect.regression_version_hint ?? null,
        }
      : null;

    return {
      classification: {
        category: out.category,
        category_confidence: out.category_confidence,
        sentiment: out.sentiment,
        sentiment_score: out.sentiment_score,
        severity: out.severity,
        is_resolution_report: out.is_resolution_report,
      },
      extraction: { raw_feature_mentions: out.raw_feature_mentions ?? [], entities: out.entities ?? [] },
      moderation: { is_spam: out.is_spam, spam_score: out.spam_score, quality_score: out.quality_score },
      defect: out.category === 'bug' ? defect : null,
      usage,
      escalated,
    };
  }

  async mapFeature(input: MapFeatureInput): Promise<MapFeatureOutput> {
    if (input.candidates.length === 0) return { state: 'gap', feature_id: null, confidence: 0.5, reason: 'no candidate features' };
    const list = input.candidates.map((c, i) => `${i + 1}. ${c.label} — ${c.description}`).join('\n');
    const { json, usage } = await this.call({
      model: MODELS.classify,
      max_tokens: 256,
      system: [{ type: 'text', text: 'Map the review to one existing feature. state: defective(broken existing)|enhancement(improve existing)|grounded(mention existing)|gap(NO related feature, feature=0). 기존 기능의 개선요청은 enhancement(gap 아님). Output ONLY JSON {"feature":int,"state":string,"confidence":number,"reason":string}.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Features:\n${list}\n\nReview (category=${input.category}):\n${input.text}${input.affected_area ? `\nAffected: ${input.affected_area}` : ''}` }],
    });
    const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    const o = m ? JSON.parse(m[0]) : { feature: 0, state: 'gap', confidence: 0.5, reason: 'parse fail' };
    const n = Number(o.feature ?? 0);
    const st = ['grounded', 'defective', 'enhancement', 'gap'].includes(o.state) ? o.state : 'grounded';
    const feature_id = st !== 'gap' && n >= 1 && n <= input.candidates.length ? input.candidates[n - 1]!.feature_id : null;
    return { state: feature_id ? st : 'gap', feature_id, confidence: o.confidence ?? 0.7, reason: o.reason ?? '', usage };
  }

  async describeFeature(input: DescribeFeatureInput): Promise<DescribeFeatureOutput> {
    const { json } = await this.call({
      model: MODELS.translate,
      max_tokens: 200,
      system: [{ type: 'text', text: 'Given a code component, output ONLY JSON {"label":"<Korean user-facing feature name>","description":"<one line>"}.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Symbol: ${input.symbol}\nModule: ${input.module}\nSignature: ${input.signature}` }],
    });
    const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    const o = m ? JSON.parse(m[0]) : { label: input.symbol, description: input.module };
    return { label: o.label || input.symbol, description: o.description || '' };
  }

  async enumerateSubFeatures(input: EnumerateSubFeaturesInput): Promise<EnumerateSubFeaturesOutput> {
    const { json } = await this.call({
      model: MODELS.classify,
      max_tokens: 600,
      system: [{ type: 'text', text: 'Decompose a UI component into distinct user-facing sub-features (Korean). Empty array if it is a single feature. ONLY JSON {"subFeatures":[{"label","description","anchors":[]}]}.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Component: ${input.component} (${input.module})\nUI elements: ${input.uiSurface}` }],
    });
    const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    try {
      const o = m ? JSON.parse(m[0]) : { subFeatures: [] };
      const subs = Array.isArray(o.subFeatures) ? o.subFeatures : [];
      return { subFeatures: subs.filter((s: any) => s && s.label).slice(0, 12).map((s: any) => ({ label: String(s.label), description: String(s.description ?? ''), anchors: Array.isArray(s.anchors) ? s.anchors.map(String) : [] })) };
    } catch {
      return { subFeatures: [] };
    }
  }

  async prefilterEscalation(text: string): Promise<PrefilterEscalationOutput> {
    const { json, usage } = await this.call({
      model: MODELS.translate,
      max_tokens: 16,
      system: [{ type: 'text', text: 'Reply with exactly "SPAM" or "OK".', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: text }],
    });
    const t = (json.content ?? []).map((b: any) => b.text ?? '').join('').toUpperCase();
    return { is_spam: t.includes('SPAM'), usage };
  }
}

function toolInput(json: any): any {
  const block = (json.content ?? []).find((b: any) => b.type === 'tool_use');
  if (!block) throw new Error('Anthropic response missing tool_use block');
  return block.input;
}
