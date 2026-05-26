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

// P1: feature mapper (Claude-as-judge). 임베더가 후보를 추리고, LLM이 최종 판단.
//   grounded  = 기존 기능에 매핑
//   defective = 기존 기능인데 "고장/안 됨"을 보고 (여전히 매핑되지만 상태 구분)
//   gap       = 후보 중 진짜 매칭 없음 = 미구현/요청 기능 (floating)
export type FeatureState = 'grounded' | 'defective' | 'gap';
export interface FeatureCandidate {
  feature_id: string;
  label: string;
  description: string;
}
export interface MapFeatureInput {
  text: string; // text_en ?? text_redacted
  affected_area: string | null;
  category: string;
  candidates: FeatureCandidate[];
}
export interface MapFeatureOutput {
  state: FeatureState;
  feature_id: string | null; // grounded/defective → 매칭 후보 id, gap → null
  confidence: number;
  reason: string;
  usage?: LlmUsage;
}

// ② graphify 기능 설명 보강 (스캔당 1회) — 코드 심볼 → 사용자어 라벨/설명.
export interface DescribeFeatureInput {
  symbol: string;
  module: string;
  signature: string;
}
export interface DescribeFeatureOutput {
  label: string; // 사용자어 기능명 (예: "실시간 차트")
  description: string;
}

export interface LlmClient {
  readonly kind: 'stub' | 'anthropic';
  translate(input: TranslateInput): Promise<TranslateOutput>;
  classifyExtractModerate(input: ClassifyInput): Promise<ClassifyOutput>;
  prefilterEscalation(text: string): Promise<PrefilterEscalationOutput>;
  mapFeature(input: MapFeatureInput): Promise<MapFeatureOutput>;
  describeFeature(input: DescribeFeatureInput): Promise<DescribeFeatureOutput>;
}

// 미사용 import 경고 회피용 re-export
export type ArtifactMatch = z.infer<typeof ArtifactMatchSchema>;
