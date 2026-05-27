// ============================================================
// SelfHeal — code-based route tree (TanStack Router v1)
// ============================================================
// Code-based (NOT the file-based Vite plugin) to avoid a codegen step.
// A single root route renders the app shell (sidebar + topbar + <Outlet/>);
// each child route renders one page. Deep links carry type-safe search
// params validated per-route (processing ?node=, reviews ?id=, insights
// ?proposal=). Browser back/forward + refresh-keeps-page come for free from
// the router's history integration.

import { Suspense, lazy } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
} from '@tanstack/react-router';

import { RootShell } from './app';
import type { Route } from './types';
import { ROUTE_PATH } from './types';
import { useAppStore, selectTheme } from './store';

// Route-level code splitting: every page is its own lazy chunk so the initial
// `index` bundle carries only the shell + router, not all eight pages. The
// <Suspense> on the root Outlet provides the fallback for all of them.
// Processing additionally pulls in ReactFlow + dagre (~200 kB).
const DashboardPage = lazy(() => import('./pages/dashboard').then((m) => ({ default: m.DashboardPage })));
const SourcesPage = lazy(() => import('./pages/sources').then((m) => ({ default: m.SourcesPage })));
const ReviewsPage = lazy(() => import('./pages/reviews').then((m) => ({ default: m.ReviewsPage })));
const InsightsPage = lazy(() => import('./pages/insights').then((m) => ({ default: m.InsightsPage })));
const AgentPage = lazy(() => import('./pages/agent').then((m) => ({ default: m.AgentPage })));
const ActivityPage = lazy(() => import('./pages/activity').then((m) => ({ default: m.ActivityPage })));
const SettingsPage = lazy(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })));
const ProcessingPage = lazy(() => import('./pages/processing').then((m) => ({ default: m.ProcessingPage })));

// ----------------------------------------------------------------------------
// Root route — renders the app shell. The shell owns ToastProvider /
// OverlayProvider and the page chrome; child routes render into its <Outlet/>.
// ----------------------------------------------------------------------------
const rootRoute = createRootRoute({
  component: () => (
    <RootShell>
      <Suspense
        fallback={<div style={{ padding: 40, color: 'var(--fg-subtle)', fontSize: 13 }}>Loading…</div>}
      >
        <Outlet />
      </Suspense>
    </RootShell>
  ),
});

/**
 * Bridge the legacy `setRoute(route: Route)` callback signature (still used by
 * the dashboard, sidebar, command palette and overlays) onto router
 * navigation. Returns a stable-enough callback that maps a `Route` id to its
 * pathname and pushes a history entry.
 */
export function useRouteNavigate(): (route: Route) => void {
  const navigate = useNavigate();
  return (route: Route) => {
    navigate({ to: ROUTE_PATH[route] });
  };
}

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardRouteComponent,
});

function DashboardRouteComponent() {
  const setRoute = useRouteNavigate();
  return <DashboardPage setRoute={setRoute} />;
}

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sources',
  component: SourcesPage,
});

// Reviews deep link: /reviews?id=<reviewId> opens a specific review.
const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reviews',
  validateSearch: (search: Record<string, unknown>): { id?: string } => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: ReviewsPage,
});

// Processing deep link: /processing?node=<nodeId> pre-selects a graph node.
const processingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/processing',
  validateSearch: (search: Record<string, unknown>): { node?: string } => ({
    node: typeof search.node === 'string' ? search.node : undefined,
  }),
  component: ProcessingRouteComponent,
});

function ProcessingRouteComponent() {
  const { node } = processingRoute.useSearch();
  const navigate = processingRoute.useNavigate();
  const theme = useAppStore(selectTheme);
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, color: 'var(--fg-subtle)', fontSize: 13 }}>
          Loading graph…
        </div>
      }
    >
      <ProcessingPage
        colorMode={theme}
        selectedNode={node}
        // Reflect the in-graph selection into the URL so the view is shareable
        // and survives refresh. `replace` avoids polluting back/forward history.
        onSelectNode={(id) =>
          navigate({
            search: { node: id ?? undefined },
            replace: true,
          })
        }
      />
    </Suspense>
  );
}

// Insights deep link: /insights?proposal=<proposalId> opens a proposal.
const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  validateSearch: (search: Record<string, unknown>): { proposal?: string } => ({
    proposal: typeof search.proposal === 'string' ? search.proposal : undefined,
  }),
  component: InsightsRouteComponent,
});

function InsightsRouteComponent() {
  const { proposal } = insightsRoute.useSearch();
  return <InsightsPage initialProposalId={proposal} />;
}

const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agent',
  component: () => <AgentPage cardStyle="timeline" />,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  component: ActivityPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  sourcesRoute,
  reviewsRoute,
  processingRoute,
  insightsRoute,
  agentRoute,
  activityRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  // Unknown paths fall back to the dashboard rather than a hard 404.
  defaultNotFoundComponent: DashboardRouteComponent,
});

// Register the router instance type for fully type-safe navigation/links.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
