import type { Db } from '../db/db.js';
import type { LlmClient } from '../clients/llm/types.js';
import { proposalImpact, type ImpactBand } from './impact.js';
import { suppressionDecision, estimateEffort } from './lifecycle.js';
import { deriveTrend, type Trend } from '../util/trend.js';

// Insight & Proposal Layer v1 — Processing 신호를 우선순위 매겨 issue 초안으로.
// 경계(spec §1.3): 여기까지가 "무엇을 왜 먼저"의 제안. 실제 PR/코드 수정은 Auto-Dev.
//   - bug_fix     : defective 신호그룹 → 통합 impact 스코어(proposalImpact)
//   - feature_gap : 미구현 요청 → Claude가 모듈 배치/연결 제안 (네 비전의 핵심)
//   - enhancement : 기존 기능 개선 요청

// Risk fusion (#1). code-risk.ts path heuristics (payment/auth=critical) stay silent on most repos,
// leaving risk_tier uniformly 'low' and the dimension dead. We make risk domain-general by fusing in
// CodeFlow blast-radius: heavily-depended-on code is risky to touch/leave broken regardless of path.
// (effectiveRisk feeds proposalImpact's `risk` factor; the old standalone bugPriority was removed
//  when the unified impact score replaced the per-kind formulas.)
const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const RANK_RISK = ['low', 'medium', 'high', 'critical'] as const;
type RiskTier = (typeof RANK_RISK)[number];

// Structural blast-radius → a risk tier.
export function blastTier(callers: number): RiskTier {
  return callers >= 8 ? 'critical' : callers >= 4 ? 'high' : callers >= 2 ? 'medium' : 'low';
}
// Effective risk = stronger of path heuristic and blast-radius. Path heuristic floors business-critical
// areas (low fan-in but high stakes); blast-radius lifts structurally-central code on any repo.
export function effectiveRisk(codeTier: string | null | undefined, callers: number): RiskTier {
  const rank = Math.max(RISK_RANK[codeTier ?? 'low'] ?? 0, RISK_RANK[blastTier(callers)]!);
  return RANK_RISK[rank]!;
}

// #2 freshness: proposals are regenerated per insight run; if reviews were processed after the last
// run, the proposals on screen are stale. Pure so it's testable; surfaced at the consumption point (API).
export function proposalsStale(lastProcessed: string | null, lastProposal: string | null): boolean {
  if (!lastProcessed) return false; // nothing processed → nothing to be stale about
  if (!lastProposal) return true; // processed reviews but no proposals yet
  return Date.parse(lastProcessed) > Date.parse(lastProposal);
}

export interface ProposalView {
  kind: 'bug_fix' | 'feature_gap' | 'enhancement';
  title: string;
  priority: number; // = unified impact score 0–100 (comparable across kinds)
  target_module: string | null;
  placement: string | null;
  body: string;
  band?: ImpactBand;
  effort?: string;
}

