// ============================================================
// Auto-Dev Agents — compact summary cards + detail modal
// ============================================================
// Two-step model:
//   1. Summary cards (3 variants: timeline / terminal / compact)
//   2. Click card → rich detail modal (timeline + logs + diff + PR)

import { Fragment, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Icons } from '../components/icons';
import { Card, SectionHead, Badge, Button, Tabs, PriDot, SkeletonList, ErrorState, EmptyState } from '../components/ui';
import { useOverlays } from '../components/overlays';
import { useAgents } from '../api/hooks/useAgents';
import { type AgentRun, type TerminalLine } from '../data/mock';

type CardStyle = 'timeline' | 'terminal' | 'compact';
type AgentTab = 'active' | 'failed' | 'merged' | 'all';

export function AgentPage({ cardStyle }: { cardStyle: CardStyle }) {
  const [tab, setTab] = useState<AgentTab>('active');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useAgents();
  const AGENTS = data?.data.agents ?? [];
  const TERMINAL_LINES = data?.data.terminalLines ?? [];

  const counts = {
    active:    AGENTS.filter(a => a.status === 'running' || a.status === 'review-needed').length,
    failed:    AGENTS.filter(a => a.status === 'failed').length,
    merged:    AGENTS.filter(a => a.status === 'merged').length,
    all:       AGENTS.length,
  };
  const filtered = AGENTS.filter(a => {
    if (tab === 'active') return a.status === 'running' || a.status === 'review-needed';
    if (tab === 'failed') return a.status === 'failed';
    if (tab === 'merged') return a.status === 'merged';
    return true;
  });

  const openAgent = filtered.find(a => a.id === openId) || AGENTS.find(a => a.id === openId);

  return (
    <Fragment>
      {/* === Status overview === */}
      <section className="section">
        <SectionHead eyebrow="Overview" title="Agent status" />
        <div className="l-grid">
          {/* Row 1: 4 stat cards col-3 each */}
          <Card className="col-3" pad>
            <div className="t-caps">Agents running</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">4</div>
              <span className="badge accent dot" style={{ marginLeft: 'auto' }}>Live</span>
            </div>
          </Card>
          <Card className="col-3" pad>
            <div className="t-caps">Awaiting review</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--info)' }} className="mono">2</div>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>PRs open</span>
            </div>
          </Card>
          <Card className="col-3" pad>
            <div className="t-caps">Failed (24h)</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--danger)' }} className="mono">3</div>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>auto-retry × 1</span>
            </div>
          </Card>
          <Card className="col-3" pad>
            <div className="t-caps">Merged (30d)</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-accent">18</div>
              <span className="stat-delta up mono"><Icons.ArrowUp />+4</span>
            </div>
          </Card>
          {/* Row 2: skill card full-width */}
          <Card className="col-12" pad>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icons.Robot />
              <span style={{ fontSize: 12, fontWeight: 500 }}>Active skill</span>
              <Badge tone="purple" subtle style={{ marginLeft: 'auto' }}>claude-sonnet-4-6</Badge>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 8, lineHeight: 1.45 }}>
              Plans, edits, tests in sandbox. Stops at PR.<br />Concurrency: 4 · timeout 30 min.
            </div>
          </Card>
        </div>
      </section>

      {/* === Run queue === */}
      <section className="section">
        <SectionHead eyebrow="Queue" title="Agent runs" />
        <Tabs
          value={tab} onChange={(v: string) => setTab(v as AgentTab)}
          items={[
            { value: 'active', label: 'Active',   count: counts.active },
            { value: 'failed', label: 'Failed',   count: counts.failed },
            { value: 'merged', label: 'Merged',   count: counts.merged },
            { value: 'all',    label: 'All runs', count: counts.all    },
          ]}
        />
        {/* Cards grid — col-4 × 3 across */}
        {isError && (
          <Card>
            <ErrorState message={error instanceof Error ? error.message : 'Failed to load agent runs.'} onRetry={() => refetch()} />
          </Card>
        )}
        {!isError && isLoading && (
          <div className="l-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card className="col-4" key={i}><SkeletonList rows={2} /></Card>
            ))}
          </div>
        )}
        {!isError && !isLoading && filtered.length === 0 && (
          <Card><EmptyState icon={<Icons.Robot />} title="No agent runs here" body="No Auto-Dev runs match this filter yet." /></Card>
        )}
        {!isError && !isLoading && filtered.length > 0 && (
          <div className="l-grid">
            {filtered.map(a => (
              <div key={a.id} className="col-4">
                <SummaryCard a={a} variant={cardStyle} terminalLines={TERMINAL_LINES} onOpen={() => setOpenId(a.id)} />
              </div>
            ))}
          </div>
        )}
      </section>

      {openAgent && (
        <AgentDetailModal a={openAgent} terminalLines={TERMINAL_LINES} onClose={() => setOpenId(null)} />
      )}
    </Fragment>
  );
}

