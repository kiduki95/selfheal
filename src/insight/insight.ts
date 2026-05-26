import type { Db } from '../db/db.js';
import type { LlmClient } from '../clients/llm/types.js';

// Insight & Proposal Layer v1 — Processing 신호를 우선순위 매겨 issue 초안으로.
// 경계(spec §1.3): 여기까지가 "무엇을 왜 먼저"의 제안. 실제 PR/코드 수정은 Auto-Dev.
//   - bug_fix     : defective 신호그룹 → corroboration × severity × risk × trend로 우선순위
//   - feature_gap : 미구현 요청 → Claude가 모듈 배치/연결 제안 (네 비전의 핵심)
//   - enhancement : 기존 기능 개선 요청 → demand 순

const SEV_W: Record<number, number> = { 4: 3, 3: 2, 2: 1.3, 1: 1 };
const RISK_W: Record<string, number> = { critical: 3, high: 2, medium: 1.5, low: 1 };
const TREND_W: Record<string, number> = { rising: 1.5, new: 1, stable: 1, declining: 0.5 };
// Blast-radius weight (CodeFlow impact): a bug in highly-depended-on code affects more of the system.
// Gentle multiplier so corroboration/severity still dominate. callers = distinct external dependents.
const impactW = (callers: number): number => (callers >= 6 ? 1.4 : callers >= 3 ? 1.25 : callers >= 1 ? 1.1 : 1);

export interface ProposalView {
  kind: 'bug_fix' | 'feature_gap' | 'enhancement';
  title: string;
  priority: number;
  target_module: string | null;
  placement: string | null;
  body: string;
}