// gap 제안을 코드 그래프(실제 모듈 집합)에 대조 검증 — 환각(없는 모듈 참조) 적발.
export interface GapVerdict {
  verdict: 'grounded' | 'partial' | 'ungrounded';
  referenced: string[]; // 제안이 참조한 실제 모듈
  invented: string[]; // 코드에 없는데 참조한 모듈 (환각 의심)
  moduleExists: boolean;
  note: string;
}
export function verifyGapProposal(plan: { placement: string; module: string; connection: string; body: string; connections?: string[] }, realModules: Set<string>): GapVerdict {
  const norm = (t: string) => t.replace(/[`/]+$/, '').trim(); // trim trailing slash/backtick (both paths)
  let referenced: string[];
  let invented: string[];
  if (plan.connections && plan.connections.length) {
    // ⑦ exact: trust the structured module references against the real code graph (no brittle regex).
    const conns = plan.connections.map(norm);
    referenced = [...new Set(conns.filter((m) => realModules.has(m)))];
    invented = [...new Set(conns.filter((m) => !realModules.has(m) && m !== plan.module))];
  } else {
    // fallback (LLM gave no structured connections): regex-extract module tokens from free text.
    const text = `${plan.module}\n${plan.connection}\n${plan.body}`;
    const tokens = new Set<string>();
    for (const m of text.matchAll(/\b(app\/[a-z0-9-]+|components\/[a-z0-9-]+|app|components|lib|hooks)\b/g)) { if (m[1]) tokens.add(norm(m[1])); }
    for (const m of text.matchAll(/`([a-zA-Z0-9/_-]{2,40})`/g)) { const t = m[1] ? norm(m[1]) : ''; if (t && (/\//.test(t) || realModules.has(t))) tokens.add(t); }
    referenced = [...tokens].filter((t) => realModules.has(t));
    invented = [...tokens].filter((t) => !realModules.has(t) && t !== plan.module && /\//.test(t) && /^(app|components|lib|hooks)\//.test(t));
  }
  const moduleExists = plan.placement === 'new_module' || realModules.has(plan.module);
  const verdict: GapVerdict['verdict'] = !moduleExists ? 'ungrounded' : invented.length ? 'partial' : 'grounded';
  const note = !moduleExists ? `배치 모듈 "${plan.module}"이 코드에 없음(기존이라 주장)` : invented.length ? `코드에 없는 모듈 참조: ${invented.join(', ')}` : '모든 참조가 실제 코드와 일치';
  return { verdict, referenced, invented, moduleExists, note };
}

export async function runInsight(db: Db, llm: LlmClient, repo: string): Promise<ProposalView[]> {
  await db.clearProposals(repo);
  await db.recomputeTrends(new Date()); // #4: refresh new/rising/stable/declining from report recency
  const out: ProposalView[] = [];
  // 모듈→기능 맵 + 실제 import 의존성(code_edges) 주입 → grounding 근거
  const impMap = new Map((await db.moduleImports(repo)).map((i) => [i.module, i.imports]));
  const moduleMap = (await db.moduleMap(repo)).map((m) => ({ ...m, imports: impMap.get(m.module) ?? [] }));
  const realModules = new Set(await db.moduleNames(repo));
  const blastRadius = await db.moduleBlastRadius(repo); // CodeFlow impact → bug priority weight

  // 1) 버그픽스 제안 (defective 신호그룹)
  let suppressed = 0;
  const bugFeatureIds = new Set<string>(); // ⑤ features that also have an open bug → cross-ref on enhancement
  for (const g of await db.bugGroups(repo)) {
    const corroboration = Number(g.corroboration_count);
    const sev = Math.max(1, Math.min(4, Number(g.sev ?? 1))) as 1 | 2 | 3 | 4;
    const callers = blastRadius[g.code_module] ?? 0; // CodeFlow blast-radius of the buggy module
    const risk = effectiveRisk(g.risk_tier, callers); // #1: path heuristic fused with blast-radius

    // ④ suppress proposals for incidents that look resolved (and haven't regressed)
    const rstat = await db.groupResolutionStats(g.id);
    const sup = suppressionDecision({ resolutionReports: rstat.resolutionReports, reportsSinceResolution: rstat.reportsSinceResolution, trend: g.trend, corroboration });
    if (sup.suppress) { suppressed++; continue; }

    const impact = proposalImpact({ kind: 'bug_fix', corroboration, severity: sev, risk, trend: g.trend as Trend }); // #1/#2: unified 0–100
    const effort = estimateEffort({ kind: 'bug_fix', touchedModules: 1, isNewModule: false, blastRadius: callers }); // ⑥
    const samples = (g.samples ?? []).filter(Boolean) as string[];
    const title = `[bug] ${g.feature ?? '?'} — ${g.error_signature ?? '오류'} (증거 ${g.corroboration_count}건)`;
    const body = `## 버그 신호\n- 기능: **${g.feature ?? '?'}** · 코드: \`${g.module_path ?? '미매핑'}\` [risk=${risk} (코드 ${g.risk_tier ?? '?'}, blast-radius ${callers}), severity ${sev}]\n- 에러 패밀리: \`${g.error_signature ?? '?'}\`\n- 증거: ${g.corroboration_count}건 · 플랫폼 ${(g.affected_platforms ?? []).join(', ')} · 버전 ${(g.affected_versions ?? []).join(', ')} · 추세 ${g.trend}\n- **impact ${impact.score} (${impact.band})** · 추정 공수 ${effort.size} (${effort.weeks})\n\n## 샘플 리뷰\n${samples.map((s) => `- "${s.slice(0, 80)}"`).join('\n')}\n\n→ Auto-Dev가 \`${g.module_path ?? '?'}\` 수정 PR 후보.`;
    if (g.feature_id) bugFeatureIds.add(String(g.feature_id).toLowerCase()); // ⑤ (normalize for safe compare)
    await db.insertProposal({ repo, kind: 'bug_fix', ref_id: g.id, title, body, priority: impact.score, target_module: g.module_path ?? null, placement: null, evidence: { corroboration, sev, risk_effective: risk, code_risk: g.risk_tier, blast_radius: callers, trend: g.trend, impact: impact.score, band: impact.band, effort: effort.size, effort_weeks: effort.weeks } });
    out.push({ kind: 'bug_fix', title, priority: impact.score, target_module: g.module_path ?? null, placement: null, body, band: impact.band, effort: effort.size });
  }
  if (suppressed) console.log(`  ④ suppressed ${suppressed} resolved bug proposal(s)`);

  // 2) gap 클러스터링 — 같은 의도(다른 표현) 요청을 묶어 중복 issue 방지
  const rawGaps = await db.gapFeaturesRaw(repo);
  if (rawGaps.length > 1) {
    const { clusters } = await llm.clusterGaps({ gaps: rawGaps });
    for (const c of clusters) {
      if (c.member_ids.length <= 1) continue;
      const [canon, ...rest] = c.member_ids;
      await db.mergeGapFeatures(canon!, rest, c.canonical_label);
    }
  }

  // 3) gap 제안 (미구현 요청, 클러스터 단위) — Claude가 모듈 배치/연결 제안 + 코드그래프 검증
  for (const gap of await db.gapFeatures2(repo)) {
    const demand = Number(gap.demand);
    const desc = (gap.samples ?? []).filter(Boolean).slice(0, 2).join(' / ');
    const plan = await llm.proposeGapPlacement({ gap: gap.pref_label, gapDescription: desc, modules: moduleMap });
    const v = verifyGapProposal(plan, realModules); // 코드 그래프 대조 검증
    const trend = deriveTrend(await db.featureReportTimes(gap.id), Date.now()); // #2: demand momentum
    const isNew = plan.placement === 'new_module';
    const impact = proposalImpact({ kind: 'feature_gap', demand, verdict: v.verdict, trend }); // #1/#2 unified; verdict = confidence
    const effort = estimateEffort({ kind: 'feature_gap', touchedModules: v.referenced.length + 1, isNewModule: isNew, blastRadius: isNew ? 0 : (blastRadius[plan.module] ?? 0) }); // ⑥
    const verifyMd = `\n\n## 🔎 검증 (코드 그래프 대조)\n- 배치: \`${plan.module}\` ${isNew ? '(신규 — 코드에 없음, 생성 필요)' : v.moduleExists ? '✅ 실제 모듈' : '⚠️ 코드에 없는데 기존이라 주장'}\n- 참조한 실제 모듈: ${v.referenced.join(', ') || '없음'}${v.invented.length ? `\n- ⚠️ 코드에 없는 참조(환각 의심): ${v.invented.join(', ')}` : ''}\n- **verdict: ${v.verdict}**`;
    const body = `${plan.body}${verifyMd}\n\n---\n_연결_: ${plan.connection} · _수요_: ${demand}건 · _추세_: ${trend} · **impact ${impact.score} (${impact.band})** · 추정 공수 ${effort.size} (${effort.weeks})`;
    await db.insertProposal({ repo, kind: 'feature_gap', ref_id: gap.id, title: plan.title, body, priority: impact.score, target_module: plan.module, placement: plan.placement, evidence: { demand, verdict: v.verdict, invented: v.invented, referenced: v.referenced, trend, impact: impact.score, band: impact.band, effort: effort.size, effort_weeks: effort.weeks } });
    out.push({ kind: 'feature_gap', title: plan.title, priority: impact.score, target_module: plan.module, placement: plan.placement, body, band: impact.band, effort: effort.size });
  }

  // 3) enhancement 제안 (기존 기능 개선)
  for (const e of await db.enhancementItems(repo)) {
    const demand = Number(e.demand);
    const trend = deriveTrend(await db.featureReportTimes(e.id), Date.now()); // #2: demand momentum
    const impact = proposalImpact({ kind: 'enhancement', demand, trend }); // #1/#2 unified
    const effort = estimateEffort({ kind: 'enhancement', touchedModules: 1, isNewModule: false, blastRadius: 0 }); // ⑥
    const samples = (e.samples ?? []).filter(Boolean) as string[];
    const alsoBug = bugFeatureIds.has(String(e.id).toLowerCase()); // ⑤ same feature has an open bug too
    const title = `[enhancement] ${e.pref_label} 개선 (요청 ${demand}건)`;
    const crossRef = alsoBug ? `\n- ⚠️ 이 기능엔 **열린 버그 제안**도 있음 — 함께 검토(중복 작업 방지)` : '';
    const body = `## 개선 요청\n- 기능: **${e.pref_label}** (기존)\n- 수요: ${demand}건 · 추세 ${trend} · **impact ${impact.score} (${impact.band})** · 추정 공수 ${effort.size} (${effort.weeks})${crossRef}\n\n## 샘플\n${samples.map((s) => `- "${s.slice(0, 80)}"`).join('\n')}`;
    await db.insertProposal({ repo, kind: 'enhancement', ref_id: e.id, title, body, priority: impact.score, target_module: e.pref_label, placement: 'existing_module', evidence: { demand, trend, impact: impact.score, band: impact.band, effort: effort.size, effort_weeks: effort.weeks, related_bug: alsoBug } });
    out.push({ kind: 'enhancement', title, priority: impact.score, target_module: e.pref_label, placement: 'existing_module', body, band: impact.band, effort: effort.size });
  }

  out.sort((a, b) => b.priority - a.priority);
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
