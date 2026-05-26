// Shared cross-cutting types (kept tiny to avoid import cycles).

export type Route =
  | 'dashboard'
  | 'sources'
  | 'reviews'
  | 'processing'
  | 'insights'
  | 'agent'
  | 'activity'
  | 'settings';
