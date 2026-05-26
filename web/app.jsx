// ============================================================
// SelfHeal — App shell (sidebar, topbar, router)
// ============================================================

const NAV = [
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

const PAGE_META = {
  dashboard:  { crumbs: ['Loop', 'Dashboard'],                title: 'Dashboard',                sub: 'Last 7 days · loop-app · main branch · auto-sync on' },
  sources:    { crumbs: ['Loop', 'Sources'],                  title: 'Review sources',           sub: 'Where SelfHeal listens for user feedback — own apps and competitors.' },
  reviews:    { crumbs: ['Loop', 'Reviews'],                  title: 'Raw reviews',              sub: 'Every review ingested in the last 24 hours, with full AI classification & mapping.' },
  processing: { crumbs: ['Loop', 'Processing'],               title: 'Processing graph',         sub: 'Repository modules mapped against incoming review clusters.' },
  insights:   { crumbs: ['Loop', 'Insights & Proposals'],     title: 'Insights & Proposals',     sub: 'Generated weekly from clustered feedback. Approve to send to Auto-Dev.' },
  agent:      { crumbs: ['Loop', 'Auto-Dev Agents'],          title: 'Auto-Dev agents',          sub: 'Claude agents working through approved proposals. Stops at PR.' },
  activity:   { crumbs: ['Loop', 'Activity log'],             title: 'Activity log',             sub: 'Every action by humans, agents, and the system — fully audited.' },
  settings:   { crumbs: ['Loop', 'Settings'],                 title: 'Settings',                 sub: 'Integrations, infrastructure, and team configuration.' },
};

function Sidebar({ route, setRoute, openOnboarding }) {
  const overlays = useOverlays();
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
                onClick={() => setRoute(it.id)}
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
          <div className="avatar">MO</div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div className="user-name">Maya Ortiz</div>
            <div className="user-org">Loop · admin</div>
          </div>
          <Icons.ChevDown />
        </div>
      </div>
    </aside>
  );
}

function Topbar({ route, themeMode, setThemeMode }) {
  const meta = PAGE_META[route];
  const overlays = useOverlays();
  const bellRef = useRef(null);
  const dateRef = useRef(null);
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
        <Button variant="ghost" className="icon-only" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())} title="Date range">
        </Button>
        <Button variant="ghost" className="icon-only" onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')} title="Toggle theme">
          {themeMode === 'dark' ? <Icons.Sun /> : <Icons.Moon />}
        </Button>
        <button ref={bellRef} className="btn ghost icon-only" title="Notifications" onClick={() => overlays.openNotifs(bellRef.current.getBoundingClientRect())} style={{ position: 'relative' }}>
          <Icons.Bell />
          <span style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg)' }} />
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------

function App() {
  const defaults = window.__TWEAK_DEFAULTS;
  const [tweaks, setTweak] = useTweaks(defaults);
  const [route, setRoute] = useState('dashboard');
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme || 'dark');
  }, [tweaks.theme]);

  // Listen for command-palette "open wizard" event
  useEffect(() => {
    const onOpen = () => setShowOnboarding(true);
    window.addEventListener('selfheal:open-wizard', onOpen);
    return () => window.removeEventListener('selfheal:open-wizard', onOpen);
  }, []);

  // Tweaks panel content
  const renderTweaks = () => (
    <Fragment>
      <TweakSection title="Theme">
        <TweakRadio
          label="Mode"
          value={tweaks.theme}
          options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
          onChange={(v) => setTweak('theme', v)}
        />
      </TweakSection>
      <TweakSection title="Processing graph">
        <TweakRadio
          label="Layout"
          value={tweaks.graphStyle}
          options={[
            { value: 'tree',  label: 'Tree' },
            { value: 'radial',label: 'Radial' },
            { value: 'force', label: 'Force' },
          ]}
          onChange={(v) => setTweak('graphStyle', v)}
        />
      </TweakSection>
      <TweakSection title="Agent cards">
        <TweakRadio
          label="Style"
          value={tweaks.agentCardStyle}
          options={[
            { value: 'timeline', label: 'Timeline' },
            { value: 'terminal', label: 'Terminal' },
            { value: 'compact',  label: 'Compact' },
          ]}
          onChange={(v) => setTweak('agentCardStyle', v)}
        />
      </TweakSection>
    </Fragment>
  );

  const meta = PAGE_META[route];

  return (
    <ToastProvider>
      <OverlayProvider setRoute={setRoute}>
        <div className="app">
          <Sidebar route={route} setRoute={setRoute} openOnboarding={() => setShowOnboarding(true)} />
          <div className="main">
            <Topbar route={route} themeMode={tweaks.theme} setThemeMode={(v) => setTweak('theme', v)} />
            <div className="content">
              <div className="page" data-screen-label={`page-${route}`}>
                {route !== 'settings' && route !== 'onboarding' && (
                  <div className="page-header">
                    <div className="page-title-row">
                      <div className="page-title">{meta.title}</div>
                      <div className="page-sub">{meta.sub}</div>
                    </div>
                    <PageActions route={route} setRoute={setRoute} />
                  </div>
                )}

                {route === 'dashboard'  && <DashboardPage  setRoute={setRoute} />}
                {route === 'sources'    && <SourcesPage />}
                {route === 'reviews'    && <ReviewsPage />}
                {route === 'processing' && <ProcessingPage graphStyle={tweaks.graphStyle} />}
                {route === 'insights'   && <InsightsPage />}
                {route === 'agent'      && <AgentPage cardStyle={tweaks.agentCardStyle} />}
                {route === 'activity'   && <ActivityPage />}
                {route === 'settings'   && <SettingsPage />}
              </div>
            </div>
          </div>

          {showOnboarding && <OnboardingFlow onClose={() => setShowOnboarding(false)} />}

          <TweaksPanel>{renderTweaks()}</TweaksPanel>
        </div>
      </OverlayProvider>
    </ToastProvider>
  );
}

