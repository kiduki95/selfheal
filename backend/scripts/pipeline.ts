import { Db } from '../src/db/db.js';
import { makeContext, processReview, runReconciliation } from '../src/processing/index.js';
import { runInsight } from '../src/insight/index.js';
import { makeLlmClient } from '../src/clients/llm/index.js';
import { CORPUS } from '../corpus/reviews.js';
import { config } from '../src/config.js';

// End-to-end run in one command (#2): process → reconcile → insight. Keeps proposals consistent with
// signal groups (no drift from running the steps separately). `npm run pipeline`.
// Orchestration is deliberately a plain sequential script for now; pg-boss (queues/schedule) is C1.
async function main() {
  const db = new Db();
  const ctx = makeContext(db);
  let classified = 0, duplicate = 0, dropped = 0;
  for (const raw of CORPUS) {
    const o = await processReview(raw, ctx);
    if (o.status === 'classified' || o.status === 'cache_hit') classified++;
    else if (o.status === 'duplicate') duplicate++;
    else dropped++;
  }
  const purity = await runReconciliation(db); // merges order-induced duplicate groups (#3)
  const proposals = await runInsight(db, makeLlmClient(), config.targetRepo);
  console.log(`\n✅ pipeline: processed=${classified} dup=${duplicate} dropped=${dropped}`);
  console.log(`   groups=${purity.open_groups} (merged-aware) · proposals=${proposals.length}`);
  console.log(`   top: ${proposals.slice(0, 3).map((p) => `[${p.kind}] P${p.priority} ${p.title.slice(0, 40)}`).join(' · ')}`);
  await db.close();
}

main().catch((e) => { console.error('❌ pipeline failed:', e); process.exit(1); });
