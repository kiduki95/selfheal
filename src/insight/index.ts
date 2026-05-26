// Insight & Proposal layer — public entry. Turns signals into prioritized issue drafts.
// (Per-layer run entry, matching the modular structure in docs/architecture.md §4.)
export { runInsight, verifyGapProposal, type ProposalView, type GapVerdict } from './insight.js';
