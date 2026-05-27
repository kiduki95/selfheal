// Dashboard data — GET /api/dashboard (architecture.md §3.1).
// Aggregates the pipeline funnel, categories, activity feed, plus the proposal
// queue and agent runs the dashboard surfaces inline.
import { useQuery } from '@tanstack/react-query';
import { resolve } from '../client';
import { queryKeys } from '../keys';
import {
  PIPELINE, CATEGORIES, ACTIVITY, PROPOSALS, AGENTS,
  type PipelineStage, type Category, type ActivityItem, type Proposal, type AgentRun,
} from '../../data/mock';

export interface DashboardData {
  pipeline: PipelineStage[];
  categories: Category[];
  activity: ActivityItem[];
  proposals: Proposal[];
  agents: AgentRun[];
}

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () =>
      resolve<DashboardData>('dashboard', '/api/dashboard', () => ({
        pipeline: PIPELINE,
        categories: CATEGORIES,
        activity: ACTIVITY,
        proposals: PROPOSALS,
        agents: AGENTS,
      })),
  });
}
