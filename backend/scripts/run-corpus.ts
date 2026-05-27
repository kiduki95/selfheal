import { Db } from '../src/db/db.js';
import { makeContext, processReview, type ProcessOutcome, runReconciliation } from '../src/processing/index.js';
import { CORPUS } from '../corpus/reviews.js';
import { config } from '../src/config.js';
import { InMemoryMetrics } from '../src/observability/metrics.js';
import { psi, psiLabel } from '../src/observability/psi.js';

// 코퍼스를 Phase 1로 처리하고 funnel + 샘플 결과를 출력. "결과 확인"용.
async function main() {
  const db = new Db();
  const metrics = new InMemoryMetrics();
  const ctx = makeContext(db, metrics);

  // 깨끗한 재현을 위해 이전 처리 데이터만 비움 (레지스트리는 보존). FK 순서 주의.
  await db.query('DELETE FROM human_review_queue');
  await db.query('DELETE FROM resolution_signals');
  await db.query('DELETE FROM signal_group_events');
  await db.query('DELETE FROM signal_groups'); // representative_review_id → processed_reviews 참조
  await db.query('DELETE FROM review_embeddings');
  await db.query('DELETE FROM review_stage_outputs');
  await db.query('DELETE FROM processed_reviews');
  await db.query('DELETE FROM unmatched_feature_candidates');
  await db.query(`DELETE FROM feature_registry WHERE status='gap'`); // review-emergent gap — 이번 런 기준 재생성
  await db.query('DELETE FROM raw_reviews');

  console.log(`\n=== selfheal Processing Layer — Phase 1 ===`);
  console.log(`LLM=${config.llmClient}  embedding=${config.embeddingClient}  reviews=${CORPUS.length}\n`);

  const outcomes: ProcessOutcome[] = [];
  for (const r of CORPUS) {
    const o = await processReview(r, ctx);
    outcomes.push(o);
    console.log(line(o));
  }

  printFunnel(outcomes);
  await printDetails(outcomes, db);
  await printFeatureMapping(outcomes, db);
  await printSignalGroups(db);
  await printMetrics(metrics, db);
  await printHumanQueue(db);
  await printReprocess(ctx, db);

  await db.close();
}