// ===========================================================================
// Summary card — compact, 3 variants
// ===========================================================================
interface SummaryCardProps {
  a: AgentRun;
  variant: CardStyle;
  terminalLines: TerminalLine[];
  onOpen: () => void;
}
function SummaryCard({ a, variant, terminalLines, onOpen }: SummaryCardProps) {
  const running = a.status === 'running';
  const failed = a.status === 'failed';
  const review = a.status === 'review-needed';
  const merged = a.status === 'merged';

  const accent =
    running ? 'var(--accent)' :
    review  ? 'var(--info)' :
    failed  ? 'var(--danger)' :
    'var(--fg-faint)';

  const currentStep = a.steps.find(s => s.state === 'active') || a.steps.filter(s => s.state === 'done').slice(-1)[0];
  const doneCount = a.steps.filter(s => s.state === 'done').length;

  return (
    <div
      onClick={onOpen}
      className="card"
      style={{
        cursor: 'pointer',
        borderColor: running || review ? accent : 'var(--border)',
        boxShadow: running ? '0 0 0 1px var(--accent-soft)' : 'none',
        display: 'flex', flexDirection: 'column',
        minHeight: variant === 'compact' ? 'auto' : 160,
        transition: 'border-color .12s, transform .12s',
      }}
    >
      {/* Header — status + title + meta */}
      <div style={{ padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className={`pulse ${running ? '' : failed ? 'danger' : 'idle'}`} />
          <StatusBadge status={a.status} />
          <span style={{ flex: 1 }} />
          {a.diff && (
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>
              <span style={{ color: 'var(--accent)' }}>+{a.diff.added}</span>{' '}
              <span style={{ color: 'var(--danger)' }}>−{a.diff.removed}</span>{' '}
              <span>· {a.diff.files}f</span>
            </span>
          )}
        </div>

        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--fg-strong)',
          lineHeight: 1.35, letterSpacing: '-0.005em',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          minHeight: variant === 'compact' ? 'auto' : 36,
        }}>
          {a.title}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)' }} className="mono">
          <span>{a.id}</span>
          <span className="dot-divider">·</span>
          <span>#{a.issue}</span>
          <span className="dot-divider">·</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.branch}</span>
        </div>
      </div>

      {/* Variant-specific middle slot */}
      {variant === 'timeline' && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
            {a.steps.map((s, i) => (
              <div key={i} title={s.label}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: s.state === 'done' ? 'var(--accent)'
                            : s.state === 'active' ? accent
                            : s.state === 'failed' ? 'var(--danger)'
                            : 'var(--surface-2)',
                  opacity: s.state === 'active' ? 0.85 : 1,
                  animation: s.state === 'active' ? 'pulse 1.5s ease-in-out infinite' : 'none',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)' }}>
            {failed
              ? <span style={{ color: 'var(--danger)' }}>Failed at step {a.failedAt} · <span style={{ color: 'var(--fg)' }}>{a.steps[(a.failedAt ?? 1) - 1]?.label}</span></span>
              : merged
              ? <span style={{ color: 'var(--accent)' }}>All {a.steps.length} steps complete</span>
              : <span>Step {doneCount + (running ? 1 : 0)}/{a.steps.length} · <span style={{ color: 'var(--fg)' }}>{currentStep?.label}</span></span>
            }
          </div>
        </div>
      )}

      {variant === 'terminal' && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{
            background: '#050608', borderRadius: 4, padding: '7px 9px',
            fontFamily: 'Geist Mono', fontSize: 10.5, lineHeight: 1.45,
            color: '#9aa0aa',
          }}>
            {terminalLines.slice(running ? 9 : failed ? 6 : 11, running ? 13 : failed ? 8 : 13).map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ color: '#525252', flexShrink: 0 }}>{l.t.slice(-5)}</span>
                <span style={{ color: failed && i > 0 ? 'var(--danger)' : 'var(--accent)', flexShrink: 0 }}>[{l.tag}]</span>
                <span style={{ color: '#c4c4c4', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.msg}</span>
              </div>
            ))}
            {running && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ color: '#525252' }}>:38:24</span>
                <span style={{ color: 'var(--accent)' }}>[test]</span>
                <span style={{ color: '#c4c4c4' }}>Running... <span style={{ color: 'var(--accent)' }}>▌</span></span>
              </div>
            )}
            {failed && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ color: '#525252' }}>:38:55</span>
                <span style={{ color: 'var(--danger)' }}>[err]</span>
                <span style={{ color: '#f87171' }}>1/22 tests failed</span>
              </div>
            )}
          </div>
        </div>
      )}

      {variant === 'compact' && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{
            height: 4, background: 'var(--surface-2)', borderRadius: 2,
            overflow: 'hidden', position: 'relative',
          }}>
            <div style={{
              width: `${a.progress * 100}%`, height: '100%',
              background: accent,
              transition: 'width .3s',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, color: 'var(--fg-muted)' }}>
            <span>{doneCount}/{a.steps.length} steps</span>
            <span className="mono">{Math.round(a.progress * 100)}%</span>
          </div>
        </div>
      )}

      {/* Footer — time / eta + primary status hint */}
      <div style={{
        padding: '8px 14px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-soft)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Icons.Clock />
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{a.started}</span>
        <span className="dot-divider">·</span>
        <span className="mono" style={{ fontSize: 11, color: review || merged ? 'var(--accent)' : failed ? 'var(--danger)' : 'var(--fg)' }}>{a.eta}</span>
        <span style={{ flex: 1 }} />
        {review && <Badge tone="accent" subtle style={{ fontSize: 10 }}><Icons.GitPull />#{a.pr?.number}</Badge>}
        {failed && <Badge tone="danger" subtle style={{ fontSize: 10 }}><Icons.AlertTri />Action needed</Badge>}
        <Icons.ChevRight />
      </div>
    </div>
  );
}

// ===========================================================================
// Detail modal — full timeline + tabbed body + actions
// ===========================================================================
type ModalTab = 'overview' | 'logs' | 'diff' | 'pr';

interface AgentDetailModalProps {
  a: AgentRun;
  terminalLines: TerminalLine[];
  onClose: () => void;
}
function AgentDetailModal({ a, terminalLines, onClose }: AgentDetailModalProps) {
  const overlays = useOverlays();
  const [tab, setTab] = useState<ModalTab>(
    a.status === 'failed' ? 'logs'
    : a.status === 'review-needed' ? 'pr'
    : a.status === 'merged' ? 'pr'
    : 'overview'
  );
  const running = a.status === 'running';
  const failed = a.status === 'failed';
  const review = a.status === 'review-needed';
  const merged = a.status === 'merged';

  // Close on escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
        zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: 1040, maxWidth: '100%',
          height: 680, maxHeight: '100%',
          display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className={`pulse ${running ? '' : failed ? 'danger' : 'idle'}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-strong)', letterSpacing: '-0.015em' }}>{a.title}</span>
              <StatusBadge status={a.status} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 11.5, color: 'var(--fg-muted)' }} className="mono">
              <span>{a.id}</span>
              <span className="dot-divider">·</span>
              <span>#{a.issue}</span>
              <span className="dot-divider">·</span>
              <span>{a.branch}</span>
              <span className="dot-divider">·</span>
              <span>from {a.proposal}</span>
            </div>
          </div>
          <Button variant="ghost" leftIcon={<Icons.External />}>GitHub</Button>
          <Button variant="ghost" className="icon-only" onClick={onClose}><Icons.X /></Button>
        </div>

        {/* Body: 2-column */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr', overflow: 'hidden' }}>
          {/* Left: timeline + meta */}
          <div style={{ borderRight: '1px solid var(--border)', overflow: 'auto', padding: '16px 0', background: 'var(--bg-soft)' }}>
            <div style={{ padding: '0 18px 12px' }}>
              <div className="t-caps" style={{ marginBottom: 4 }}>Progress</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--fg-strong)' }} className="mono">{Math.round(a.progress * 100)}%</div>
                <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
                  {a.steps.filter(s => s.state === 'done').length} / {a.steps.length} steps
                </span>
              </div>
            </div>

            <div className="steps" style={{ padding: '0 8px' }}>
              {a.steps.map((s, i) => (
                <div key={i} className={`step ${s.state}`} style={{ padding: '10px 14px' }}>
                  <div className="step-marker">
                    <div className="dot">
                      {s.state === 'done' && <Icons.Check />}
                      {s.state === 'failed' && <Icons.X />}
                      {(s.state === 'idle' || s.state === 'active') && i + 1}
                    </div>
                    <div className="bar" />
                  </div>
                  <div className="step-body">
                    <div className="label">{s.label}</div>
                    {s.desc && <div className="desc">{s.desc}</div>}
                  </div>
                  {s.t && <div className="step-time mono">{s.t}</div>}
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0', padding: '12px 18px 0' }}>
              <div className="t-caps" style={{ marginBottom: 8 }}>Metadata</div>
              <ModalMeta k="Skill"    v={<Badge tone="purple" subtle><Icons.Sparkles />{a.skill}</Badge>} />
              <ModalMeta k="Started"  v={a.started} />
              <ModalMeta k="ETA / state" v={a.eta} mono />
              {a.diff && <ModalMeta k="Diff" v={<span className="mono"><span style={{ color: 'var(--accent)' }}>+{a.diff.added}</span> <span style={{ color: 'var(--danger)' }}>−{a.diff.removed}</span> · {a.diff.files} files</span>} />}
              {a.pr && <ModalMeta k="Pull request" v={<span className="mono">#{a.pr.number}</span>} />}
            </div>
          </div>

          {/* Right: tabbed body */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '0 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 0 }}>
              {([
                { v: 'overview', l: 'Overview' },
                { v: 'logs',     l: 'Logs' },
                { v: 'diff',     l: 'Diff', count: a.diff?.files },
                { v: 'pr',       l: a.pr?.merged ? 'Merged PR' : a.pr ? 'PR' : 'Result' },
              ] as { v: ModalTab; l: string; count?: number }[]).map(t => (
                <div key={t.v}
                  onClick={() => setTab(t.v)}
                  className={`tab ${tab === t.v ? 'active' : ''}`}
                  style={{ marginBottom: -1 }}
                >
                  {t.l}
                  {t.count != null && <span className="tab-count">{t.count}</span>}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
              {tab === 'overview' && <TabOverview a={a} />}
              {tab === 'logs'     && <TabLogs a={a} terminalLines={terminalLines} />}
              {tab === 'diff'     && <TabDiff a={a} />}
              {tab === 'pr'       && <TabPR a={a} />}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--bg-soft)' }}>
          {running && (
            <Fragment>
              <Button variant="ghost" leftIcon={<Icons.Pause />} onClick={() => { overlays.toast({ title: 'Agent paused', body: `${a.id} will finish current step then halt`, icon: <Icons.Pause /> }); onClose(); }}>Pause agent</Button>
              <Button variant="ghost" leftIcon={<Icons.X />} onClick={() => overlays.confirm({
                title: 'Cancel agent run?',
                body: `${a.id} will stop immediately. Branch ${a.branch} and any uncommitted work will remain. You can re-dispatch from the proposal.`,
                danger: true, confirmLabel: 'Cancel run',
                onConfirm: () => { overlays.toast({ title: 'Run cancelled', body: `${a.id} stopped · branch preserved` }); onClose(); },
              })}>Cancel run</Button>
            </Fragment>
          )}
          {failed && (
            <Fragment>
              <Button variant="primary" leftIcon={<Icons.Refresh />} onClick={() => { overlays.toast({ title: 'Retrying from failed step', body: `${a.id} · step ${a.failedAt} · eta ~5 min`, icon: <Icons.Refresh /> }); onClose(); }}>Retry from failed step</Button>
              <Button variant="ghost" leftIcon={<Icons.Pencil />} onClick={() => overlays.toast({ title: 'Plan editor', body: 'Opening agent plan for revision', icon: <Icons.Pencil /> })}>Edit plan & retry</Button>
              <Button variant="ghost" leftIcon={<Icons.X />} onClick={() => { overlays.toast({ title: 'Marked resolved', body: `${a.id} archived from the queue` }); onClose(); }}>Mark resolved</Button>
            </Fragment>
          )}
          {review && (
            <Fragment>
              <Button variant="primary" leftIcon={<Icons.External />} onClick={() => overlays.toast({ title: 'Opening PR', body: `loop/loop-app#${a.pr?.number}`, icon: <Icons.Github /> })}>Open PR #{a.pr?.number}</Button>
              <Button variant="ghost" leftIcon={<Icons.Eye />} onClick={() => setTab('diff')}>Review diff</Button>
              <Button variant="ghost" leftIcon={<Icons.Slack />} onClick={() => overlays.toast({ title: 'Posted to Slack', body: `#selfheal-review notified — PR #${a.pr?.number} ready for review`, icon: <Icons.Slack /> })}>Notify Slack</Button>
            </Fragment>
          )}
          {merged && (
            <Button variant="ghost" leftIcon={<Icons.External />} onClick={() => overlays.toast({ title: 'Opening PR', body: `loop/loop-app#${a.pr?.number} · merged`, icon: <Icons.GitPull /> })}>Open merged PR #{a.pr?.number}</Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>Close <span className="kbd">esc</span></Button>
        </div>
      </div>
    </div>
  );
}

interface ModalMetaProps {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
}
function ModalMeta({ k, v, mono }: ModalMetaProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8, padding: '4px 0' }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{k}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{v}</div>
    </div>
  );
}

