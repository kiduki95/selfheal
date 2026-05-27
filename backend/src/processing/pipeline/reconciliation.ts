import type { Db } from '../../db/db.js';

// async reconciliation job (스펙 §4.8b (3), #2) — 인터페이스/이벤트만 v0.5에 고정, 로직은 후속.
// inline 배정은 보수적·provisional이므로, 주기적으로 그룹 purity를 점검해 merge/split/representative
// 재선정/regression 재계산을 해야 한다. 지금은 **purity 메트릭만 계산·관측**하고 구조 변경은 안 한다
// (cluster purity 데이터가 쌓인 뒤 알고리즘 결정 — 스펙 §9 open). 모든 구조 변경은 signal_group_events로.

export interface PurityReport {
  groups: number;
  open_groups: number;
  giant_component_ratio: number; // 최대 그룹 멤버수 / 전체 그룹화된 멤버수 — chaining collapse 조기경보
  mean_corroboration: number;
  multi_member_groups: number;
  intra_group_radius_p90: number; // max_radius 분포 (응집도 저하 감지)
}

// Order-independent grouping (#3): inline assignment depends on which groups already exist (transitive
// artifact bridging), so the same reviews in different orders can split differently. We reconcile by
// computing connected components over same-canonical groups (artifact overlap; empty set = wildcard)
// and merging each component into its oldest group. Pure so the bridging logic is unit-testable.
export interface ReconcileGroup { id: string; canonical: string | null; artifacts: string[]; firstSeen: string }
export function groupComponents(groups: ReconcileGroup[]): ReconcileGroup[][] {
  const byCanon = new Map<string, ReconcileGroup[]>();
  for (const g of groups) {
    if (!g.canonical) continue; // null canonical → never auto-merged
    (byCanon.get(g.canonical) ?? byCanon.set(g.canonical, []).get(g.canonical)!).push(g);
  }
  const out: ReconcileGroup[][] = [];
  for (const gs of byCanon.values()) {
    const parent = new Map(gs.map((g) => [g.id, g.id]));
    const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; while (parent.get(x) !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; } return r; };
    const union = (a: string, b: string) => parent.set(find(a), find(b));
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
      const A = gs[i]!, B = gs[j]!;
      const linked = A.artifacts.length === 0 || B.artifacts.length === 0 || A.artifacts.some((x) => B.artifacts.includes(x));
      if (linked) union(A.id, B.id);
    }
    const comps = new Map<string, ReconcileGroup[]>();
    for (const g of gs) { const r = find(g.id); (comps.get(r) ?? comps.set(r, []).get(r)!).push(g); }
    out.push(...comps.values());
  }
  return out;
}

async function reconcileMerges(db: Db): Promise<number> {
  const groups = (await db.openSignalGroups()).map((g) => ({ id: g.id, canonical: g.error_signature, artifacts: g.code_artifact_ids ?? [], firstSeen: g.first_seen }));
  let merged = 0;
  for (const comp of groupComponents(groups)) {
    if (comp.length < 2) continue;
    comp.sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : a.id < b.id ? -1 : 1));
    const keep = comp[0]!;
    const drop = comp.slice(1);
    const unionArtifacts = [...new Set(comp.flatMap((g) => g.artifacts))];
    await db.mergeSignalGroups(keep.id, drop.map((g) => g.id), unionArtifacts);
    merged += drop.length;
  }
  return merged;
}

export async function runReconciliation(db: Db): Promise<PurityReport> {
  await reconcileMerges(db); // #3: collapse order-induced duplicate groups (deterministic)
  const rows = await db.query<{ corroboration_count: number; max_radius: number | null; status: string }>(
    `SELECT corroboration_count, max_radius, status FROM signal_groups`,
  );
  const groups = rows.length;
  const open = rows.filter((r) => r.status === 'open').length;
  const counts = rows.map((r) => r.corroboration_count);
  const totalMembers = counts.reduce((a, b) => a + b, 0) || 1;
  const giant = counts.length ? Math.max(...counts) / totalMembers : 0;
  const mean = counts.length ? totalMembers / counts.length : 0;
  const multi = counts.filter((c) => c > 1).length;
  const radii = rows.map((r) => r.max_radius ?? 0).sort((a, b) => a - b);
  const p90 = radii.length ? radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.9))]! : 0;

  // TODO(후속): purity 임계 초과 시 SPLIT / 중복 그룹 MERGED / representative 재선정 / regression 재계산.
  //            모든 변경은 db.writeSignalEvent(...)로 audit. 현재는 관측만.

  return { groups, open_groups: open, giant_component_ratio: round3(giant), mean_corroboration: round3(mean), multi_member_groups: multi, intra_group_radius_p90: round3(p90) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
