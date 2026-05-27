import { randomUUID } from 'node:crypto';
import type { PipelineCtx } from '../../contracts/stage.js';
import { RawReviewSchema, type RawReview } from '../../contracts/raw-review.js';
import {
  ProcessedReviewSchema,
  type ProcessedReview,
  type Inferences,
  type LlmCallRecord,
} from '../../contracts/processed-review.js';
import { runCached } from './runner.js';
import { normalize } from '../stages/normalize.js';
import { detectLanguage } from '../stages/detect-language.js';
import { extractPII } from '../stages/extract-pii.js';
import { prefilter } from '../stages/prefilter.js';
import { translate } from '../stages/translate.js';
import { dedup } from '../stages/dedup.js';
import { semanticCache } from '../stages/semantic-cache.js';
import { classifyExtractModerate } from '../stages/classify-extract-moderate.js';
import { mapFeature } from '../stages/map-feature.js';
import { mapCodeArtifacts } from '../stages/map-code-artifacts.js';
import { config } from '../../config.js';
import { aggregateSignal, recordResolutionReport } from '../stages/aggregate-signal.js';
import { canonicalizeErrorSignature } from '../../util/error-signature.js';
import { simhash64 } from '../../util/simhash.js';
import { escalationReasons, isLowConfidence } from '../escalation.js';

// per-review 처리 결과 요약 (funnel/관찰가능성용)
export interface ProcessOutcome {
  raw_review_id: string;
  source_id: string;
  status: 'dropped_prefilter' | 'duplicate' | 'cache_hit' | 'classified';
  reason?: string;
  near_duplicates?: string[];
  cache_cosine?: number;
  human_review_reasons?: string[];
  low_confidence?: boolean;
  processed_review?: ProcessedReview;
  stage_cache_hits: number;
  llm_calls: LlmCallRecord[];
  signal?: { matched_by: string; created_group: boolean; corroboration: number };
}