// ===========================================================================
// Tabs inside the modal
// ===========================================================================
interface TabProps {
  a: AgentRun;
}
function TabOverview({ a }: TabProps) {
  return (
    <Fragment>
      <div style={{ marginBottom: 16 }}>
        <div className="t-caps" style={{ marginBottom: 6 }}>From proposal</div>
        <div style={{
          padding: 12, background: 'var(--bg-soft)', borderRadius: 6,
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PriDot p={0} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{a.proposal}</span>
            <Badge subtle style={{ marginLeft: 'auto' }}>{a.title.length > 50 ? 'Detailed' : 'Standard'}</Badge>
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-strong)', marginTop: 6, fontWeight: 500 }}>{a.title}</div>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6, lineHeight: 1.5 }}>
            Generated from review cluster · grounded in {Math.round(a.progress * 60 + 12)} similar reviews from the last 7 days.
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="t-caps" style={{ marginBottom: 6 }}>Plan</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.7 }}>
          <li>Parse linked reviews & reproduce conditions (iPadOS 17.4, split-view, rotation mid-record).</li>
          <li>Rank root causes by likelihood. Top: <code className="mono">AudioSession</code> invalidation during UIKit resize.</li>
          <li>Hold AudioSession across <code className="mono">viewWillTransitionToSize</code> by deferring UIKit resize.</li>
          <li>Add unit + UI tests covering rotation during active recording.</li>
          <li>Run full mobile suite. Open PR on green.</li>
        </ol>
      </div>

      <div>
        <div className="t-caps" style={{ marginBottom: 6 }}>Files touched</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[
            ['mobile/ipad/AudioSessionCoordinator.swift', '+82', '−24'],
            ['mobile/ipad/RecordingViewController.swift', '+33', '−14'],
            ['mobile/ipad/AudioSessionCoordinatorTests.swift', '+12', '0'],
            ['mobile/shared/AVAudioSessionExtensions.swift', '0', '0'],
          ].slice(0, a.diff?.files || 0).map(([f, add, rem]) => (
            <div key={f} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '6px 10px', background: 'var(--bg-soft)', borderRadius: 4 }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--fg)' }}>{f}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{add}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--danger)' }}>{rem}</span>
            </div>
          ))}
        </div>
      </div>
    </Fragment>
  );
}

