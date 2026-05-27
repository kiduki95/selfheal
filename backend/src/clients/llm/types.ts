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
//   grounded    = 기존 기능에 매핑 (일반 언급/칭찬/질문)
//   defective   = 기존 기능인데 "고장/안 됨"을 보고
//   enhancement = 기존 기능이 있으나 사용자가 개선/확장을 원함 (그 기능에 매핑 + 개선요청 플래그)
//   gap         = 관련 기존 기능이 전혀 없음 = 미구현 (floating)
export type FeatureState = 'grounded' | 'defective' | 'enhancement' | 'gap';
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

// ② codeflow 기능 설명 보강 (스캔당 1회) — 코드 심볼 → 사용자어 라벨/설명.
export interface DescribeFeatureInput {
  symbol: string;
  module: string;
  signature: string;
}
export interface DescribeFeatureOutput {
  label: string; // 사용자어 기능명 (예: "실시간 차트")
  description: string;
}

// ① sub-feature 열거 — 한 컴포넌트 안의 여러 사용자 기능을 분해 (스캔당 1회).
export interface EnumerateSubFeaturesInput {
  component: string; // 컴포넌트 사용자어 라벨 (예: "매수/매도 주문")
  module: string;
  uiSurface: string; // 결정론 추출된 UI 요소 목록
}
export interface SubFeature {
  label: string; // 한국어 sub-feature명 (예: "골든크로스 매수 조건")
  description: string;
  anchors: string[]; // 관련 UI 요소 id/라벨 (예: ["golden-cross-condition"])
}
export interface EnumerateSubFeaturesOutput {
  subFeatures: SubFeature[]; // 단순 컴포넌트면 빈 배열
}

// Insight: gap(미구현 요청) → 코드 모듈맵 기반 배치 제안 + issue 초안.
export interface ProposeGapInput {
  gap: string;
  gapDescription: string;
  // 타깃 codebase의 모듈→기능 맵 + 실제 import 의존성(code_edges) — grounding 근거
  modules: { module: string; features: string[]; imports?: string[] }[];
}
export interface ProposeGapOutput {
  placement: 'existing_module' | 'new_module';
  module: string; // 기존 모듈명 또는 제안 신규 모듈명
  connection: string; // 어떤 기존 모듈과 어떻게 연결되는지 (사람용 설명)
  connections?: string[]; // ⑦ structured: existing module names referenced → exact grounding check (no regex)
  title: string;
  body: string; // GitHub issue 본문(markdown)
}

// Insight: 파편화된 gap(미구현 요청)을 같은 의도끼리 클러스터링 (중복 issue 방지).
export interface ClusterGapsInput {
  gaps: { id: string; label: string; sample: string }[];
}
export interface ClusterGapsOutput {
  clusters: { canonical_label: string; member_ids: string[] }[];
}

export interface LlmClient {
  readonly kind: 'stub' | 'anthropic';
  translate(input: TranslateInput): Promise<TranslateOutput>;
  classifyExtractModerate(input: ClassifyInput): Promise<ClassifyOutput>;
  prefilterEscalation(text: string): Promise<PrefilterEscalationOutput>;
  mapFeature(input: MapFeatureInput): Promise<MapFeatureOutput>;
  describeFeature(input: DescribeFeatureInput): Promise<DescribeFeatureOutput>;
  enumerateSubFeatures(input: EnumerateSubFeaturesInput): Promise<EnumerateSubFeaturesOutput>;
  proposeGapPlacement(input: ProposeGapInput): Promise<ProposeGapOutput>;
  clusterGaps(input: ClusterGapsInput): Promise<ClusterGapsOutput>;
}

// 미사용 import 경고 회피용 re-export
export type ArtifactMatch = z.infer<typeof ArtifactMatchSchema>;
