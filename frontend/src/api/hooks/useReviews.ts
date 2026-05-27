// Raw reviews stream — GET /api/reviews (architecture.md §3.1).
import { useQuery } from '@tanstack/react-query';
import { resolve } from '../client';
import { queryKeys } from '../keys';
import { RAW_REVIEWS, type RawReview } from '../../data/mock-extras';

export function useReviews() {
  return useQuery({
    queryKey: queryKeys.reviews,
    queryFn: () => resolve<RawReview[]>('reviews', '/api/reviews', () => RAW_REVIEWS),
  });
}