async function printMetrics(m: InMemoryMetrics, db: Db) {
  console.log(`\n=== 관찰가능성 metrics (spec §8) ===`);

  // Cost / cache health
  const tin = m.getCounter('cost.tokens_in');
  const cached = m.getCounter('cost.cached_tokens');
  const promptHit = tin + cached > 0 ? Math.round((cached / (tin + cached)) * 1000) / 1000 : 0;
  console.log(`\n[cost/cache] tokens_in=${tin} out=${m.getCounter('cost.tokens_out')} cached=${cached}`);
  console.log(`  prompt_hit_rate=${promptHit}  semantic_hit_rate=${m.ratio('cache.semantic_hit', 'funnel.classified')}`);

  // Confidence health
  const cc = m.percentiles('confidence.classifier');
  const lc = m.percentiles('confidence.language');
  console.log(`\n[confidence] classifier mean=${cc.mean} p10=${cc.p10} p50=${cc.p50} p90=${cc.p90} (n=${cc.count})`);
  console.log(`  language mean=${lc.mean} p10=${lc.p10}  escalation_rate=${m.ratio('classify.escalated', 'classify.total')}  low_conf_ratio=${m.ratio('classify.low_confidence', 'classify.total')}  unknown_lang=${m.getCounter('confidence.unknown_language')}`);

  // Stage latency (느린 순)
  const stages = ['classifyExtractModerate', 'embed', 'translate', 'extractPII', 'normalize', 'detectLanguage'];
  console.log(`\n[stage latency ms] ` + stages.map((s) => { const p = m.percentiles(`stage.${s}.duration_ms`); return p.count ? `${s}:p50=${p.p50}/p90=${p.p90}` : ''; }).filter(Boolean).join('  '));

  // Defect / signal (차별화 축)
  const bugs = m.getCounter('defect.bugs');
  console.log(`\n[defect/signal] bugs=${bugs} code_map_rate=${m.ratio('defect.code_mapped', 'defect.bugs')} error_sig_rate=${m.ratio('defect.error_sig', 'defect.bugs')}`);
  const corr = m.percentiles('signal.corroboration');
  console.log(`  new_group_rate=${m.ratio('signal.new_group', 'signal.assigned')} mean_corroboration=${corr.mean} (assigned=${m.getCounter('signal.assigned')})`);

  // Vocabulary growth
  const regSize = await db.scalar(`SELECT count(*)::text AS n FROM feature_registry WHERE repo=$1 AND status='grounded'`, [config.targetRepo]);
  // match_rate = 기존 기능에 매핑된 비율 (grounded+defective) / 매핑 시도 (grounded+defective+gap)
  const grd = m.getCounter('feature.grounded') + m.getCounter('feature.defective');
  const mapped = grd + m.getCounter('feature.gap');
  const matchRate = mapped > 0 ? Math.round((grd / mapped) * 1000) / 1000 : 0;
  console.log(`\n[vocab] grounded_features=${regSize} gap_rate=${m.ratio('feature.gap', 'feature.mentions')} match_rate=${matchRate} (grounded+defective=${grd}/${mapped})`);

  // PII compliance
  console.log(`\n[pii] reviews_with_pii=${m.getCounter('pii.reviews_with_pii')} by_type=${JSON.stringify(m.getDist('pii.type'))}`);

  // Drift (PSI) — 이전 스냅샷 대비
  const dists = { language: m.getDist('dist.language'), category: m.getDist('dist.category'), sentiment: m.getDist('dist.sentiment'), spam: m.getDist('dist.spam') };
  const prev = await db.latestMetricSnapshot();
  console.log(`\n[drift PSI vs 직전 런]`);
  if (!prev) {
    console.log(`  (baseline 없음 — 이번 분포를 baseline으로 저장. 다음 런부터 PSI 표시)`);
  } else {
    for (const k of Object.keys(dists) as (keyof typeof dists)[]) {
      const val = psi(prev[k] ?? {}, dists[k]);
      console.log(`  ${k}: PSI=${val} (${psiLabel(val)})  cur=${JSON.stringify(dists[k])}`);
    }
  }
  await db.saveMetricSnapshot(`${config.llmClient}/${config.embeddingClient}`, dists);
}

async function printFeatureMapping(outcomes: ProcessOutcome[], db: Db) {
  console.log(`\n--- P1: review → feature 매핑 (Claude-as-judge, target=${config.targetRepo}) ---`);
  const states: Record<string, number> = { grounded: 0, defective: 0, enhancement: 0, gap: 0 };
  const grounded: string[] = [];
  for (const o of outcomes) {
    const fm = o.processed_review?.inferences.extraction.feature_mapping;
    if (!fm) continue;
    states[fm.state] = (states[fm.state] ?? 0) + 1;
    if (fm.state !== 'gap' && fm.feature_id) {
      const f = await db.query<{ pref_label: string }>(`SELECT pref_label FROM feature_registry WHERE id=$1`, [fm.feature_id]);
      grounded.push(`${o.source_id}→${f[0]?.pref_label}(${fm.state})`);
    }
  }
  console.log(`  states: grounded=${states.grounded} defective=${states.defective} enhancement=${states.enhancement} gap=${states.gap}`);
  console.log(`  매핑 예시: ${grounded.slice(0, 8).join(', ')}`);
  // floating gaps — Insight가 "어느 모듈에 추가할지" 제안할 대상
  const gaps = await db.query<{ pref_label: string }>(`SELECT pref_label FROM feature_registry WHERE status='gap' AND repo=$1 ORDER BY pref_label`, [config.targetRepo]);
  console.log(`  🟡 floating gaps (미구현 요청, ${gaps.length}): ${gaps.map((g) => `"${g.pref_label}"`).join(', ')}`);
}

