// ============================================================
// Query key factory — 1:1 with architecture.md §3.1 endpoints
// ============================================================
// Centralizes TanStack Query cache keys so invalidation stays consistent.
// Each key maps to a page-data need / GET /api/* route.

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  sources: ['sources'] as const,
  reviews: ['reviews'] as const,
  graph: ['graph'] as const,
  proposals: ['proposals'] as const,
  agents: ['agents'] as const,
  activity: ['activity'] as const,
  config: ['config'] as const,
} as const;
