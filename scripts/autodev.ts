import { Db } from '../src/db/db.js';
import { runAutoDev } from '../src/autodev/index.js';
import { config } from '../src/config.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Auto-Dev Layer (layer 5) CLI — `npm run autodev`. Consumes approved proposals for the target repo,
// drives the (default stub) coding agent in an isolated worktree, runs the deterministic verify gate,
// and emits a dry-run patch + PR-body artifact. NO GitHub push (spec §1, dry-run only).
//
// Usage: npm run autodev -- <mirrorDir> [concurrency]
//   mirrorDir   product repo local checkout (git repo; reused as the mirror source — spec §4). Default cwd.
//   concurrency parallel run slots. Default 1 (deterministic).
async function main() {
  const db = new Db();
  const mirrorDir = process.argv[2] ?? process.cwd();
  const concurrency = Number(process.argv[3] ?? 1) || 1;

  console.log(`\n=== Auto-Dev Layer (target=${config.targetRepo}, driver=${config.agentDriver}, mirror=${mirrorDir}) ===`);

  // before_run hook: inject the grounded brief as a file the agent can read (spec §4 — workspace gets
  // the brief, not a product-side skill). after_create installs nothing here (deps left to the product).
  const outcomes = await runAutoDev(config.targetRepo, {
    db,
    mirrorDir,
    concurrency,
    hooks: {
      beforeRun: async (path) => {
        // The brief is assembled per run inside the orchestrator; here we leave an AGENTS.md placeholder
        // so the workspace advertises the convention. (Real brief-file injection happens with the v2
        // driver that actually reads it; the stub reads the brief object directly.)
        try { writeFileSync(join(path, 'AGENTS.md'), '# selfheal auto-dev workspace\nEdit only within the brief scope.\n'); } catch { /* best effort */ }
      },
    },
    log: (m) => console.log(`  ${m}`),
  });

  console.log(`\n--- outcomes (${outcomes.length}) ---`);
  for (const o of outcomes) {
    const icon = o.status === 'pr_open' ? '✅' : o.status === 'rejected_by_verifier' ? '🚫' : '❌';
    console.log(`  ${icon} ${o.kind}/${o.ref_id.slice(0, 8)} → ${o.status}${o.artifactPath ? `  patch=${o.artifactPath}` : ''}${o.error ? `  err=${o.error}` : ''}`);
  }
  if (outcomes.length === 0) console.log('  (no approved proposals without an active/succeeded run)');

  await db.close();
}

main().catch((e) => {
  console.error('❌ autodev failed:', e);
  process.exit(1);
});
