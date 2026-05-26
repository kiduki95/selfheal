import { Db } from '../src/db/db.js';
import { makeEmbeddingClient } from '../src/clients/embedding/index.js';
import { makeLlmClient } from '../src/clients/llm/index.js';
import { scanRepo, persistScan } from '../src/codeflow/index.js';

// codeflow dogfood: selfheal 자체 src를 스캔해 코드 그래프를 적재 + "모듈→기능" 요약 출력.
// 네 비전 1단계 ("현재 코드베이스 기준 어느 모듈에 어떤 기능들이 있는지 스캔·정리")의 구현.
async function main() {
  const db = new Db();
  const embedder = makeEmbeddingClient();
  const repo = process.argv[2] ?? 'kiduki95/selfheal';
  const rootDir = process.argv[3] ?? process.cwd();

  // CODEFLOW_ENRICH=1 이면 LLM(claude-cli 등)으로 ② 사용자어 라벨 보강 (스캔당 1회)
  const enrich = process.env.CODEFLOW_ENRICH === '1';
  const llm = enrich ? makeLlmClient() : undefined;

  console.log(`\n=== CodeFlow scan: ${repo} (${rootDir})  enrich=${enrich ? 'on' : 'off'} ===`);
  const scan = scanRepo({ rootDir, repo });
  const stats = await persistScan(scan, db, embedder, llm);

  console.log(`\n적재 완료: nodes=${stats.nodes} (${JSON.stringify(stats.byKind)}) edges=${stats.edges} features=${stats.features}`);

  // 모듈 → 기능(심볼) 요약 — "전체 뷰"의 텍스트 버전
  console.log(`\n--- 모듈 → 기능(exported symbols) ---`);
  const rows = await db.query<{ module: string; files: string; symbols: string; risk: string }>(
    `SELECT module,
            count(*) FILTER (WHERE kind='file')::text AS files,
            count(*) FILTER (WHERE kind='symbol')::text AS symbols,
            max(risk_tier) FILTER (WHERE kind='module') AS risk
     FROM code_artifact_registry WHERE repo=$1 GROUP BY module ORDER BY module`,
    [repo],
  );
  for (const r of rows) {
    const syms = await db.query<{ symbol: string }>(
      `SELECT symbol FROM code_artifact_registry WHERE repo=$1 AND module=$2 AND kind='symbol' ORDER BY symbol LIMIT 8`,
      [repo, r.module],
    );
    const list = syms.map((s) => s.symbol).join(', ');
    console.log(`  ${r.module.padEnd(16)} files=${r.files} symbols=${r.symbols}  [${list}${syms.length === 8 ? ', …' : ''}]`);
  }

  // 엣지 분포 + import 그래프 샘플
  const ek = await db.query<{ kind: string; n: string }>(`SELECT kind, count(*)::text AS n FROM code_edges WHERE repo=$1 GROUP BY kind`, [repo]);
  console.log(`\n--- edges: ${ek.map((e) => `${e.kind}=${e.n}`).join(' ')} ---`);

  // code-derived features (grounded)
  const feats = await db.query<{ pref_label: string; status: string }>(
    `SELECT pref_label, status FROM feature_registry WHERE origin='code_derived' ORDER BY pref_label`,
  );
  console.log(`\n--- code-derived features (grounded): ${feats.length} ---`);
  console.log(`  ${feats.map((f) => f.pref_label).join(', ')}`);

  await db.close();
}

main().catch((e) => {
  console.error('❌ codeflow scan failed:', e);
  process.exit(1);
});