async function printSignalGroups(db: Db) {
  console.log(`\n--- Phase 2: signal_groups (aggregateSignal) ---`);
  const rows = await db.query<{ id: string; error_signature: string; corroboration_count: number; affected_versions: string[]; affected_platforms: string[]; trend: string; path: string | null; risk_tier: string | null }>(
    `SELECT g.id, g.error_signature, g.corroboration_count, g.affected_versions, g.affected_platforms, g.trend,
            c.path, c.risk_tier
     FROM signal_groups g
     LEFT JOIN LATERAL (SELECT path, risk_tier FROM code_artifact_registry WHERE id = ANY(g.code_artifact_ids) ORDER BY risk_score DESC LIMIT 1) c ON true
     ORDER BY g.corroboration_count DESC, g.created_at`,
  );
  for (const g of rows) {
    const tag = g.corroboration_count > 1 ? '⭐' : '  ';
    console.log(`  ${tag} [${g.error_signature ?? '?'}] count=${g.corroboration_count} trend=${g.trend} v=${JSON.stringify(g.affected_versions)} plat=${JSON.stringify(g.affected_platforms)} → ${g.path ?? '(no code)'}${g.risk_tier ? ` [risk=${g.risk_tier}]` : ''}`);
  }
  const ev = await db.query<{ event_type: string; n: string }>(`SELECT event_type, count(*)::text AS n FROM signal_group_events GROUP BY event_type ORDER BY event_type`);
  console.log(`  events: ${ev.map((e) => `${e.event_type}=${e.n}`).join(' ') || '(none)'}`);

  const purity = await runReconciliation(db);
  console.log(`  reconciliation(stub) purity: groups=${purity.groups} multi=${purity.multi_member_groups} mean_corrob=${purity.mean_corroboration} giant_ratio=${purity.giant_component_ratio} radius_p90=${purity.intra_group_radius_p90}`);
}

function line(o: ProcessOutcome): string {
  const cat = o.processed_review?.inferences.classification;
  const tag =
    o.status === 'dropped_prefilter' ? `🗑  DROP (${o.reason})` :
    o.status === 'duplicate' ? `♻  DUP (${o.reason})` :
    o.status === 'cache_hit' ? `⚡ CACHE-HIT (cos=${o.cache_cosine?.toFixed(3)})` :
    `✔  ${cat?.category}/${cat?.severity} conf=${cat?.category_confidence}`;
  const fmap = o.processed_review?.inferences.extraction.feature_mapping;
  const extra = [
    fmap ? `feat=${fmap.state}` : '',
    o.near_duplicates?.length ? `near=${o.near_duplicates.length}` : '',
    o.low_confidence ? 'low-conf' : '',
    o.signal ? `signal=${o.signal.created_group ? 'NEW' : o.signal.matched_by}#${o.signal.corroboration}` : '',
    o.human_review_reasons?.length ? `human=[${o.human_review_reasons.join(',')}]` : '',
  ].filter(Boolean).join(' ');
  return `  ${o.source_id.padEnd(14)} ${tag}${extra ? '  ' + extra : ''}`;
}

function printFunnel(outcomes: ProcessOutcome[]) {
  const total = outcomes.length;
  const dropped = outcomes.filter((o) => o.status === 'dropped_prefilter').length;
  const dup = outcomes.filter((o) => o.status === 'duplicate').length;
  const cache = outcomes.filter((o) => o.status === 'cache_hit').length;
  const classified = outcomes.filter((o) => o.status === 'classified').length;
  const actionable = outcomes.filter((o) => o.processed_review?.inferences.is_actionable).length;
  const human = outcomes.filter((o) => o.human_review_reasons?.length).length;
  console.log(`\n--- Funnel (spec §8) ---`);
  console.log(`  유입 ${total}`);
  console.log(`   → prefilter pass ${total - dropped}  (drop ${dropped})`);
  console.log(`   → dedup pass     ${total - dropped - dup}  (dup ${dup})`);
  console.log(`   → cache miss     ${total - dropped - dup - cache}  (cache-hit ${cache})`);
  console.log(`   → classified     ${classified}`);
  console.log(`   → actionable_out ${actionable}  (bug/feature_request & !spam)`);
  console.log(`  사람 검토 큐: ${human}`);
}

