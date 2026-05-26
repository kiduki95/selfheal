// ============================================================
// SelfHeal — Overlay system (palette, notifs, menus, modals)
// ============================================================
// One provider owns the overlay state. Pages call into context.

import { useState, useEffect, useRef, useMemo, useContext, createContext, Fragment } from 'react';
import type { ReactNode } from 'react';
import { Icons } from './icons';
import type { IconName } from './icons';
import { Badge, Button, PriDot, SourceChip, useToast } from './ui';
import { PROPOSALS } from '../data/mock';
import type { Proposal } from '../data/mock';
import type { Route } from '../types';

// Anchor passed to popovers: a measured rect, or `true` when no rect available.
type Anchor = DOMRect | true;

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm?: () => void;
}

export interface Toast {
  title: string;
  body?: string;
  icon?: ReactNode;
  duration?: number;
}

export interface OverlayContextValue {
  openPalette: () => void;
  openNotifs: (rect?: Anchor) => void;
  openUserMenu: (rect?: Anchor) => void;
  openAddSource: () => void;
  openSlack: (proposalId: string) => void;
  openDateRange: (rect?: Anchor) => void;
  confirm: (opts: ConfirmOptions) => void;
  toast: (t: Toast) => void;
  navigate: (r: Route) => void;
}

const OverlayCtx = createContext<OverlayContextValue | null>(null);
const useOverlays = (): OverlayContextValue => {
  const ctx = useContext(OverlayCtx);
  if (!ctx) throw new Error('useOverlays must be used within <OverlayProvider>');
  return ctx;
};

interface OverlayProviderProps {
  children?: ReactNode;
  setRoute: (r: Route) => void;
}

