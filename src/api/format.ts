// Display formatting helpers for /api responses.
// The web mock supplies pre-formatted relative time strings (the UI renders them
// verbatim), so the live handlers format here to match that contract exactly.
// Two flavors because the mock uses two styles:
//   - reviews `when`  -> verbose  ('14 min ago')
//   - graph   `date`  -> compact  ('2h')

function elapsedSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

// '14 min ago' style — matches web/src/data/mock-extras.ts `when`.
export function toRelativeLong(iso: string | null): string {
  const s = elapsedSeconds(iso);
  if (s === null) return iso ?? '';
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo > 1 ? 's' : ''} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) > 1 ? 's' : ''} ago`;
}

// '2h' style — matches web/src/data/mock.ts GraphReview `date`.
export function toRelativeCompact(iso: string | null): string {
  const s = elapsedSeconds(iso);
  if (s === null) return iso ?? '';
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}