async function printDetails(outcomes: ProcessOutcome[], db: Db) {
  console.log(`\n--- 샘플 ProcessedReview ---`);

  // 1) bug + defect + artifact_matches
  const bug = outcomes.find((o) => o.processed_review?.inferences.classification.category === 'bug' && o.processed_review.inferences.defect?.artifact_matches.length);
  if (bug?.processed_review) {
    const pr = bug.processed_review;
    console.log(`\n[bug+code grounding] ${pr.source_id}`);
    console.log(`  text_redacted : ${pr.facts.text_redacted}`);
    console.log(`  classification: ${JSON.stringify(pr.inferences.classification)}`);
    console.log(`  feature_ids   : ${pr.inferences.extraction.feature_ids.length} 매칭, mentions=${JSON.stringify(pr.inferences.extraction.raw_feature_mentions)}`);
    console.log(`  defect.area   : ${pr.inferences.defect?.affected_area}`);
    console.log(`  defect.errsig : ${JSON.stringify(pr.inferences.defect?.error_signature)}`);
    const arts = await resolveArtifacts(db, pr.inferences.defect?.artifact_matches.map((a) => a.artifact_id) ?? []);
    console.log(`  artifact_match: ${pr.inferences.defect?.artifact_matches.map((a) => { const x = arts.get(a.artifact_id); return `${x?.path} [risk=${x?.risk_tier}] (${a.source} ${a.score})`; }).join(', ')}`);
  }

  // 2) PII redaction
  const pii = outcomes.find((o) => o.processed_review?.inferences.moderation.pii_redacted);
  if (pii?.processed_review) {
    const pr = pii.processed_review;
    console.log(`\n[PII redaction] ${pr.source_id}`);
    console.log(`  원본    : ${pr.facts.text_original.slice(0, 80)}...`);
    console.log(`  redacted: ${pr.facts.text_redacted}`);
    console.log(`  pii_types: ${JSON.stringify(pr.inferences.moderation.pii_types)}`);
  }

  // 3) resolution report
  const res = outcomes.find((o) => o.processed_review?.inferences.classification.is_resolution_report);
  if (res?.processed_review) {
    console.log(`\n[resolution report #5] ${res.processed_review.source_id} → is_resolution_report=true`);
  }
}

async function resolveArtifacts(db: Db, ids: string[]): Promise<Map<string, { path: string; risk_tier: string }>> {
  const map = new Map<string, { path: string; risk_tier: string }>();
  if (!ids.length) return map;
  const rows = await db.query<{ id: string; path: string; risk_tier: string }>(`SELECT id, path, risk_tier FROM code_artifact_registry WHERE id = ANY($1::uuid[])`, [ids]);
  for (const r of rows) map.set(r.id, { path: r.path, risk_tier: r.risk_tier });
  return map;
}

async function printHumanQueue(db: Db) {
  const rows = await db.query<{ reason: string; n: string }>(`SELECT reason, count(*)::text AS n FROM human_review_queue GROUP BY reason ORDER BY reason`);
  console.log(`\n--- 사람 검토 큐 (human_review_queue) ---`);
  if (!rows.length) console.log('  (비어있음)');
  for (const r of rows) console.log(`  ${r.reason}: ${r.n}`);

  const unm = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM unmatched_feature_candidates`);
  console.log(`  unmatched_feature_candidates: ${unm[0]?.n ?? 0}`);
}

async function printReprocess(ctx: ReturnType<typeof makeContext>, db: Db) {
  // 동일 코퍼스 1건 재처리 → stage cache hit 증명 (version-aware input_hash)
  console.log(`\n--- 재처리(reprocess) 검증: stage 캐시 hit ---`);
  const sample = CORPUS[1]!; // ps-001 (bug, hang 그룹 멤버)
  const grpCount = async () => (await db.query<{ n: string }>(
    `SELECT corroboration_count::text AS n FROM signal_groups WHERE id =
       (SELECT signal_group_id FROM processed_reviews WHERE source_id=$1)`, [sample.source_id]))[0]?.n;
  const cntBefore = await grpCount();
  const o = await processReview(sample, ctx);
  const cntAfter = await grpCount();
  console.log(`  ${sample.source_id} 재처리: stage_cache_hits=${o.stage_cache_hits}, llm_calls=${o.llm_calls.length} (캐시 hit이면 LLM 0)`);
  console.log(`  signal_group corroboration: ${cntBefore} → ${cntAfter} (멱등 — 안 부풀어야 함)`);
}

main().catch((e) => {
  console.error('❌ run failed:', e);
  process.exit(1);
});
