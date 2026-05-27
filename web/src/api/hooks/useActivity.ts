// Audit / activity log — GET /api/activity (architecture.md §3.1).
import { useQuery } from '@tanstack/react-query';
import { resolve } from '../client';
import { queryKeys } from '../keys';
import { AUDIT_EVENTS, type AuditEvent } from '../../data/mock-extras';

export function useActivity() {
  return useQuery({
    queryKey: queryKeys.activity,
    queryFn: () => resolve<AuditEvent[]>('activity', '/api/activity', () => AUDIT_EVENTS),
  });
}
