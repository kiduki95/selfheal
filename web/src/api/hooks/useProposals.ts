// Insight proposals — GET /api/proposals (architecture.md §3.1).
import { useQuery } from '@tanstack/react-query';
import { resolve } from '../client';
import { queryKeys } from '../keys';
import { PROPOSALS, type Proposal } from '../../data/mock';

export function useProposals() {
  return useQuery({
    queryKey: queryKeys.proposals,
    queryFn: () => resolve<Proposal[]>('proposals', '/api/proposals', () => PROPOSALS),
  });
}
