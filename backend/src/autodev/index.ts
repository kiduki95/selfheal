// Auto-Dev Layer (layer 5) public entry — re-exports the orchestrator + the pieces a caller wires up.
export { runAutoDev } from './orchestrator.js';
export type { RunAutoDevOpts, RunOutcome } from './orchestrator.js';
export { assembleBrief } from './brief.js';
export type { GroundedBrief, ProposalRow, BlastRadiusEntry, ProposalKind } from './brief.js';
export { verify, backoffMs, scopePrefixes } from './verify.js';
export type { VerifyResult, VerifyConfig, GateResult, CommandRunner, Skeptic, SkepticVerdict } from './verify.js';
export { createWorkspace, sanitizeSegment, branchName } from './workspace.js';
export type { Workspace, WorkspaceHooks, WorkspaceOpts } from './workspace.js';
export { makeAgentDriver, StubAgentDriver } from './drivers/index.js';
export type { AgentDriver, AgentDriverInput, AgentDriverResult, StubScript, ScriptedEdit } from './drivers/index.js';
