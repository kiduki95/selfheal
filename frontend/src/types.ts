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

/**
 * Canonical mapping between the `Route` union (used by sidebar/palette/pages)
 * and URL pathnames owned by the router. The router is the single source of
 * truth for "which page" — this map keeps the legacy `Route` ids aligned with
 * paths so existing call sites (`setRoute('insights')`) keep working.
 */
export const ROUTE_PATH: Record<Route, string> = {
  dashboard: '/',
  sources: '/sources',
  reviews: '/reviews',
  processing: '/processing',
  insights: '/insights',
  agent: '/agent',
  activity: '/activity',
  settings: '/settings',
};

/** Reverse lookup: pathname -> Route id. Defaults to 'dashboard' for '/'. */
export function routeFromPath(pathname: string): Route {
  const entry = (Object.entries(ROUTE_PATH) as [Route, string][]).find(
    ([, path]) => path !== '/' && pathname.startsWith(path),
  );
  return entry ? entry[0] : 'dashboard';
}