function OverlayProvider({ children, setRoute }: OverlayProviderProps) {
  const [palette,     setPalette]     = useState(false);
  const [notifs,      setNotifs]      = useState<Anchor | false>(false);
  const [userMenu,    setUserMenu]    = useState<Anchor | false>(false);
  const [addSource,   setAddSource]   = useState(false);
  const [slackThread, setSlackThread] = useState<string | null>(null); // proposalId or null
  const [dateRange,   setDateRange]   = useState<Anchor | false>(false); // anchorRect or null
  const [confirm,     setConfirm]     = useState<ConfirmOptions | null>(null); // { title, body, danger, onConfirm }
  const toast = useToast();

  // ⌘K to open palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPalette(p => !p);
      }
      if (e.key === 'Escape') {
        setPalette(false); setNotifs(false); setUserMenu(false);
        setAddSource(false); setSlackThread(null); setDateRange(false); setConfirm(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const api = useMemo<OverlayContextValue>(() => ({
    openPalette:    () => setPalette(true),
    openNotifs:     (rect) => setNotifs(rect || true),
    openUserMenu:   (rect) => setUserMenu(rect || true),
    openAddSource:  () => setAddSource(true),
    openSlack:      (proposalId) => setSlackThread(proposalId),
    openDateRange:  (rect) => setDateRange(rect || true),
    confirm:        (opts) => setConfirm(opts),
    toast,
    navigate:       (r) => setRoute(r),
  }), [toast, setRoute]);

  return (
    <OverlayCtx.Provider value={api}>
      {children}
      {palette     && <CommandPalette       onClose={() => setPalette(false)}       setRoute={setRoute} />}
      {notifs      && <NotificationsPanel   anchor={notifs}      onClose={() => setNotifs(false)} />}
      {userMenu    && <UserMenuPopover      anchor={userMenu}    onClose={() => setUserMenu(false)} />}
      {addSource   && <AddSourceModal       onClose={() => setAddSource(false)} />}
      {slackThread && <SlackThreadModal     proposalId={slackThread} onClose={() => setSlackThread(null)} />}
      {dateRange   && <DateRangePopover     anchor={dateRange}   onClose={() => setDateRange(false)} />}
      {confirm     && <ConfirmModal         {...confirm}         onClose={() => setConfirm(null)} />}
    </OverlayCtx.Provider>
  );
}

// ===========================================================================
// Command palette (⌘K)
// ===========================================================================
type PaletteItemKind = 'page' | 'action' | 'proposal';

interface PaletteItem {
  kind: PaletteItemKind;
  id: string;
  label: string;
  icon: string;
  section: string;
  sub?: string;
}

interface CommandPaletteProps {
  onClose: () => void;
  setRoute: (r: Route) => void;
}

function CommandPalette({ onClose, setRoute }: CommandPaletteProps) {
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Items: pages, quick actions, proposals, reviews
  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      // Pages
      { kind: 'page',   id: 'dashboard',  label: 'Dashboard',     icon: 'Home',     section: 'Jump to' },
      { kind: 'page',   id: 'sources',    label: 'Sources',       icon: 'Inbox',    section: 'Jump to' },
      { kind: 'page',   id: 'reviews',    label: 'Reviews',       icon: 'Layers',   section: 'Jump to' },
      { kind: 'page',   id: 'processing', label: 'Processing graph', icon: 'Graph', section: 'Jump to' },
      { kind: 'page',   id: 'insights',   label: 'Insights & Proposals', icon: 'Sparkles', section: 'Jump to' },
      { kind: 'page',   id: 'agent',      label: 'Auto-Dev Agents', icon: 'Robot',  section: 'Jump to' },
      { kind: 'page',   id: 'activity',   label: 'Activity log',  icon: 'Activity', section: 'Jump to' },
      { kind: 'page',   id: 'settings',   label: 'Settings',      icon: 'Cog',      section: 'Jump to' },

      // Quick actions
      { kind: 'action', id: 'add-source',     label: 'Connect a new review source', icon: 'Plus',     section: 'Actions' },
      { kind: 'action', id: 'regen-insights', label: 'Regenerate insights now',     icon: 'Refresh',  section: 'Actions' },
      { kind: 'action', id: 'pause-queue',    label: 'Pause Auto-Dev queue',        icon: 'Pause',    section: 'Actions' },
      { kind: 'action', id: 'invite',         label: 'Invite team member',          icon: 'Plus',     section: 'Actions' },
      { kind: 'action', id: 'toggle-theme',   label: 'Toggle theme (light/dark)',   icon: 'Moon',     section: 'Actions' },
      { kind: 'action', id: 'open-wizard',    label: 'Re-run setup wizard',         icon: 'Lightning',section: 'Actions' },

      // Proposals
      ...PROPOSALS.slice(0, 6).map((p): PaletteItem => ({
        kind: 'proposal', id: p.id, label: p.title, sub: `${p.id} · ${p.targetLabel}`,
        icon: 'Sparkles', section: 'Proposals',
      })),
    ];
    if (!q) return items;
    const needle = q.toLowerCase();
    return items.filter(it =>
      it.label.toLowerCase().includes(needle) ||
      (it.sub || '').toLowerCase().includes(needle) ||
      (it.id || '').toLowerCase().includes(needle)
    );
  }, [q]);

  // Group by section, preserving order
  const grouped = useMemo(() => {
    const map: Record<string, PaletteItem[]> = {};
    allItems.forEach(it => {
      (map[it.section] = map[it.section] || []).push(it);
    });
    return map;
  }, [allItems]);

  // Flat list for keyboard nav
  const flat = useMemo(() => allItems, [allItems]);

  useEffect(() => { setActiveIdx(0); }, [q]);

  const doAction = (it: PaletteItem) => {
    if (it.kind === 'page') { setRoute(it.id as Route); onClose(); return; }
    if (it.kind === 'proposal') { setRoute('insights'); onClose(); return; }
    if (it.kind === 'action') {
      if (it.id === 'add-source') { setRoute('sources'); onClose(); return; }
      if (it.id === 'regen-insights') { setRoute('insights'); onClose(); return; }
      if (it.id === 'pause-queue') { setRoute('agent'); onClose(); return; }
      if (it.id === 'invite') { setRoute('settings'); onClose(); return; }
      if (it.id === 'toggle-theme') {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        onClose(); return;
      }
      if (it.id === 'open-wizard') { window.dispatchEvent(new CustomEvent('selfheal:open-wizard')); onClose(); return; }
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(flat.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (flat[activeIdx]) doAction(flat[activeIdx]); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
        zIndex: 80, display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: 'min(15vh, 120px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: 620, maxWidth: '92vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <Icons.Search />
          <input
            ref={inputRef}
            placeholder="Search pages, actions, proposals…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--fg)', fontSize: 14, fontFamily: 'inherit',
            }}
          />
          <span className="kbd">esc</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {Object.entries(grouped).map(([section, items]) => (
            <Fragment key={section}>
              <div className="t-caps" style={{ padding: '8px 14px 4px' }}>{section}</div>
              {items.map((it) => {
                const idx = flat.indexOf(it);
                const Ic = Icons[it.icon as IconName];
                return (
                  <div
                    key={it.kind + '-' + it.id}
                    onClick={() => doAction(it)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    style={{
                      display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 10,
                      padding: '7px 14px', cursor: 'pointer', alignItems: 'center',
                      background: activeIdx === idx ? 'var(--surface-2)' : 'transparent',
                    }}
                  >
                    <span style={{ color: activeIdx === idx ? 'var(--accent)' : 'var(--fg-muted)', display: 'flex' }}>
                      {Ic ? <Ic /> : <Icons.ChevRight />}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--fg-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
                      {it.sub && <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>{it.sub}</div>}
                    </div>
                    {activeIdx === idx
                      ? <span className="kbd">↵</span>
                      : <Badge subtle style={{ fontSize: 10 }}>{it.kind}</Badge>}
                  </div>
                );
              })}
            </Fragment>
          ))}
          {flat.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 13 }}>
              No matches for "{q}".
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px', display: 'flex', gap: 14, fontSize: 11, color: 'var(--fg-subtle)' }}>
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> select</span>
          <span><span className="kbd">esc</span> close</span>
          <span style={{ flex: 1 }} />
          <span>{flat.length} results</span>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Notifications panel — anchored to bell
// ===========================================================================
interface NotificationsPanelProps {
  anchor: Anchor | false;
  onClose: () => void;
}

function NotificationsPanel({ anchor, onClose }: NotificationsPanelProps) {
  const rect = anchor && typeof anchor === 'object' ? anchor : null;
  const NOTIFS = [
    { kind: 'review',   t: '2 min',  text: 'P-241 needs approval', sub: 'Korean ASR fallback · 12,345 users impacted', tone: 'accent', icon: 'Sparkles' },
    { kind: 'agent',    t: '6 min',  text: 'agent_1839 opened PR #1839', sub: 'feat: per-speaker volume normalization', tone: 'info', icon: 'GitPull' },
    { kind: 'fail',     t: '14 min', text: 'agent_1832 failed', sub: 'Flaky test in integrations/notion/sync_test.ts:128', tone: 'danger', icon: 'AlertTri' },
    { kind: 'cluster',  t: '38 min', text: 'New orphan cluster detected', sub: 'cluster_92 · iPad split-view crash · 47 reviews', tone: 'warn', icon: 'Layers' },
    { kind: 'review',   t: '1 h',    text: 'Daniel rejected P-235', sub: 'Out of scope for Q1', tone: 'danger', icon: 'X' },
    { kind: 'agent',    t: '3 h',    text: 'PR #1841 merged', sub: 'fix: summary truncation for >90min meetings', tone: 'good', icon: 'Check' },
  ];
  return (
    <Fragment>
      <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={onClose} />
      <div
        className="card"
        style={{
          position: 'fixed',
          top: rect ? rect.bottom + 6 : 50,
          right: rect ? Math.max(8, window.innerWidth - rect.right) : 16,
          width: 380, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          zIndex: 71, boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <Icons.Bell />
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>Notifications</div>
          <Badge tone="accent" subtle style={{ marginLeft: 8 }}>3 new</Badge>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost">Mark all read</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {NOTIFS.map((n, i) => {
            const Ic = Icons[n.icon as IconName];
            const toneVar = `var(--${n.tone})`;
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 10,
                padding: '11px 14px', borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: `color-mix(in oklab, ${toneVar} 14%, transparent)`,
                  color: toneVar,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{Ic ? <Ic /> : <Icons.Spark />}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--fg-strong)', fontWeight: 500, lineHeight: 1.35 }}>{n.text}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{n.sub}</div>
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)', whiteSpace: 'nowrap' }}>{n.t}</div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" size="sm" leftIcon={<Icons.Cog />}>Notification settings</Button>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" rightIcon={<Icons.ArrowRight />}>View all</Button>
        </div>
      </div>
    </Fragment>
  );
}

// ===========================================================================
// User menu — anchored to sidebar user chip
// ===========================================================================
interface UserMenuPopoverProps {
  anchor: Anchor | false;
  onClose: () => void;
}

function UserMenuPopover({ anchor, onClose }: UserMenuPopoverProps) {
  const rect = anchor && typeof anchor === 'object' ? anchor : null;
  const items: { l: string; ic?: string; sub?: string; danger?: boolean }[] = [
    { l: 'Profile settings',   ic: 'Cog' },
    { l: 'Notification prefs', ic: 'Bell' },
    { l: 'Keyboard shortcuts', ic: 'Cmd' },
    { l: 'API tokens',         ic: 'Code' },
    { l: 'divider' },
    { l: 'Switch workspace',   ic: 'Refresh', sub: 'Loop HQ · 1 of 2' },
    { l: 'Help & docs',        ic: 'Help' },
    { l: 'divider' },
    { l: 'Sign out',           ic: 'Logout', danger: true },
  ];
  return (
    <Fragment>
      <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={onClose} />
      <div
        className="card"
        style={{
          position: 'fixed',
          left: rect ? rect.right + 6 : 220,
          bottom: rect ? Math.max(8, window.innerHeight - rect.bottom) : 16,
          width: 240,
          zIndex: 71, boxShadow: 'var(--shadow-lg)',
          padding: 4,
        }}
      >
        <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div className="avatar">MO</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg-strong)' }}>Maya Ortiz</div>
              <div style={{ fontSize: 10.5, color: 'var(--fg-muted)' }} className="mono">maya@loop.app</div>
            </div>
          </div>
        </div>
        {items.map((it, i) => {
          if (it.l === 'divider') return <div key={i} className="divider" style={{ margin: '4px 0' }} />;
          const Ic = Icons[it.ic as IconName] || Icons.ChevRight;
          return (
            <div key={i} onClick={onClose} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
              borderRadius: 4, cursor: 'pointer',
              color: it.danger ? 'var(--danger)' : 'var(--fg)',
              fontSize: 12.5,
            }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: it.danger ? 'var(--danger)' : 'var(--fg-muted)' }}><Ic /></span>
              <div style={{ flex: 1 }}>
                <div>{it.l}</div>
                {it.sub && <div style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>{it.sub}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Fragment>
  );
}

// ===========================================================================
// Add source modal — pick → configure → confirm
// ===========================================================================
interface AddSourceModalProps {
  onClose: () => void;
}

function AddSourceModal({ onClose }: AddSourceModalProps) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<string | null>(null);
  const [opts, setOpts] = useState({ region: 'Global', product: 'Loop', polling: '10 min' });
  const toast = useToast();

  const KINDS = [
    { k: 'appstore',  l: 'Apple App Store',  d: 'Reviews + ratings via App Store Connect API' },
    { k: 'playstore', l: 'Google Play',      d: 'Reviews via Play Developer API' },
    { k: 'reddit',    l: 'Reddit',           d: 'Subreddit / keyword crawl' },
    { k: 'twitter',   l: 'X / Twitter',      d: 'Mentions & keyword search' },
    { k: 'github',    l: 'GitHub issues',    d: 'Listen for new issues / discussions' },
    { k: 'intercom',  l: 'Intercom',         d: 'Conversations & tickets' },
    { k: 'discord',   l: 'Discord',          d: 'Server channels via bot' },
    { k: 'web',       l: 'Custom URL / RSS', d: 'Any public-facing reviews page' },
  ];

  const finish = () => {
    toast?.({ title: 'Source connected', body: `${KINDS.find(k => k.k === kind)?.l} added — first sync in ~30s`, icon: <Icons.Check /> });
    onClose();
  };

  return (
    <ModalShell onClose={onClose} width={620} height={520}
      title="Add review source"
      subtitle={step === 0 ? 'Pick where SelfHeal should listen for feedback.'
              : step === 1 ? `Configure ${KINDS.find(k => k.k === kind)?.l}`
              : 'Confirm and connect'}
    >
      {step === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {KINDS.map(s => {
            const on = kind === s.k;
            return (
              <div key={s.k} onClick={() => { setKind(s.k); setStep(1); }}
                style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr 16px', gap: 10, padding: 12,
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8, cursor: 'pointer',
                  background: on ? 'var(--accent-soft)' : 'var(--surface)',
                }}>
                <SourceChip src={s.k} label="" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{s.l}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{s.d}</div>
                </div>
                <Icons.ChevRight />
              </div>
            );
          })}
        </div>
      )}

      {step === 1 && kind && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg-soft)', borderRadius: 6 }}>
            <SourceChip src={kind} label="" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)' }}>{KINDS.find(k => k.k === kind)?.l}</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>SelfHeal will poll this source every {opts.polling}.</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setStep(0)}>Change</Button>
          </div>

          <FieldRow label="Product association" hint="Reviews from this source will be mapped to:">
            <div style={{ display: 'flex', gap: 6 }}>
              <Badge tone="accent" subtle>Loop ✓</Badge>
              <Badge subtle>Otter.ai</Badge>
              <Badge subtle>Fireflies</Badge>
              <Button size="sm" variant="ghost" leftIcon={<Icons.Plus />}>New</Button>
            </div>
          </FieldRow>

          {kind === 'appstore' && (
            <Fragment>
              <FieldRow label="App ID"><input className="input mono" defaultValue="6478211093" /></FieldRow>
              <FieldRow label="Countries" hint="ISO codes, comma-separated. * for all.">
                <input className="input mono" defaultValue="US, KR, JP, GB, DE" />
              </FieldRow>
            </Fragment>
          )}
          {kind === 'playstore' && (
            <Fragment>
              <FieldRow label="Package name"><input className="input mono" defaultValue="com.loop.notes" /></FieldRow>
              <FieldRow label="Languages"><input className="input mono" defaultValue="en, ko, ja, de" /></FieldRow>
            </Fragment>
          )}
          {kind === 'reddit' && (
            <Fragment>
              <FieldRow label="Subreddits"><input className="input mono" defaultValue="r/productivity, r/saas, r/macapps" /></FieldRow>
              <FieldRow label="Keywords"><input className="input mono" defaultValue="loop notes, @loopnotes" /></FieldRow>
            </Fragment>
          )}
          {kind === 'twitter' && (
            <Fragment>
              <FieldRow label="Handle"><input className="input mono" defaultValue="@loopnotes" /></FieldRow>
              <FieldRow label="Keywords"><input className="input mono" defaultValue="loop notes, loop.app, loopnotes" /></FieldRow>
            </Fragment>
          )}
          {kind === 'github' && (
            <Fragment>
              <FieldRow label="Repo"><input className="input mono" defaultValue="loop/loop-app" /></FieldRow>
              <FieldRow label="Track"><div style={{ display: 'flex', gap: 6 }}><Badge tone="accent" subtle>Issues</Badge><Badge tone="accent" subtle>Discussions</Badge><Badge subtle>PR comments</Badge></div></FieldRow>
            </Fragment>
          )}
          {(kind === 'intercom' || kind === 'discord' || kind === 'web') && (
            <Fragment>
              <FieldRow label="Endpoint"><input className="input mono" defaultValue={kind === 'web' ? 'https://example.com/reviews.rss' : 'https://api.example.com'} /></FieldRow>
              <FieldRow label="Auth"><Badge subtle>OAuth · connect to authenticate</Badge></FieldRow>
            </Fragment>
          )}

          <FieldRow label="Polling interval">
            <div style={{ display: 'flex', gap: 6 }}>
              {['5 min', '10 min', '30 min', '1 h'].map(p =>
                <Badge key={p} tone={opts.polling === p ? 'accent' : ''} subtle onClick={() => setOpts({ ...opts, polling: p })} style={{ cursor: 'pointer' }}>{p}</Badge>
              )}
            </div>
          </FieldRow>
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <span style={{ flex: 1 }} />
        {step === 1 && <Button variant="ghost" leftIcon={<Icons.ChevLeft />} onClick={() => setStep(0)}>Back</Button>}
        {step === 0 && <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Pick a source to continue</span>}
        {step === 1 && <Button variant="primary" rightIcon={<Icons.Check />} onClick={finish}>Connect source</Button>}
      </ModalFooter>
    </ModalShell>
  );
}