// gap 제안을 코드 그래프(실제 모듈 집합)에 대조 검증 — 환각(없는 모듈 참조) 적발.
export interface GapVerdict {
  verdict: 'grounded' | 'partial' | 'ungrounded';
  referenced: string[]; // 제안이 참조한 실제 모듈
  invented: string[]; // 코드에 없는데 참조한 모듈 (환각 의심)
  moduleExists: boolean;
  note: string;
}
export function verifyGapProposal(plan: { placement: string; module: string; connection: string; body: string }, realModules: Set<string>): GapVerdict {
  const text = `${plan.module}\n${plan.connection}\n${plan.body}`;
  const norm = (t: string) => t.replace(/[`/]+$/, '').trim(); // 후행 슬래시/백틱 정리
  const tokens = new Set<string>();
  for (const m of text.matchAll(/\b(app\/[a-z0-9-]+|components\/[a-z0-9-]+|app|components|lib|hooks)\b/g)) { if (m[1]) tokens.add(norm(m[1])); }
  for (const m of text.matchAll(/`([a-zA-Z0-9/_-]{2,40})`/g)) { const t = m[1] ? norm(m[1]) : ''; if (t && (/\//.test(t) || realModules.has(t))) tokens.add(t); }
  const referenced = [...tokens].filter((t) => realModules.has(t));
  // 환각 = 코드에 없는데 참조한 '모듈 경로'(2+세그먼트). 제안한 신규 모듈명은 제외.
  const invented = [...tokens].filter((t) => !realModules.has(t) && t !== plan.module && /\//.test(t) && /^(app|components|lib|hooks)\//.test(t));
  const moduleExists = plan.placement === 'new_module' || realModules.has(plan.module);
  const verdict: GapVerdict['verdict'] = !moduleExists ? 'ungrounded' : invented.length ? 'partial' : 'grounded';
  const note = !moduleExists ? `배치 모듈 "${plan.module}"이 코드에 없음(기존이라 주장)` : invented.length ? `코드에 없는 모듈 참조: ${invented.join(', ')}` : '모든 참조가 실제 코드와 일치';
  return { verdict, referenced, invented, moduleExists, note };
}

export async function runInsight(db: Db, llm: LlmClient, repo: string): Promise<ProposalView[]> {
  await db.clearProposals(repo);
  const out: ProposalView[] = [];
  // 모듈→기능 맵 + 실제 import 의존성(code_edges) 주입 → grounding 근거
  const impMap = new Map((await db.moduleImports(repo)).map((i) => [i.module, i.imports]));
  const moduleMap = (await db.moduleMap(repo)).map((m) => ({ ...m, imports: impMap.get(m.module) ?? [] }));
  const realModules = new Set(await db.moduleNames(repo));
  const blastRadius = await db.moduleBlastRadius(repo); // CodeFlow impact → bug priority weight

  // 1) 버그픽스 제안 (defective 신호그룹)
  for (const g of await db.bugGroups(repo)) {
    const sev = Number(g.sev ?? 1);
    const callers = blastRadius[g.code_module] ?? 0; // CodeFlow blast-radius of the buggy module
    const priority = round2(Number(g.corroboration_count) * (SEV_W[sev] ?? 1) * (RISK_W[g.risk_tier] ?? 1) * (TREND_W[g.trend] ?? 1) * impactW(callers));
    const samples = (g.samples ?? []).filter(Boolean) as string[];
    const title = `[bug] ${g.feature ?? '?'} — ${g.error_signature ?? '오류'} (증거 ${g.corroboration_count}건)`;
    const body = `## 버그 신호\n- 기능: **${g.feature ?? '?'}** · 코드: \`${g.module_path ?? '미매핑'}\` [risk=${g.risk_tier ?? '?'}, blast-radius=${callers} dependents]\n- 에러 패밀리: \`${g.error_signature ?? '?'}\`\n- 증거: ${g.corroboration_count}건 · 플랫폼 ${(g.affected_platforms ?? []).join(', ')} · 버전 ${(g.affected_versions ?? []).join(', ')} · 추세 ${g.trend}\n\n## 샘플 리뷰\n${samples.map((s) => `- "${s.slice(0, 80)}"`).join('\n')}\n\n→ Auto-Dev가 \`${g.module_path ?? '?'}\` 수정 PR 후보.`;
    await db.insertProposal({ repo, kind: 'bug_fix', ref_id: g.id, title, body, priority, target_module: g.module_path ?? null, placement: null, evidence: { corroboration: g.corroboration_count, sev, risk: g.risk_tier, trend: g.trend, blast_radius: callers } });
    out.push({ kind: 'bug_fix', title, priority, target_module: g.module_path ?? null, placement: null, body });
  }

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
    const verifyMd = `\n\n## 🔎 검증 (코드 그래프 대조)\n- 배치: \`${plan.module}\` ${plan.placement === 'new_module' ? '(신규 — 코드에 없음, 생성 필요)' : v.moduleExists ? '✅ 실제 모듈' : '⚠️ 코드에 없는데 기존이라 주장'}\n- 참조한 실제 모듈: ${v.referenced.join(', ') || '없음'}${v.invented.length ? `\n- ⚠️ 코드에 없는 참조(환각 의심): ${v.invented.join(', ')}` : ''}\n- **verdict: ${v.verdict}**`;
    const body = `${plan.body}${verifyMd}\n\n---\n_연결_: ${plan.connection} · _수요_: ${demand}건`;
    // ungrounded 제안은 신뢰 낮음 → 우선순위 페널티
    const priority = round2(demand * 2 * (v.verdict === 'ungrounded' ? 0.4 : v.verdict === 'partial' ? 0.8 : 1));
    await db.insertProposal({ repo, kind: 'feature_gap', ref_id: gap.id, title: plan.title, body, priority, target_module: plan.module, placement: plan.placement, evidence: { demand, verdict: v.verdict, invented: v.invented, referenced: v.referenced } });
    out.push({ kind: 'feature_gap', title: plan.title, priority, target_module: plan.module, placement: plan.placement, body });
  }

  // 3) enhancement 제안 (기존 기능 개선)
  for (const e of await db.enhancementItems(repo)) {
    const demand = Number(e.demand);
    const samples = (e.samples ?? []).filter(Boolean) as string[];
    const title = `[enhancement] ${e.pref_label} 개선 (요청 ${demand}건)`;
    const body = `## 개선 요청\n- 기능: **${e.pref_label}** (기존)\n- 수요: ${demand}건\n\n## 샘플\n${samples.map((s) => `- "${s.slice(0, 80)}"`).join('\n')}`;
    const priority = round2(demand * 1.2);
    await db.insertProposal({ repo, kind: 'enhancement', ref_id: e.id, title, body, priority, target_module: e.pref_label, placement: 'existing_module', evidence: { demand } });
    out.push({ kind: 'enhancement', title, priority, target_module: e.pref_label, placement: 'existing_module', body });
  }

  out.sort((a, b) => b.priority - a.priority);
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