function TabLogs({ a, terminalLines }: TabProps & { terminalLines: TerminalLine[] }) {
  const failed = a.status === 'failed';
  const lines = terminalLines.slice(0, failed ? 12 : 13);
  return (
    <div className="terminal" style={{ maxHeight: 'none', borderRadius: 6 }}>
      {lines.map((l, i) => (
        <div className="ln" key={i}>
          <span className="ts">{l.t}</span>
          <span className={`tag ${failed && i === lines.length - 1 ? 'err' : ''}`}>[{l.tag}]</span>
          <span className={`msg ${l.strong ? 'strong' : ''}`}>{l.msg}</span>
        </div>
      ))}
      {failed && (
        <Fragment>
          <div className="ln">
            <span className="ts">14:38:55</span>
            <span className="tag err">[test]</span>
            <span className="msg" style={{ color: 'var(--danger)' }}>FAIL integrations/notion/sync_test.ts:128</span>
          </div>
          <div className="ln">
            <span className="ts">14:38:55</span>
            <span className="tag err">[err]</span>
            <span className="msg">  Expected page permissions to resolve in &lt;200ms (got 312ms)</span>
          </div>
          <div className="ln">
            <span className="ts">14:38:55</span>
            <span className="tag err">[err]</span>
            <span className="msg">  at NotionSync.respectsPermissions (sync.ts:482)</span>
          </div>
          <div className="ln">
            <span className="ts">14:38:55</span>
            <span className="tag err">[err]</span>
            <span className="msg">  Hypothesis: flaky timing — passes locally, fails in CI 1/22 runs</span>
          </div>
        </Fragment>
      )}
      {a.status === 'running' && (
        <div className="ln">
          <span className="ts">14:38:24</span>
          <span className="tag">[test]</span>
          <span className="msg">Running suite <span style={{ color: 'var(--accent)' }}>▌</span></span>
        </div>
      )}
    </div>
  );
}

