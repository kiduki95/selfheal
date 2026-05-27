import { Db } from '../src/db/db.js';
import { makeLlmClient } from '../src/clients/llm/index.js';
import { runInsight } from '../src/insight/insight.js';
import { config } from '../src/config.js';

// Insight & Proposal Layer 실행 — 마지막 run-corpus 신호로 우선순위 매긴 issue 초안 생성.
// `npm run insight` (gap 제안은 LLM 사용 — LLM_CLIENT=claude-cli 권장)
async function main() {
  const db = new Db();
  const llm = makeLlmClient();
  console.log(`\n=== Insight & Proposal Layer (target=${config.targetRepo}, llm=${config.llmClient}) ===`);
  const proposals = await runInsight(db, llm, config.targetRepo);

  const byKind: Record<string, number> = {};
  for (const p of proposals) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  console.log(`생성된 제안 ${proposals.length}건 ${JSON.stringify(byKind)}\n`);
  console.log(`--- 우선순위 정렬 ---`);
  for (const p of proposals) {
    const tag = p.kind === 'bug_fix' ? '🔴 BUG' : p.kind === 'feature_gap' ? '🟡 GAP' : p.kind === 'refactor' ? '🟣 REFACTOR' : '🔵 ENH';
    const place = p.kind === 'feature_gap' ? `  →배치: ${p.placement === 'new_module' ? '신규' : '기존'} ${p.target_module}` : p.target_module ? `  →${p.target_module}` : '';
    console.log(`  [P${p.priority}] ${tag}  ${p.title}${place}`);
  }

  // gap 제안 본문 1개 미리보기 (이슈 초안 모양 확인)
  const gap = proposals.find((p) => p.kind === 'feature_gap');
  if (gap) {
    console.log(`\n--- 예시 issue 초안 (gap) ---\n# ${gap.title}\n${gap.body}\n`);
  }
  await db.close();
}

main().catch((e) => {
  console.error('❌ insight failed:', e);
  process.exit(1);
});
