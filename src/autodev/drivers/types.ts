import type { LlmUsage } from '../../clients/llm/types.js';
import type { GroundedBrief } from '../brief.js';

// Replaceable coding-agent driver — mirrors the LlmClient DI switch pattern (src/clients/llm).
// v1 ships only `stub` (LLM-free, deterministic). `claude-cli` (subscription, headless) and
// `anthropic` (Agent SDK) are added in v2 by implementing this same interface + extending the factory;
// the orchestrator stays unchanged. That is the seam the factory below keeps trivial.
export interface AgentDriverInput {
  // Absolute path to the worktree cwd the agent must edit within. The agent MUST NOT escape this root.
  workspace: string;
  // CodeFlow-grounded brief: which files, blast-radius, repro/expected/actual, commit convention (spec §4).
  brief: GroundedBrief;
  // 0-based attempt number. >0 means a verify retry — `feedback` carries the prior gate's reasons.
  attempt: number;
  // Verifier feedback re-injected on retry (spec §5 bounded-retry loop).
  feedback?: string;
}

export interface AgentDriverResult {
  // Repo-relative paths the agent created/modified. Verify cross-checks this against the diff + scope.
  filesChanged: string[];
  // One-line human summary (drives the commit message / PR body).
  summary: string;
  // Bounded-turn count the driver used (audit; stub reports 1).
  turnCount: number;
  // Token accounting when a real model ran. Absent for the stub.
  usage?: LlmUsage;
}

export interface AgentDriver {
  readonly kind: 'stub' | 'claude-cli' | 'anthropic';
  // Implement the brief inside the workspace cwd. Returns what changed so the orchestrator can
  // commit + the verifier can gate. A real driver may self-check via a verify callback (v2).
  run(input: AgentDriverInput): Promise<AgentDriverResult>;
}