interface FieldRowProps {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}

function FieldRow({ label, hint, children }: FieldRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 14, alignItems: 'start' }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: 'var(--fg-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ===========================================================================
// Slack thread modal — peek at the discussion on a proposal
// ===========================================================================
interface SlackMessage {
  u: string;
  isBot?: boolean;
  t?: string;
  ts?: string;
  body: string;
  card?: Proposal;
  isSystem?: boolean;
  reactions?: [string, number][];
}

interface SlackThreadModalProps {
  proposalId: string;
  onClose: () => void;
}

function SlackThreadModal({ proposalId, onClose }: SlackThreadModalProps) {
  const p = PROPOSALS.find(x => x.id === proposalId) || PROPOSALS[0];
  const messages: SlackMessage[] = [
    { u: 'SelfHeal', isBot: true, t: '09:14', body: 'bot-card', card: p },
    { u: 'Maya Ortiz',   ts: '09:18', body: "P0 on the Korean ASR — we've been bleeding accounts in KR for a month. Approving." },
    { u: 'Daniel Kim',   ts: '09:22', body: "Agreed. Worth confirming the noise threshold (<12dB SNR) is right — the SDM team had data suggesting 15dB is closer to room conditions." },
    { u: 'Priya Shah',   ts: '09:24', body: "I'll loop in Sangmin from ML for review before the agent runs. The fallback path itself looks clean." },
    { u: 'Maya Ortiz',   ts: '09:26', body: "Good call. Let's approve, then have Sangmin sign off before dispatch.", reactions: [['👍', 2], ['🚀', 1]] },
    { u: 'SelfHeal', isBot: true, t: '09:27', body: 'Approved by Maya Ortiz · waiting on agent dispatch', isSystem: true },
  ];
  return (
    <ModalShell onClose={onClose} width={620} height={620}
      title="Slack thread"
      subtitle={<span><span className="mono">#selfheal-review</span> · {p.id} · {p.title}</span>}
      headerAction={<Button size="sm" variant="ghost" leftIcon={<Icons.External />}>Open in Slack</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map((m, i) => {
          if (m.body === 'bot-card' && m.card) {
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: 10, background: 'var(--bg-soft)', borderRadius: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, var(--accent), var(--accent-press))', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-fg)', fontWeight: 700, fontSize: 12 }}>S</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: 'var(--fg-strong)', fontSize: 13 }}>SelfHeal</span>
                    <Badge subtle style={{ fontSize: 9 }}>APP</Badge>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--fg-subtle)', marginLeft: 'auto' }}>{m.t}</span>
                  </div>
                  <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 10, fontSize: 12.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <PriDot p={m.card.pri} />
                      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{m.card.id}</span>
                      <span className="dot-divider">·</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{m.card.cluster}</span>
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--fg-strong)', marginBottom: 4 }}>{m.card.title}</div>
                    <div style={{ color: 'var(--fg-muted)', marginBottom: 8, lineHeight: 1.5 }}>{m.card.problem || m.card.proposal || 'See proposal in SelfHeal.'}</div>
                    <div style={{ display: 'flex', gap: 12, color: 'var(--fg-muted)', fontSize: 11, marginBottom: 8 }}>
                      <span><Icons.Layers /> {m.card.impacted.toLocaleString()} users</span>
                      <span><Icons.Clock /> {m.card.effort}</span>
                      <span>⌧ {m.card.confidence}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <div className="btn primary sm">Approve</div>
                      <div className="btn sm" style={{ color: 'var(--danger)' }}>Reject</div>
                      <div className="btn sm">View in SelfHeal ↗</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          if (m.isSystem) {
            return (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 10px', fontSize: 11.5, color: 'var(--accent)' }}>
                <Icons.Check />
                <span style={{ flex: 1 }}>{m.body}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{m.t}</span>
              </div>
            );
          }
          const initials = m.u.split(' ').map(s => s[0]).join('').slice(0, 2);
          return (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '4px 0' }}>
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{initials}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, color: 'var(--fg-strong)', fontSize: 13 }}>{m.u}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{m.ts}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.5, marginTop: 2 }}>{m.body}</div>
                {m.reactions && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {m.reactions.map(([emoji, n]) =>
                      <span key={emoji} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '1px 7px', borderRadius: 10,
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        fontSize: 11,
                      }}>{emoji} <span className="mono fg-muted">{n}</span></span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ModalFooter>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
          <input className="input" placeholder="Reply in thread…" />
          <Button size="sm" variant="primary">Send</Button>
        </div>
      </ModalFooter>
    </ModalShell>
  );
}

