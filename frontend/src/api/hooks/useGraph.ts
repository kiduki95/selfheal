// Processing graph — GET /api/graph (architecture.md §3.1).
// Returns the repo module tree + per-node sampled reviews. The page derives
// ReactFlow nodes/edges from `modules` (buildGraph) so the mock shape stays the
// raw domain data, matching the backend's feature_registry + gaps source.
import { useQuery } from '@tanstack/react-query';
import { resolve } from '../client';
import { queryKeys } from '../keys';
import { MODULES, REVIEWS, type RepoModule, type GraphReview } from '../../data/mock';

export interface GraphPayload {
  modules: RepoModule[];
  reviews: Record<string, GraphReview[]>;
}

export function useGraph() {
  return useQuery({
    queryKey: queryKeys.graph,
    queryFn: () =>
      resolve<GraphPayload>('graph', '/api/graph', () => ({
        modules: MODULES,
        reviews: REVIEWS,
      })),
  });
}
