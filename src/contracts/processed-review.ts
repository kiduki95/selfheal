import { z } from 'zod';

// 출력 컨트랙트 (spec §3). Fact / Inference 분리가 핵심.
//   facts      = 소스 결정 사실, 재처리 불변
//   inferences = 모델 결과, versions로 재계산 가능
//   versions   = per-component 버전 → fine-grained 부분 재처리

export const CategoryEnum = z.enum([
  'bug',
  'feature_request',
  'praise',
  'complaint',
  'question',
  'other',
]);
export type Category = z.infer<typeof CategoryEnum>;

export const FactsSchema = z.object({
  text_original: z.string(),
  text_normalized: z.string(), // NFC + 공백/제어문자 정리
  text_redacted: z.string(), // PII 마스킹 후 — 모든 downstream LLM/embed 입력
  language: z.string(), // ISO 639-1, 'unknown' 가능
  language_confidence: z.number(),
  rating: z.number().nullable(),
  app_version: z.string().nullable(),
  platform: z.string().nullable(),
  locale: z.string().nullable(),
  created_at: z.string(),
});
export type Facts = z.infer<typeof FactsSchema>;

export const ClassificationSchema = z.object({
  category: CategoryEnum,
  category_confidence: z.number().min(0).max(1),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  sentiment_score: z.number().min(-1).max(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  is_resolution_report: z.boolean(), // #5: "이제 잘 돼요/고쳐짐" 신호
});

export const FeatureMatchSchema = z.object({
  feature_id: z.string(),
  score: z.number(),
  status: z.enum(['auto_verified', 'pending_review', 'rejected']),
});

export const ExtractionSchema = z.object({
  feature_ids: z.array(z.string()),
  feature_matches: z.array(FeatureMatchSchema),
  raw_feature_mentions: z.array(z.string()),
  entities: z.array(z.object({ type: z.string(), value: z.string() })),
});

export const ModerationSchema = z.object({
  is_spam: z.boolean(),
  spam_score: z.number().min(0).max(1),
  pii_redacted: z.boolean(),
  pii_types: z.array(z.string()),
  quality_score: z.number().min(0).max(1),
});

export const ArtifactMatchSchema = z.object({
  artifact_id: z.string(),
  score: z.number(),
  source: z.enum(['feature_link', 'semantic_match', 'historical_signature']),
  reason: z.string().nullable(),
});

export const ErrorSignatureSchema = z.object({
  raw: z.string(),
  canonical: z.string().nullable(),
  family: z.string().nullable(),
  stacktrace_fingerprint: z.string().nullable(),
});

export const DefectSchema = z.object({
  affected_area: z.string().nullable(),
  artifact_matches: z.array(ArtifactMatchSchema),
  error_signature: ErrorSignatureSchema.nullable(),
  reproduction_steps: z.array(z.string()),
  expected_behavior: z.string().nullable(),
  actual_behavior: z.string().nullable(),
  regression_version_hint: z.string().nullable(),
});

export const SignalSchema = z.object({
  signal_group_id: z.string(),
  corroboration_count: z.number(),
  affected_versions: z.array(z.string()),
  affected_platforms: z.array(z.string()),
  trend: z.enum(['new', 'rising', 'stable', 'declining']),
  first_seen: z.string(),
  last_seen: z.string(),
});

export const InferencesSchema = z.object({
  text_en: z.string().nullable(),
  classification: ClassificationSchema,
  extraction: ExtractionSchema,
  moderation: ModerationSchema,
  defect: DefectSchema.nullable(), // category=bug일 때만
  signal: SignalSchema.nullable(), // Phase 2 결과 — 다음 레이어. Phase 1에선 null.
  is_actionable: z.boolean(), // derived
});
export type Inferences = z.infer<typeof InferencesSchema>;

export const VersionsSchema = z.object({
  pipeline: z.string(),
  pii: z.string(),
  translator: z.string(),
  classifier: z.string(),
  extractor: z.string(),
  moderator: z.string(),
  code_mapper: z.string(),
  aggregator: z.string(),
  embedder: z.string(),
});
export type Versions = z.infer<typeof VersionsSchema>;

export const LlmCallRecordSchema = z.object({
  stage: z.enum(['translate', 'classify_extract_moderate', 'embed', 'prefilter_escalation']),
  model: z.string(),
  tokens_in: z.number(),
  tokens_out: z.number(),
  cached_tokens: z.number(),
  duration_ms: z.number(),
});
export type LlmCallRecord = z.infer<typeof LlmCallRecordSchema>;

export const ProcessedReviewSchema = z.object({
  id: z.string(),
  source: z.string(),
  source_id: z.string(),
  raw_review_id: z.string(),
  facts: FactsSchema,
  inferences: InferencesSchema,
  versions: VersionsSchema,
  processed_at: z.string(),
  llm_calls: z.array(LlmCallRecordSchema),
});
export type ProcessedReview = z.infer<typeof ProcessedReviewSchema>;
