import { Db } from '../src/db/db.js';
import { config } from '../src/config.js';

// ⑧ Calibration measurement (NOT auto-tuning). Insight's impact weights (severity/risk/value/momentum)
// are hand-set. To calibrate them you need ground truth = human decisions. This reports approval rate
// per impact band: if `critical`/`high` proposals aren't approved more than `low`, the weights are off.
// Auto-tuning is deferred until enough decisions accumulate — for now this surfaces the signal.
async function main() {
  const db = new Db();
  const rows = await db.decisionsByBand(config.targetRepo);
  const decided = rows.reduce((s, r) => s + r.approved + r.rejected, 0);
  console.log(`\n=== impact-band calibration (${config.targetRepo}) ===`);
  console.log('  band      total  approved  rejected  approval%');
  for (const r of rows) {
    const d = r.approved + r.rejected;
    const pct = d ? Math.round((r.approved / d) * 100) + '%' : '—';
    console.log(`  ${r.band.padEnd(9)} ${String(r.total).padStart(5)} ${String(r.approved).padStart(9)} ${String(r.rejected).padStart(9)} ${pct.padStart(9)}`);
  }
  console.log(`\n  decided ${decided} proposal(s).` + (decided < 20
    ? ' Too few decisions to calibrate — weights stay fixed (need ~20+ across bands).'
    : ' Expectation: approval% should rise with band (critical > high > medium > low). If not, adjust src/insight/impact.ts weights.'));
  await db.close();
}

main().catch((e) => { console.error('❌ calibrate failed:', e); process.exit(1); });
