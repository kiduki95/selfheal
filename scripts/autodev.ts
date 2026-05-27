import { Db } from '../src/db/db.js';
import { runAutoDev } from '../src/autodev/index.js';
import { config } from '../src/config.js';

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

  // No workspace-file injection: the grounded brief reaches the agent through the driver prompt
  // (ClaudeCliAgentDriver.buildAgentPrompt), NOT a file in the worktree. Writing a brief/AGENTS.md into
  // the worktree would surface in `git status` and get rejected by verify's scope gate (+ pollute the
  // patch), so the brief stays out-of-tree.
  const outcomes = await runAutoDev(config.targetRepo, {
    db,
    mirrorDir,
    concurrency,
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
