import { config } from '../../config.js';
import type { AgentDriver } from './types.js';
import { StubAgentDriver, type StubScript } from './stub.js';
import { ClaudeCliAgentDriver } from './claude-cli.js';

// Driver factory — mirrors makeLlmClient (src/clients/llm/index.ts). config.agentDriver selects the
// implementation; default 'stub' (LLM-free, no keys, no cost — [[api-key-after-subscription]]).
//
// v2 seam: adding ClaudeCliAgentDriver / AnthropicAgentDriver is a one-line branch here + a new file
// implementing AgentDriver. The orchestrator never changes. We intentionally throw (not silently fall
// back) so a misconfigured non-stub driver can't run a real model unnoticed before v2 lands.
export function makeAgentDriver(opts: { stubScript?: StubScript } = {}): AgentDriver {
  switch (config.agentDriver) {
    case 'claude-cli':
      // v2-a: subscription Claude (headless), edits inside the isolated worktree. Opt-in via
      // AGENT_DRIVER=claude-cli. Consumes the Claude Code subscription, not the metered API.
      return new ClaudeCliAgentDriver();
    case 'anthropic':
      throw new Error("agentDriver='anthropic' is not implemented yet (post-subscription). Default driver is 'stub'.");
    case 'stub':
    default:
      return new StubAgentDriver(opts.stubScript);
  }
}

export { StubAgentDriver } from './stub.js';
export type { StubScript, ScriptedEdit } from './stub.js';
export type { AgentDriver, AgentDriverInput, AgentDriverResult } from './types.js';