function TabDiff({ a }: TabProps) {
  const sample: { line: number; type: 'ctx' | 'rem' | 'add'; text: string }[] = [
    { line: 1,   type: 'ctx',  text: '// AudioSessionCoordinator.swift' },
    { line: 2,   type: 'ctx',  text: '' },
    { line: 3,   type: 'ctx',  text: 'class AudioSessionCoordinator {' },
    { line: 12,  type: 'rem',  text: '  func handleRotation(to size: CGSize) {' },
    { line: 13,  type: 'rem',  text: '    audioSession.invalidate()' },
    { line: 14,  type: 'rem',  text: '    UIView.animate(withDuration: 0.3) {' },
    { line: 12,  type: 'add',  text: '  func handleRotation(to size: CGSize) {' },
    { line: 13,  type: 'add',  text: '    // Hold session across resize — fixes #1847' },
    { line: 14,  type: 'add',  text: '    audioSession.holdAcrossTransition()' },
    { line: 15,  type: 'add',  text: '    UIView.animate(withDuration: 0.3) {' },
    { line: 16,  type: 'ctx',  text: '      // ... resize chrome' },
    { line: 17,  type: 'ctx',  text: '    } completion: { _ in' },
    { line: 18,  type: 'add',  text: '      self.audioSession.releaseHold()' },
    { line: 19,  type: 'ctx',  text: '    }' },
    { line: 20,  type: 'ctx',  text: '  }' },
  ];
  return (
    <Fragment>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Badge subtle><Icons.Code /><span className="mono">AudioSessionCoordinator.swift</span></Badge>
        <span style={{ flex: 1 }} />
        <Badge subtle><span className="mono" style={{ color: 'var(--accent)' }}>+82</span></Badge>
        <Badge subtle><span className="mono" style={{ color: 'var(--danger)' }}>−24</span></Badge>
      </div>
      <div style={{
        background: 'var(--bg-soft)', border: '1px solid var(--border)',
        borderRadius: 6, overflow: 'hidden', fontFamily: 'Geist Mono', fontSize: 11.5, lineHeight: 1.6,
      }}>
        {sample.map((row, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr',
            background: row.type === 'add' ? 'var(--good-soft)'
                      : row.type === 'rem' ? 'var(--danger-soft)'
                      : 'transparent',
            color: row.type === 'add' ? 'var(--fg-strong)'
                 : row.type === 'rem' ? 'var(--fg-muted)'
                 : 'var(--fg-muted)',
          }}>
            <div style={{
              padding: '0 8px', textAlign: 'right',
              color: 'var(--fg-subtle)',
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-soft)',
            }}>
              <span style={{ marginRight: 4 }}>{row.type === 'add' ? '+' : row.type === 'rem' ? '−' : ' '}</span>
              {row.line}
            </div>
            <div style={{ padding: '0 12px', whiteSpace: 'pre' }}>{row.text}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--fg-subtle)' }}>
        Showing 1 of {a.diff?.files || 4} files. <Button size="sm" variant="ghost" leftIcon={<Icons.External />}>View full diff in GitHub</Button>
      </div>
    </Fragment>
  );
}