// ===========================================================================
// Date range popover
// ===========================================================================
interface DateRangePopoverProps {
  anchor: Anchor | false;
  onClose: () => void;
}

function DateRangePopover({ anchor, onClose }: DateRangePopoverProps) {
  const rect = anchor && typeof anchor === 'object' ? anchor : null;
  const RANGES = [
    'Last 1 hour', 'Last 24 hours', 'Last 7 days', 'Last 30 days', 'Last 90 days',
    'Last quarter', 'Year to date', 'All time', 'Custom range…',
  ];
  const [selected, setSelected] = useState('Last 7 days');
  return (
    <Fragment>
      <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={onClose} />
      <div
        className="card"
        style={{
          position: 'fixed',
          top: rect ? rect.bottom + 6 : 50,
          left: rect ? rect.left : 100,
          width: 220,
          padding: 4,
          zIndex: 71, boxShadow: 'var(--shadow-lg)',
        }}
      >
        {RANGES.map(r => (
          <div key={r} onClick={() => { setSelected(r); onClose(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
              fontSize: 12.5,
              background: r === selected ? 'var(--accent-soft)' : 'transparent',
              color: r === selected ? 'var(--accent)' : 'var(--fg)',
            }}
            onMouseEnter={(e) => { if (r !== selected) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={(e) => { if (r !== selected) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 12 }}>{r === selected && <Icons.Check />}</span>
            <span style={{ flex: 1 }}>{r}</span>
          </div>
        ))}
      </div>
    </Fragment>
  );
}

// ===========================================================================
// Confirm modal — generic, for destructive actions
// ===========================================================================
interface ConfirmModalProps extends ConfirmOptions {
  onClose: () => void;
}

function ConfirmModal({ title, body, danger, confirmLabel, onConfirm, onClose }: ConfirmModalProps) {
  return (
    <ModalShell onClose={onClose} width={440} height={'auto'} title={title}>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{body}</div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <span style={{ flex: 1 }} />
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm?.(); onClose(); }}>{confirmLabel || 'Confirm'}</Button>
      </ModalFooter>
    </ModalShell>
  );
}

// ===========================================================================
// Modal shell — generic frame
// ===========================================================================
interface ModalShellProps {
  children?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  headerAction?: ReactNode;
  width?: number;
  height?: number | 'auto';
  onClose: () => void;
}

function ModalShell({ children, title, subtitle, headerAction, width, height, onClose }: ModalShellProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
        zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: width || 520, maxWidth: '92vw',
          height: height === 'auto' ? 'auto' : (height || 540),
          maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {title && (
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>{subtitle}</div>}
            </div>
            {headerAction}
            <Button variant="ghost" className="icon-only" onClick={onClose}><Icons.X /></Button>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 18px 0' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

interface ModalFooterProps {
  children?: ReactNode;
}

function ModalFooter({ children }: ModalFooterProps) {
  return (
    <div style={{
      margin: '18px -18px 0', padding: '12px 18px',
      borderTop: '1px solid var(--border)', background: 'var(--bg-soft)',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>{children}</div>
  );
}

export { OverlayProvider, useOverlays };
