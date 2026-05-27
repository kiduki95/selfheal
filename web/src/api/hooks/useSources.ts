// Sources registry — GET /api/sources (architecture.md §3.1).
import { useQuery } from '@tanstack/react-query';
import { resolve } from '../client';
import { queryKeys } from '../keys';
import { SOURCES, type Source } from '../../data/mock';

export function useSources() {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => resolve<Source[]>('sources', '/api/sources', () => SOURCES),
  });
}