function TabPR({ a }: TabProps) {
  if (!a.pr && a.status !== 'failed') {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 12.5 }}>
        Agent is still working. PR will appear here once opened.
      </div>
    );
  }
  if (a.status === 'failed') {
    return (
      <div>
        <div style={{
          padding: 14, background: 'var(--danger-soft)', border: '1px solid var(--danger)',
          borderRadius: 6, marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Icons.AlertTri />
            <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>Run failed before PR was opened</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.55 }}>{a.error}</div>
        </div>
        <div className="t-caps" style={{ marginBottom: 6 }}>Suggested actions</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.7 }}>
          <li><strong>Retry from failed step</strong> — flaky timing assertions sometimes resolve on re-run.</li>
          <li><strong>Edit plan</strong> — adjust the test expectation or skip the flaky test.</li>
          <li><strong>Mark resolved</strong> — close the run without merging.</li>
        </ul>
      </div>
    );
  }
  const pr = a.pr!;
  return (
    <Fragment>
      <div style={{
        padding: 14, background: pr.merged ? 'var(--accent-soft)' : 'var(--info-soft)',
        border: `1px solid ${pr.merged ? 'var(--accent)' : 'var(--info)'}`,
        borderRadius: 6, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icons.GitPull />
          <span style={{ fontSize: 13, fontWeight: 500, color: pr.merged ? 'var(--accent)' : 'var(--info)' }}>
            {pr.merged ? `Merged · PR #${pr.number}` : `Open · PR #${pr.number}`}
          </span>
          <span style={{ flex: 1 }} />
          <Badge tone={pr.merged ? 'good' : 'info'} subtle><Icons.Check />{pr.passing}/{pr.checks} checks</Badge>
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-strong)', marginTop: 8, fontWeight: 500 }}>{pr.title}</div>
      </div>

      <div className="t-caps" style={{ marginBottom: 6 }}>PR description</div>
      <div style={{
        padding: 14, background: 'var(--bg-soft)', borderRadius: 6, border: '1px solid var(--border)',
        fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.6, marginBottom: 14,
      }}>
        <div style={{ marginBottom: 8 }}><strong>What changed</strong></div>
        <div style={{ marginBottom: 12, color: 'var(--fg-muted)' }}>Holds the AudioSession across UIKit resize on iPad rotation, fixing the hard crash reported in 47 reviews this week.</div>
        <div style={{ marginBottom: 8 }}><strong>Linked</strong></div>
        <div style={{ marginBottom: 12, color: 'var(--fg-muted)' }} className="mono">
          Issue #{a.issue} · Proposal {a.proposal} · Cluster cluster_92
        </div>
        <div style={{ marginBottom: 8 }}><strong>Test plan</strong></div>
        <div style={{ color: 'var(--fg-muted)' }}>Reproduced original crash on iPad Pro 13" / iPadOS 17.4. Added unit tests for rotation during active recording. Manual verification on 3 device sizes.</div>
      </div>

      <div className="t-caps" style={{ marginBottom: 6 }}>Checks ({pr.passing}/{pr.checks})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          ['unit-tests',         'AudioSessionCoordinatorTests · 8 / 8 passed', 'pass'],
          ['ios-build',          'xcodebuild · 1m 24s',                          'pass'],
          ['ipad-build',         'xcodebuild iPad scheme · 47s',                 'pass'],
          ['lint',               'SwiftLint · 0 warnings',                       'pass'],
          ['integration-tests',  'Mobile integration · 24 / 24',                 'pass'],
          ['screenshot-tests',   'Snapshot tests · 188 / 188',                   'pass'],
          ['coverage',           '83.4% on changed files (+2.1pt)',              'pass'],
          ['security-scan',      'Snyk · 0 new vulnerabilities',                 'pass'],
        ].map(([name, msg, _]) => (
          <div key={name} style={{ display: 'grid', gridTemplateColumns: '20px 200px 1fr', gap: 10, alignItems: 'center', padding: '4px 0' }}>
            <span style={{ color: 'var(--accent)' }}><Icons.Check /></span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--fg-strong)' }}>{name}</span>
            <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{msg}</span>
          </div>
        ))}
      </div>
    </Fragment>
  );
}

// ----- Status badge --------------------------------------------------------
function StatusBadge({ status }: { status: AgentRun['status'] }) {
  if (status === 'running')        return <Badge tone="accent" dot>Running</Badge>;
  if (status === 'review-needed')  return <Badge tone="info" dot>Review</Badge>;
  if (status === 'failed')         return <Badge tone="danger" dot>Failed</Badge>;
  if (status === 'merged')         return <Badge tone="good" subtle><Icons.Check />Merged</Badge>;
  return <Badge subtle>Idle</Badge>;
}