// Phase 1 — per-review 파이프라인. 의존성 순서상 embed를 dedup/semanticCache 앞에서 1회 계산해
// 재사용한다(spec §4.4/§4.5b가 벡터를 요구). Phase 2(aggregateSignal)는 다음 레이어 — signal=null.
export async function processReview(raw: unknown, ctx: PipelineCtx): Promise<ProcessOutcome> {
  const review: RawReview = RawReviewSchema.parse(raw);
  const rawRow = await ctx.db.insertRawReview(review.source, review.source_id, review, review.ingested_at);
  const id = rawRow.id;
  const v = ctx.versions;
  const m = ctx.metrics;
  m.inc('funnel.in');
  const llm_calls: LlmCallRecord[] = [];
  let cacheHits = 0;
  const track = <T>(r: { cached: boolean; llm_call?: LlmCallRecord; value: T }): T => {
    if (r.cached) cacheHits++;
    if (r.llm_call) llm_calls.push(r.llm_call);
    return r.value;
  };

  // 4.0 prefilter
  const pf = await prefilter(review, ctx.llm);
  if (pf.llm_call) llm_calls.push(pf.llm_call);
  if (!pf.kept) {
    m.inc('funnel.prefilter_drop');
    await ctx.db.markFiltered(id, pf.reason ?? 'spam');
    return { raw_review_id: id, source_id: review.source_id, status: 'dropped_prefilter', reason: pf.reason, stage_cache_hits: cacheHits, llm_calls };
  }

  // 4.1 normalize → 4.2 detectLanguage → 4.3 extractPII
  const norm = track(await runCached(ctx, id, 'normalize', v.pipeline, { text: review.text }, async (i) => ({ value: normalize(i.text) })));
  const lang = track(await runCached(ctx, id, 'detectLanguage', v.pipeline, { t: norm.text_normalized }, async (i) => ({ value: detectLanguage(i.t) })));
  const pii = track(await runCached(ctx, id, 'extractPII', v.pii, { t: norm.text_normalized }, async (i) => ({ value: extractPII(i.t) })));
  // PII compliance metric (spec §8) + language drift 분포
  for (const p of pii.pii_found) for (let k = 0; k < p.count; k++) m.count('pii.type', p.type);
  if (pii.pii_found.length) m.inc('pii.reviews_with_pii');
  m.count('dist.language', lang.language);
  m.observe('confidence.language', lang.language_confidence);
  if (lang.language === 'unknown') m.inc('confidence.unknown_language');

  // 4.5 translate (conditional)
  const tr = track(
    await runCached(ctx, id, 'translate', v.translator, { t: pii.text_redacted, l: lang.language }, async (i) => {
      const r = await translate(i.t, i.l, ctx.llm);
      return { value: { text_en: r.text_en }, llm_call: r.llm_call };
    }),
  );

  // 4.8 embed (일찍 계산 — dedup/semanticCache 입력)
  const emb = track(
    await runCached(ctx, id, 'embed', v.embedder, { t: pii.text_redacted }, async (i) => {
      const r = await ctx.embedder.embed(i.t);
      const call: LlmCallRecord = { stage: 'embed', model: r.model, tokens_in: i.t.length, tokens_out: 0, cached_tokens: 0, duration_ms: 1 };
      return { value: r, llm_call: call };
    }),
  );
  const vector = emb.vector;

  // SimHash 저장 (어휘 dedup 후보)
  const sh = simhash64(pii.text_redacted);
  await ctx.db.setSimhash(id, sh);

  // 4.4 dedup (stateful — 캐시 안 함)
  const dd = await dedup(id, sh, vector, ctx.db);
  if (dd.is_duplicate && dd.duplicate_of) {
    m.inc('funnel.dedup_dup');
    await ctx.db.markDuplicate(id, dd.duplicate_of);
    return { raw_review_id: id, source_id: review.source_id, status: 'duplicate', reason: `dup_of=${dd.duplicate_of} (${dd.band})`, near_duplicates: dd.near_duplicates, stage_cache_hits: cacheHits, llm_calls };
  }
  if (dd.near_duplicates.length) m.inc('dedup.near');

  const facts = {
    text_original: review.text,
    text_normalized: norm.text_normalized,
    text_redacted: pii.text_redacted,
    language: lang.language,
    language_confidence: lang.language_confidence,
    rating: review.rating ?? null,
    app_version: review.app_version ?? null,
    platform: review.platform ?? null,
    locale: review.locale ?? null,
    created_at: review.created_at,
  };

  // 4.5b semanticCache → hit이면 classify skip
  const sc = await semanticCache(vector, v.classifier, ctx.db, id);
  let inferences: Inferences;
  let humanReasons: string[] = [];
  let lowConf = false;
  let cacheCosine: number | undefined;

  if (sc.hit && sc.cached_inferences) {
    cacheCosine = sc.cosine;
    m.inc('cache.semantic_hit');
    // 캐시된 inference 재사용하되, feature/code/signal은 이 리뷰 기준으로 다시 계산하지 않고 그대로 승계
    inferences = sc.cached_inferences;
  } else {
    m.inc('cache.semantic_miss');
    // 4.6 classifyExtractModerate
    const cls = track(
      await runCached(ctx, id, 'classifyExtractModerate', v.classifier, { t: pii.text_redacted, en: tr.text_en, r: facts.rating, av: facts.app_version }, async (i) => {
        const r = await classifyExtractModerate({ text_redacted: i.t, text_en: i.en, rating: i.r, app_version: i.av }, ctx.llm);
        const call: LlmCallRecord = { stage: 'classify_extract_moderate', model: r.result.usage.model, tokens_in: r.result.usage.tokens_in, tokens_out: r.result.usage.tokens_out, cached_tokens: r.result.usage.cached_tokens, duration_ms: r.result.usage.duration_ms };
        return { value: r, llm_call: call };
      }),
    );
    const c = cls.result;
    m.inc('classify.total');
    if (cls.result.escalated) m.inc('classify.escalated');
    if (cls.low_confidence) m.inc('classify.low_confidence');

    // 4.7' mapFeature (P1, Claude-as-judge) — actionable 카테고리만. grounded/defective/gap.
    let featureMapping: Inferences['extraction']['feature_mapping'] = null;
    let featureIds: string[] = [];
    const mapCats = ['bug', 'feature_request', 'complaint'].includes(c.classification.category);
    m.inc('feature.mentions', c.extraction.raw_feature_mentions.length);
    if (mapCats) {
      featureMapping = await mapFeature(
        { text: tr.text_en ?? pii.text_redacted, affected_area: c.defect?.affected_area ?? null, category: c.classification.category, mentions: c.extraction.raw_feature_mentions, reviewVector: vector },
        ctx.db, ctx.llm, config.targetRepo,
      );
      m.inc(`feature.${featureMapping.state}`);
      if (featureMapping.state !== 'gap' && featureMapping.feature_id) featureIds = [featureMapping.feature_id];
    }

    // 4.7b mapCodeArtifacts (bug + grounded/defective feature → 모듈 코드) + error_signature 정규화
    let defect: Inferences['defect'] = null;
    if (c.classification.category === 'bug' && c.defect) {
      const code = await mapCodeArtifacts(featureIds, c.defect.affected_area, ctx.db, ctx.embedder);
      let errSig = c.defect.error_signature;
      if (errSig) {
        const canon = canonicalizeErrorSignature(errSig.raw);
        errSig = { ...errSig, canonical: canon.canonical, family: canon.family };
      }
      defect = { ...c.defect, error_signature: errSig, artifact_matches: code.artifact_matches };
    }

    const isActionable = (c.classification.category === 'bug' || c.classification.category === 'feature_request') && !c.moderation.is_spam;
    const fMatch = featureMapping && featureMapping.feature_id && featureMapping.state !== 'gap'
      ? [{ feature_id: featureMapping.feature_id, score: featureMapping.confidence, status: 'auto_verified' as const }]
      : [];
    inferences = {
      text_en: tr.text_en,
      classification: c.classification,
      extraction: { feature_ids: featureIds, feature_matches: fMatch, raw_feature_mentions: c.extraction.raw_feature_mentions, entities: c.extraction.entities, feature_mapping: featureMapping },
      moderation: { is_spam: c.moderation.is_spam, spam_score: c.moderation.spam_score, pii_redacted: pii.pii_found.length > 0, pii_types: pii.pii_found.map((p) => p.type), quality_score: c.moderation.quality_score },
      defect,
      signal: null, // Phase 2 — 다음 레이어
      is_actionable: isActionable,
    };

  }

  // Escalation reasons (critical/refund_legal/low_confidence) recomputed from the finalized
  // inferences on BOTH paths. Cache HIT reuses cached inferences and skips classify, so deriving
  // here (not only inside the classify stage) ensures cache hits still escalate to the human queue.
  humanReasons.push(
    ...escalationReasons({
      severity: inferences.classification.severity,
      categoryConfidence: inferences.classification.category_confidence,
      text: `${facts.text_redacted} ${inferences.text_en ?? ''}`,
    }),
  );
  lowConf = isLowConfidence(inferences.classification.category_confidence);

  // gap → Insight 큐, enhancement → 개선 요청 큐. inferences 기준이라 cache HIT 리뷰도 큐잉됨 (#5 fix —
  // 이전엔 miss 분기에만 있어 캐시 히트 시 gap/enhancement가 사람 큐에서 누락됐다).
  const fmState = inferences.extraction.feature_mapping?.state;
  if (fmState === 'gap') humanReasons.push('feature_gap');
  else if (fmState === 'enhancement') humanReasons.push('feature_enhancement');

  // --- 분포/품질 metric (classified·cache_hit 양쪽 공통, inferences 기준) ---
  m.inc('funnel.classified');
  const cls2 = inferences.classification;
  m.count('dist.category', cls2.category);
  m.count('dist.sentiment', cls2.sentiment);
  m.count('dist.spam', inferences.moderation.is_spam ? 'spam' : 'ham');
  m.observe('confidence.classifier', cls2.category_confidence);
  if (inferences.is_actionable) m.inc('funnel.actionable');
  if (inferences.defect) {
    m.inc('defect.bugs');
    if (inferences.defect.artifact_matches.length) m.inc('defect.code_mapped');
    if (inferences.defect.error_signature?.canonical) m.inc('defect.error_sig');
  }

  // 멱등성: 기존 처리분이 있으면 그 id를 재사용 (persist의 ON CONFLICT가 옛 id를 유지하므로
  // Phase 2/embeddings가 같은 id를 봐야 함). 없으면 새 UUID.
  const stableId = (await ctx.db.existingProcessedId(review.source, review.source_id)) ?? randomUUID();
  const pr: ProcessedReview = ProcessedReviewSchema.parse({
    id: stableId,
    source: review.source,
    source_id: review.source_id,
    raw_review_id: id,
    facts,
    inferences,
    versions: v,
    processed_at: ctx.now().toISOString(),
    llm_calls,
  });

  await ctx.db.persistProcessed(pr, vector, emb.model);

  // === Phase 2: aggregateSignal (cross-review, stateful) — persist 후 ===
  let signalInfo: { matched_by: string; created_group: boolean; corroboration: number } | undefined;
  const aggInput = { processed_review_id: pr.id, embedding: vector, inferences, app_version: facts.app_version, platform: facts.platform, created_at: facts.created_at };
  if (inferences.defect) {
    const agg = await aggregateSignal(aggInput, ctx.db);
    if (agg) {
      pr.inferences.signal = agg.signal; // 인메모리 스냅샷 갱신 (DB는 aggregateSignal이 이미 update)
      signalInfo = { matched_by: agg.matched_by, created_group: agg.created_group, corroboration: agg.signal.corroboration_count };
      m.inc('signal.assigned');
      if (agg.created_group) m.inc('signal.new_group');
      m.observe('signal.corroboration', agg.signal.corroboration_count);
    }
  } else if (inferences.classification.is_resolution_report) {
    await recordResolutionReport(aggInput, ctx.db); // negative evidence 캡처(#5)
  }

  // 비-confidence escalation → 사람 큐
  for (const reason of [...new Set(humanReasons)]) {
    await ctx.db.enqueueHumanReview(id, reason, { category: inferences.classification.category, severity: inferences.classification.severity });
  }

  return {
    raw_review_id: id,
    source_id: review.source_id,
    status: sc.hit ? 'cache_hit' : 'classified',
    cache_cosine: cacheCosine,
    near_duplicates: dd.near_duplicates.length ? dd.near_duplicates : undefined,
    human_review_reasons: humanReasons.length ? [...new Set(humanReasons)] : undefined,
    low_confidence: lowConf,
    processed_review: pr,
    stage_cache_hits: cacheHits,
    llm_calls,
    signal: signalInfo,
  };
}
