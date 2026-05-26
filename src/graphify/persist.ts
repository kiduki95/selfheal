import type { Db } from '../db/db.js';
import type { EmbeddingClient } from '../clients/embedding/types.js';
import type { LlmClient } from '../clients/llm/types.js';
import type { ScanResult } from './scan.js';
import { classifyCodeRisk } from '../util/code-risk.js';
import { toSqlVector } from '../util/vector.js';

// graphify persist (graphify-layer.md §4 persist) — ScanResult를 공유 테이블에 적재.
// P0: 전체 재수집(repo 단위 delete→insert). 증분(content_hash diff)은 후속.
// 임베딩은 review와 동일 embedder(DI 주입) — affected_area↔artifact 같은 공간(하드 제약 §3.1).

export interface PersistStats {
  nodes: number;
  edges: number;
  features: number;
  byKind: Record<string, number>;
}

// llm 주입 시 component feature에 ② 사용자어 라벨/설명 보강 (스캔당 1회). stub이면 no-op.
export async function persistScan(scan: ScanResult, db: Db, embedder: EmbeddingClient, llm?: LlmClient): Promise<PersistStats> {
  const runId = (await db.query<{ id: string }>(
    `INSERT INTO graphify_runs (repo, ref, status, enrich_mode) VALUES ($1,$2,'running',$3) RETURNING id`,
    [scan.repo, scan.ref, embedder.kind === 'local' ? 'stub' : 'anthropic'],
  ))[0]!.id;

  try {
    // 전체 재수집: repo 범위 초기화 (FK: code_edges → code_artifact_registry)
    await db.query(`DELETE FROM code_edges WHERE repo = $1`, [scan.repo]);
    await db.query(`DELETE FROM code_artifact_registry WHERE repo = $1`, [scan.repo]);
    // 이 repo의 code-derived feature도 초기화 (review-emergent gap은 보존)
    await db.query(`DELETE FROM feature_registry WHERE origin = 'code_derived' AND repo = $1`, [scan.repo]);

    // 1) 노드 insert → key→id 매핑
    const idByKey = new Map<string, string>();
    const byKind: Record<string, number> = {};
    for (const n of scan.nodes) {
      const { vector } = await embedder.embed(n.description);
      const risk = classifyCodeRisk(n.path, n.module, n.symbol, n.signature);
      const rows = await db.query<{ id: string }>(
        `INSERT INTO code_artifact_registry
           (repo, path, module, symbol, kind, signature, content_hash, description, embedding, risk_tier, risk_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10,$11)
         RETURNING id`,
        [scan.repo, n.path, n.module, n.symbol, n.kind, n.signature, n.contentHash, n.description, toSqlVector(vector), risk.tier, risk.score],
      );
      idByKey.set(n.key, rows[0]!.id);
      byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    }

    // 2) 엣지 insert
    let edgeCount = 0;
    for (const e of scan.edges) {
      const src = idByKey.get(e.srcKey);
      const dst = idByKey.get(e.dstKey);
      if (!src || !dst) continue;
      await db.query(
        `INSERT INTO code_edges (repo, src_id, dst_id, kind) VALUES ($1,$2,$3,$4)
         ON CONFLICT (src_id, dst_id, kind) DO NOTHING`,
        [scan.repo, src, dst, e.kind],
      );
      edgeCount++;
    }

    // 3) feature(코드 파생) upsert (+② enrich) + 멤버에 feature_id 누적 + parent_id 트리
    const idBySlug = new Map<string, string>();
    let enriched = 0;
    let subCount = 0;
    for (const f of scan.features) {
      let label = f.pref_label;
      let desc = f.description;
      // ② component feature만 LLM으로 사용자어 라벨/설명 보강 (스캔당 1회, 핫패스 아님)
      if (llm && f.level === 'component') {
        try {
          const e = await llm.describeFeature({ symbol: f.pref_label, module: f.parentSlug?.replace('code.', '') ?? '', signature: f.description });
          if (e.label) { label = e.label; desc = e.description || desc; enriched++; }
        } catch { /* enrich 실패 → 원본 유지 */ }
      }
      const { vector } = await embedder.embed(`${label} ${desc}`);
      const frows = await db.query<{ id: string }>(
        `INSERT INTO feature_registry (canonical_slug, pref_label, description, embedding, origin, status, repo)
         VALUES ($1,$2,$3,$4::vector,'code_derived','grounded',$5)
         ON CONFLICT (canonical_slug) DO UPDATE
           SET pref_label = EXCLUDED.pref_label, description = EXCLUDED.description,
               embedding = EXCLUDED.embedding, origin = 'code_derived', status = 'grounded', repo = EXCLUDED.repo
         RETURNING id`,
        [`${scan.repo}#${f.slug}`, label, desc, toSqlVector(vector), scan.repo],
      );
      const fid = frows[0]!.id;
      idBySlug.set(f.slug, fid);
      const memberIds = f.memberKeys.map((k) => idByKey.get(k)).filter((x): x is string => !!x);
      if (memberIds.length) {
        // 누적(append+distinct) — 한 아티팩트가 모듈 feature + 컴포넌트 feature 둘 다에 속할 수 있음
        await db.query(
          `UPDATE code_artifact_registry
           SET feature_ids = ARRAY(SELECT DISTINCT unnest(feature_ids || ARRAY[$1]::uuid[]))
           WHERE id = ANY($2::uuid[])`,
          [fid, memberIds],
        );
      }

      // ① sub-feature 분해 — UI 요소가 풍부한 컴포넌트만 (스캔당 1회 LLM). parent=이 컴포넌트, 앵커=같은 파일.
      if (llm && f.level === 'component' && f.uiSurface && f.uiSurface.split(' | ').length >= 4) {
        const sub = await llm.enumerateSubFeatures({ component: label, module: f.parentSlug?.replace('code.', '') ?? '', uiSurface: f.uiSurface });
        const fileId = f.fileKey ? idByKey.get(f.fileKey) : undefined;
        for (const s of sub.subFeatures) {
          const sslug = `${scan.repo}#${f.slug}.${s.label.toLowerCase().replace(/\s+/g, '-')}`.slice(0, 200);
          const desc = s.description + (s.anchors.length ? ` [anchors: ${s.anchors.join(', ')}]` : '');
          const { vector: sv } = await embedder.embed(`${s.label} ${s.description} ${s.anchors.join(' ')}`);
          const srows = await db.query<{ id: string }>(
            `INSERT INTO feature_registry (canonical_slug, pref_label, description, embedding, origin, status, repo, parent_id)
             VALUES ($1,$2,$3,$4::vector,'code_derived','grounded',$5,$6)
             ON CONFLICT (canonical_slug) DO UPDATE SET pref_label=EXCLUDED.pref_label, description=EXCLUDED.description, embedding=EXCLUDED.embedding, parent_id=EXCLUDED.parent_id
             RETURNING id`,
            [sslug, s.label, desc, toSqlVector(sv), scan.repo, fid],
          );
          if (fileId) await db.query(`UPDATE code_artifact_registry SET feature_ids = ARRAY(SELECT DISTINCT unnest(feature_ids || ARRAY[$1]::uuid[])) WHERE id = $2`, [srows[0]!.id, fileId]);
          subCount++;
        }
      }
    }
    // parent_id (SKOS broader): 컴포넌트 feature → 모듈 feature
    for (const f of scan.features) {
      if (!f.parentSlug) continue;
      const childId = idBySlug.get(f.slug);
      const parentId = idBySlug.get(f.parentSlug);
      if (childId && parentId) await db.query(`UPDATE feature_registry SET parent_id = $2 WHERE id = $1`, [childId, parentId]);
    }
    if (enriched) console.log(`  ② enriched ${enriched} component features (user-facing labels)`);
    if (subCount) console.log(`  ① decomposed into ${subCount} sub-features`);

    await db.query(
      `UPDATE graphify_runs SET status='done', nodes_total=$2, edges_total=$3, features_total=$4, finished_at=now() WHERE id=$1`,
      [runId, scan.nodes.length, edgeCount, scan.features.length],
    );
    return { nodes: scan.nodes.length, edges: edgeCount, features: scan.features.length, byKind };
  } catch (e) {
    await db.query(`UPDATE graphify_runs SET status='failed', finished_at=now() WHERE id=$1`, [runId]);
    throw e;
  }
}