function PageActions({ route, setRoute }) {
  const overlays = useOverlays();
  if (route === 'dashboard') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 7 days</Button>
        <Button leftIcon={<Icons.Refresh />} onClick={() => overlays.toast({ title: 'Refreshed', body: 'Pipeline stats re-fetched · 1.2s', icon: <Icons.Check /> })}>Refresh</Button>
        <Button variant="primary" leftIcon={<Icons.Sparkles />} onClick={() => setRoute('insights')}>Review proposals</Button>
      </div>
    );
  }
  if (route === 'sources') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Filter />}>All sources</Button>
        <Button variant="primary" leftIcon={<Icons.Plus />} onClick={() => overlays.openAddSource()}>Add source</Button>
      </div>
    );
  }
  if (route === 'reviews') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 24 h</Button>
        <Button variant="ghost" leftIcon={<Icons.External />} onClick={() => overlays.toast({ title: 'Export started', body: '487 reviews → CSV · download ready in ~10s', icon: <Icons.External /> })}>Export CSV</Button>
      </div>
    );
  }
  if (route === 'activity') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 24 h</Button>
        <Button variant="ghost" leftIcon={<Icons.External />} onClick={() => overlays.toast({ title: 'Audit export queued', body: '142 events · JSON · emailed to maya@loop.app', icon: <Icons.External /> })}>Export audit</Button>
      </div>
    );
  }
  if (route === 'processing') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Calendar />} onClick={(e) => overlays.openDateRange(e.currentTarget.getBoundingClientRect())}>Last 7 days</Button>
        <Button leftIcon={<Icons.External />} onClick={() => overlays.toast({ title: 'Opening GitHub', body: 'loop/loop-app · main · a3f9c1d', icon: <Icons.Github /> })}>Open in GitHub</Button>
      </div>
    );
  }
  if (route === 'insights') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Filter />}>All clusters</Button>
        <Button variant="ghost" leftIcon={<Icons.Slack />} onClick={() => overlays.openSlack('P-241')}>View Slack</Button>
        <Button variant="primary" leftIcon={<Icons.Sparkles />} onClick={() => overlays.confirm({
          title: 'Regenerate insights now?',
          body: 'Runs claude-opus-4-7 against the top 12 clusters. Costs ~$3 and replaces this week\'s draft proposals. The next scheduled run (Mon 09:00 KST) will still happen.',
          confirmLabel: 'Regenerate now',
          onConfirm: () => overlays.toast({ title: 'Regenerating insights', body: '12 clusters · claude-opus-4-7 · eta ~2 min', icon: <Icons.Sparkles /> }),
        })}>Regenerate insights</Button>
      </div>
    );
  }
  if (route === 'agent') {
    return (
      <div className="page-actions">
        <Button variant="ghost" leftIcon={<Icons.Filter />}>All agents</Button>
        <Button leftIcon={<Icons.Pause />} onClick={() => overlays.confirm({
          title: 'Pause Auto-Dev queue?',
          body: 'Running agents will finish their current step then halt. Queued runs won\'t start until you resume. Reviewers can still approve proposals.',
          confirmLabel: 'Pause queue',
          onConfirm: () => overlays.toast({ title: 'Queue paused', body: '4 agents halting after current step', icon: <Icons.Pause /> }),
        })}>Pause queue</Button>
      </div>
    );
  }
  return null;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
