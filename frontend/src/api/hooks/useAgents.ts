// Auto-Dev agent runs — GET /api/agents (architecture.md §3.1).
// Bundles the agent runs and the shared terminal log lines the page renders.
import { useQuery } from '@tanstack/react-query';
import { resolve } from '../client';
import { queryKeys } from '../keys';
import { AGENTS, TERMINAL_LINES, type AgentRun, type TerminalLine } from '../../data/mock';

export interface AgentsPayload {
  agents: AgentRun[];
  terminalLines: TerminalLine[];
}

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: () =>
      resolve<AgentsPayload>('agents', '/api/agents', () => ({
        agents: AGENTS,
        terminalLines: TERMINAL_LINES,
      })),
  });
}
