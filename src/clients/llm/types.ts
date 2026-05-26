import type {
  Category,
  ArtifactMatchSchema,
  ErrorSignatureSchema,
} from '../../contracts/processed-review.js';
import type { z } from 'zod';

// 교체 가능한 LLM 인터페이스. 파이프라인은 이 인터페이스만 알고 누가 진짜인지 모른다.
//   StubLlmClient      — 규칙 기반, 키 0, 비용 0, 결정론적 (현재 기본)
//   AnthropicLlmClient — 진짜 Sonnet/Haiku/Opus (키 생기면 LLM_CLIENT=anthropic로 스위치)

export interface LlmUsage {
  model: string;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  duration_ms: number;
}

export interface TranslateInput {
  text_redacted: string;
  language: string;
}
export interface TranslateOutput {
  text_en: string;
  usage: LlmUsage;
}

// classifyExtractModerate — 단일 호출 / 3 logical result + defect (spec §4.6)
export interface ClassifyInput {
  text_redacted: string;
  text_en: string | null;
  rating: number | null;
  app_version: string | null;
}

export interface ClassifyOutput {
  classification: {
    category: Category;
    category_confidence: number;
    sentiment: 'positive' | 'neutral' | 'negative';
    sentiment_score: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    is_resolution_report: boolean;
  };
  extraction: {
    raw_feature_mentions: string[];
    entities: { type: string; value: string }[];
  };
  moderation: {
    is_spam: boolean;
    spam_score: number;
    quality_score: number;
  };
  // category=bug일 때만 (artifact_matches는 mapCodeArtifacts에서 채움)
  defect: {
    affected_area: string | null;
    error_signature: z.infer<typeof ErrorSignatureSchema> | null;
    reproduction_steps: string[];
    expected_behavior: string | null;
    actual_behavior: string | null;
    regression_version_hint: string | null;
  } | null;
  usage: LlmUsage;
  escalated: boolean; // confidence<0.6로 더 큰 모델 재호출했는지
}

// prefilter escalation (옵션) — 애매한 spam 구간만
export interface PrefilterEscalationOutput {
  is_spam: boolean;
  usage: LlmUsage;
}

export interface LlmClient {
  readonly kind: 'stub' | 'anthropic';
  translate(input: TranslateInput): Promise<TranslateOutput>;
  classifyExtractModerate(input: ClassifyInput): Promise<ClassifyOutput>;
  prefilterEscalation(text: string): Promise<PrefilterEscalationOutput>;
}

// 미사용 import 경고 회피용 re-export
export type ArtifactMatch = z.infer<typeof ArtifactMatchSchema>;
