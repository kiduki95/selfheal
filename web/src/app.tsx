// ============================================================
// SelfHeal — App shell (sidebar, topbar, router outlet)
// ============================================================
// `RootShell` is the root route's component: it renders the persistent
// chrome (sidebar + topbar + page header) and hosts the routed page via
// `children` (the router <Outlet/>). Routing is owned by router.tsx; theme,
// onboarding wizard and session/RBAC are owned by the Zustand store.

import { Fragment, useRef } from 'react';
import type { ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import type { Route } from './types';
import { routeFromPath } from './types';
import { Icons } from './components/icons';
import type { IconName } from './components/icons';
import { Button, ToastProvider } from './components/ui';
import { OverlayProvider, useOverlays } from './components/overlays';
import { OnboardingFlow } from './pages/onboarding';
import { useRouteNavigate } from './router';
import {
  useAppStore,
  selectTheme,
  selectWizardOpen,
  canApprove,
  canAdmin,
} from './store';

interface NavItem {
  id: Route;
  label: string;
  icon: IconName;
  badge?: string;
  badgeAccent?: boolean;
}
interface NavSection {
  section: string;
  items: NavItem[];
}
interface PageMeta {
  crumbs: string[];
  title: string;
  sub: string;
}

const NAV: NavSection[] = [
  { section: 'Operate', items: [
    { id: 'dashboard',  label: 'Dashboard',   icon: 'Home' },
    { id: 'sources',    label: 'Sources',     icon: 'Inbox',   badge: '8' },
    { id: 'reviews',    label: 'Reviews',     icon: 'Layers',  badge: '1.2k' },
    { id: 'processing', label: 'Processing',  icon: 'Graph' },
  ]},
  { section: 'Decide', items: [
    { id: 'insights',   label: 'Insights & Proposals', icon: 'Sparkles', badge: '11', badgeAccent: true },
    { id: 'agent',      label: 'Auto-Dev Agents',      icon: 'Robot',    badge: '4' },
  ]},
  { section: 'Configure', items: [
    { id: 'activity',   label: 'Activity log',  icon: 'Activity' },
    { id: 'settings',   label: 'Settings',      icon: 'Cog' },
  ]},
];

const PAGE_META: Record<Route, PageMeta> = {
  dashboard:  { crumbs: ['Loop', 'Dashboard'],                title: 'Dashboard',                sub: 'Last 7 days · loop-app · main branch · auto-sync on' },
  sources:    { crumbs: ['Loop', 'Sources'],                  title: 'Review sources',           sub: 'Where SelfHeal listens for user feedback — own apps and competitors.' },
  reviews:    { crumbs: ['Loop', 'Reviews'],                  title: 'Raw reviews',              sub: 'Every review ingested in the last 24 hours, with full AI classification & mapping.' },
  processing: { crumbs: ['Loop', 'Processing'],               title: 'Processing graph',         sub: 'Repository modules mapped against incoming review clusters.' },
  insights:   { crumbs: ['Loop', 'Insights & Proposals'],     title: 'Insights & Proposals',     sub: 'Generated weekly from clustered feedback. Approve to send to Auto-Dev.' },
  agent:      { crumbs: ['Loop', 'Auto-Dev Agents'],          title: 'Auto-Dev agents',          sub: 'Claude agents working through approved proposals. Stops at PR.' },
  activity:   { crumbs: ['Loop', 'Activity log'],             title: 'Activity log',             sub: 'Every action by humans, agents, and the system — fully audited.' },
  settings:   { crumbs: ['Loop', 'Settings'],                 title: 'Settings',                 sub: 'Integrations, infrastructure, and team configuration.' },
};

function Sidebar({ route, setRoute, openOnboarding }: {
  route: Route;
  setRoute: (r: Route) => void;
  openOnboarding: () => void;
}) {
  const overlays = useOverlays();
  // Identity + role come from the session store (mock default until a real
  // /api/session hydrates it). The chip is presentational only.
  const user = useAppStore((s) => s.user);
  const userRole = useAppStore((s) => s.role);
  const initials = user.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 3a9 9 0 109 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M21 3v6h-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="brand-name">selfheal</div>
        <div className="brand-env">prod</div>
      </div>

      {NAV.map((sec) => (
        <div className="nav-section" key={sec.section}>
          <div className="nav-section-title">{sec.section}</div>
          {sec.items.map((it) => {
            const Ic = Icons[it.icon];
            return (
              <div
                key={it.id}
                className={`nav-item ${route === it.id ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                aria-current={route === it.id ? 'page' : undefined}
                onClick={() => setRoute(it.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRoute(it.id); } }}
              >
                <span className="nav-ico"><Ic /></span>
                <span>{it.label}</span>
                {it.badge && (
                  <span className={`nav-badge ${it.badgeAccent ? 'accent' : ''}`}>{it.badge}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="sidebar-foot">
        <div className="nav-item" onClick={openOnboarding}>
          <span className="nav-ico"><Icons.Lightning /></span>
          <span>Setup wizard</span>
        </div>
        <div className="nav-item">
          <span className="nav-ico"><Icons.Help /></span>
          <span>Help & docs</span>
        </div>
        <div className="user-chip" onClick={(e) => overlays.openUserMenu(e.currentTarget.getBoundingClientRect())}>
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div className="user-name">{user.name}</div>
            <div className="user-org">{user.org} · {userRole}</div>
          </div>
          <Icons.ChevDown />
        </div>
      </div>
    </aside>
  );
}

function Topbar({ route }: { route: Route }) {
  const meta = PAGE_META[route];
  const overlays = useOverlays();
  const theme = useAppStore(selectTheme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const bellRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="topbar">
      <div className="crumbs">
        {meta.crumbs.map((c, i) => (
          <Fragment key={i}>
            <span className={i === meta.crumbs.length - 1 ? 'curr' : ''}>{c}</span>
            {i < meta.crumbs.length - 1 && <span className="sep"><Icons.ChevRight /></span>}
          </Fragment>
        ))}
      </div>
      <div className="actions">
        <div className="search" style={{ width: 280 }} onClick={() => overlays.openPalette()}>
          <span className="ico"><Icons.Search /></span>
          <input className="input" placeholder="Search reviews, modules, proposals…" readOnly style={{ cursor: 'pointer' }} onFocus={(e) => e.target.blur()} />
          <span className="kbd">⌘K</span>
        </div>
        <Button variant="ghost" className="icon-only" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())} title="Date range" aria-label="Date range">
        </Button>
        <Button variant="ghost" className="icon-only" onClick={() => toggleTheme()} title="Toggle theme" aria-label="Toggle theme">
          {theme === 'dark' ? <Icons.Sun /> : <Icons.Moon />}
        </Button>
        <button ref={bellRef} className="btn ghost icon-only" title="Notifications" aria-label="Notifications" onClick={() => overlays.openNotifs(bellRef.current?.getBoundingClientRect())} style={{ position: 'relative' }}>
          <Icons.Bell />
          <span style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg)' }} />
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------

/**
 * Root route component. Renders the persistent app chrome and the routed page
 * (passed as `children`, i.e. the router <Outlet/>). Theme + wizard state come
 * from the store; the current `Route` is derived from the router location.
 */
export function RootShell({ children }: { children: ReactNode }) {
  const setRoute = useRouteNavigate();
  // Derive the active Route from the current pathname (router is source of
  // truth). Subscribing to just the pathname avoids re-renders on search
  // param changes (e.g. ?node= selection on the processing page).
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const route = routeFromPath(pathname);

  const wizardOpen = useAppStore(selectWizardOpen);
  const openWizard = useAppStore((s) => s.openWizard);
  const closeWizard = useAppStore((s) => s.closeWizard);

  const meta = PAGE_META[route];

  return (
    <ToastProvider>
      <OverlayProvider setRoute={setRoute}>
        <div className="app">
          <Sidebar route={route} setRoute={setRoute} openOnboarding={openWizard} />
          <div className="main">
            <Topbar route={route} />
            <div className="content">
              <div className="page" data-screen-label={`page-${route}`}>
                {route !== 'settings' && (
                  <div className="page-header">
                    <div className="page-title-row">
                      <div className="page-title">{meta.title}</div>
                      <div className="page-sub">{meta.sub}</div>
                    </div>
                    <PageActions route={route} setRoute={setRoute} />
                  </div>
                )}

                {children}
              </div>
            </div>
          </div>

          {wizardOpen && <OnboardingFlow onClose={closeWizard} />}
        </div>
      </OverlayProvider>
    </ToastProvider>
  );
}

function PageActions({ route, setRoute }: { route: Route; setRoute: (r: Route) => void }) {
  const overlays = useOverlays();
  // RBAC: client gating is UX-only — the server re-checks token + role on every
  // write/destructive route (docs/web-architecture.md §4.1). These selectors
  // just hide/disable controls the current role may not use.
  const approve = useAppStore(canApprove); // reviewer + admin
  const admin = useAppStore(canAdmin);     // admin only
  if (route === 'dashboard') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 7 days</Button>
        <Button leftIcon={<Icons.Refresh />} onClick={() => overlays.toast?.({ title: 'Refreshed', body: 'Pipeline stats re-fetched · 1.2s', icon: <Icons.Check /> })}>Refresh</Button>
        <Button variant="primary" leftIcon={<Icons.Sparkles />} onClick={() => setRoute('insights')}>Review proposals</Button>
      </div>
    );
  }
  if (route === 'sources') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Filter />}>All sources</Button>
        {/* Add source is an admin-only write action. */}
        {admin && (
          <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => overlays.openAddSource()}>Add source</Button>
        )}
      </div>
    );
  }
  if (route === 'reviews') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 24 h</Button>
        <Button variant="ghost" leftIcon={<Icons.External />} onClick={() => overlays.toast?.({ title: 'Export started', body: '487 reviews → CSV · download ready in ~10s', icon: <Icons.External /> })}>Export CSV</Button>
      </div>
    );
  }
  if (route === 'activity') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 24 h</Button>
        <Button variant="ghost" leftIcon={<Icons.External />} onClick={() => overlays.toast?.({ title: 'Audit export queued', body: '142 events · JSON · emailed to maya@loop.app', icon: <Icons.External /> })}>Export audit</Button>
      </div>
    );
  }
  if (route === 'processing') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 7 days</Button>
        <Button leftIcon={<Icons.External />} onClick={() => overlays.toast?.({ title: 'Opening GitHub', body: 'loop/loop-app · main · a3f9c1d', icon: <Icons.Github /> })}>Open in GitHub</Button>
      </div>
    );
  }
  if (route === 'insights') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Filter />}>All clusters</Button>
        <Button variant="ghost" leftIcon={<Icons.Slack />} onClick={() => overlays.openSlack('P-241')}>View Slack</Button>
        {/* Regenerate insights costs money + dispatches the LLM: reviewer/admin only. */}
        {approve && (
          <Button variant="primary" leftIcon={<Icons.Sparkles />} onClick={() => overlays.confirm({
            title: 'Regenerate insights now?',
            body: 'Runs claude-opus-4-7 against the top 12 clusters. Costs ~$3 and replaces this week\'s draft proposals. The next scheduled run (Mon 09:00 KST) will still happen.',
            confirmLabel: 'Regenerate now',
            onConfirm: () => overlays.toast?.({ title: 'Regenerating insights', body: '12 clusters · claude-opus-4-7 · eta ~2 min', icon: <Icons.Sparkles /> }),
          })}>Regenerate insights</Button>
        )}
      </div>
    );
  }
  if (route === 'agent') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Filter />}>All agents</Button>
        {/* Pausing the Auto-Dev queue is an admin-only control. */}
        {admin && (
          <Button leftIcon={<Icons.Pause />} onClick={() => overlays.confirm({
            title: 'Pause Auto-Dev queue?',
            body: 'Running agents will finish their current step then halt. Queued runs won\'t start until you resume. Reviewers can still approve proposals.',
            confirmLabel: 'Pause queue',
            onConfirm: () => overlays.toast?.({ title: 'Queue paused', body: '4 agents halting after current step', icon: <Icons.Pause /> }),
          })}>Pause queue</Button>
        )}
      </div>
    );
  }
  return null;
}
