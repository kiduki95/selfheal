// Processing layer — public entry. Consumers import from here, not deep pipeline/* paths.
// (Per-layer run entry, matching the modular structure in docs/architecture.md §4.)
export { processReview, type ProcessOutcome } from './pipeline/phase1.js';
export { makeContext } from './pipeline/context.js';
export { runReconciliation } from './pipeline/reconciliation.js';
