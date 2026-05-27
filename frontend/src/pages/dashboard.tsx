// ============================================================
// Dashboard — pipeline hero + structured sections on a 12-col grid:
// at-a-glance KPIs, what needs review, agents in flight, ingestion.
// ============================================================

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Icons } from '../components/icons';
import { Card, SectionHead, Badge, Button, Spark, SparkBars, HeatRow, PriDot, Skeleton, SkeletonList, ErrorState } from '../components/ui';
import type { Route } from '../types';
import { useDashboard } from '../api/hooks/useDashboard';
import type { ActivityItem, AgentRun } from '../data/mock';

const HEATMAP = [
  { lbl: 'App Store',       data: [38, 42, 51, 47, 62, 71, 58] },
  { lbl: 'Play Store',      data: [28, 31, 34, 29, 41, 38, 32] },
  { lbl: 'Reddit',          data: [4, 7, 12, 8, 9, 14, 22] },
  { lbl: 'X / Twitter',     data: [12, 18, 14, 16, 19, 21, 17] },
  { lbl: 'Intercom',        data: [9, 11, 14, 13, 12, 15, 18] },
  { lbl: 'Otter (cmp)',     data: [44, 41, 46, 43, 48, 52, 47] },
  { lbl: 'Fireflies (cmp)', data: [12, 14, 11, 13, 16, 14, 19] },
];

export function DashboardPage({ setRoute }: { setRoute: (r: Route) => void }) {
  const { data, isLoading, isError, error, refetch } = useDashboard();
  const PIPELINE = data?.data.pipeline ?? [];
  const CATEGORIES = data?.data.categories ?? [];
  const ACTIVITY = data?.data.activity ?? [];
  const PROPOSALS = data?.data.proposals ?? [];
  const AGENTS = data?.data.agents ?? [];

  if (isError) {
    return (
      <Card>
        <ErrorState message={error instanceof Error ? error.message : 'Failed to load dashboard.'} onRetry={() => refetch()} />
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Fragment>
        <div className="pipeline" style={{ marginBottom: 'var(--section-gap)' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="pipe-stage" key={i}>
              <Skeleton width="60%" height={12} />
              <div style={{ marginTop: 10 }}><Skeleton width="40%" height={20} /></div>
              <div style={{ marginTop: 10 }}><Skeleton width="100%" height={26} /></div>
            </div>
          ))}
        </div>
        <section className="section">
          <SectionHead eyebrow="Health" title="At a glance" />
          <div className="l-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card className="col-3" pad key={i}>
                <Skeleton width="70%" height={11} />
                <div style={{ marginTop: 10 }}><Skeleton width="50%" height={22} /></div>
                <div style={{ marginTop: 10 }}><Skeleton width="100%" height={32} /></div>
              </Card>
            ))}
          </div>
        </section>
        <section className="section">
          <SectionHead eyebrow="Decide" title="Awaiting your review" />
          <div className="l-grid">
            <Card className="col-7" title="Approval queue"><SkeletonList rows={5} /></Card>
            <Card className="col-5" title="Top categories"><SkeletonList rows={6} /></Card>
          </div>
        </section>
      </Fragment>
    );
  }

  return (
    <Fragment>
      {/* === Pipeline hero strip === */}
      <div className="pipeline" style={{ marginBottom: 'var(--section-gap)' }}>
        {PIPELINE.map((s, i) => (
          <div className="pipe-stage" key={s.num} onClick={() => {
            const routes: Route[] = ['dashboard', 'sources', 'processing', 'insights', 'agent', 'agent'];
            const r = routes[i] || 'dashboard';
            if (i > 0) setRoute(r);
          }} style={{ cursor: i > 0 ? 'pointer' : 'default' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="pipe-num mono">{s.num}</div>
              <div className="pipe-name">{s.name}</div>
              <span className={`pulse ${i < 5 ? '' : 'idle'}`} style={{ marginLeft: 'auto' }} />
            </div>
            <div className="pipe-val">
              <span>{s.value.toLocaleString()}</span>
              <span className="pipe-unit">{s.unit}</span>
            </div>
            <div className="pipe-sub">{s.sub}</div>
            <div style={{ marginTop: 6 }}>
              {i % 2 === 0 ? <Spark data={s.sparkData} h={26} w={140} /> : <SparkBars data={s.sparkData} h={26} w={140} />}
            </div>
            <div className="pipe-flow"><Icons.ChevRight /></div>
          </div>
        ))}
      </div>

      {/* === At a glance — KPIs === */}
      <section className="section">
        <SectionHead
          eyebrow="Health"
          title="At a glance"
          action={<span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>vs. previous 7 days</span>}
        />
        <div className="l-grid">
          <Kpi className="col-3" label="Coverage of feedback" value="87.2%" delta="+3.4pt" dir="up"   subData={[60, 64, 70, 68, 74, 80, 83, 85, 87]} subLabel="reviews mapped to repo modules" />
          <Kpi className="col-3" label="Avg time to PR"        value="11.2h" delta="−2.1h"  dir="up"   subData={[18, 19, 16, 14, 14, 13, 12, 12, 11]} subLabel="median, approved → PR opened" />
          <Kpi className="col-3" label="Approval rate"         value="63%"   delta="+8pt"   dir="up"   subData={[48, 52, 55, 51, 58, 60, 61, 62, 63]} subLabel="of generated proposals" />
          <Kpi className="col-3" label="Auto-Dev test pass"    value="92%"   delta="−1pt"   dir="down" subData={[94, 93, 95, 94, 93, 92, 94, 92, 92]} subLabel="green on first run" />
        </div>
      </section>

      {/* === Needs your attention — approval queue + categories === */}
      <section className="section">
        <SectionHead
          eyebrow="Decide"
          title="Awaiting your review"
          action={<Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} onClick={() => setRoute('insights')}>All proposals</Button>}
        />
        <div className="l-grid">
          <Card className="col-7" title="Approval queue" action={<Badge tone="accent" dot>11 pending</Badge>}>
            <div className="list">
              {PROPOSALS.filter(p => p.column === 'pending').slice(0, 5).map((p) => (
                <div key={p.id} className="list-row clickable">
                  <PriDot p={p.pri} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--fg-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }} className="mono">{p.id} · {p.impacted.toLocaleString()} users · {p.effort}</div>
                  </div>
                  <Button size="sm" variant="ghost">Open</Button>
                </div>
              ))}
            </div>
            <div className="list-foot">
              <Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} onClick={() => setRoute('insights')}>See all 11</Button>
            </div>
          </Card>

          <Card className="col-5" title="Top categories" action={<span className="t-caps">7 days</span>}>
            <div className="list">
              {CATEGORIES.slice(0, 6).map((c) => (
                <div key={c.name} className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>{c.name}</span>
                      <span className="badge subtle" style={{ marginLeft: 'auto', fontFamily: 'Geist Mono' }}>{c.count}</span>
                    </div>
                    <div style={{ marginTop: 6, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${c.share * 3}%`, height: '100%', background: 'var(--accent)' }} />
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: c.trend === 'up' ? 'var(--accent)' : c.trend === 'down' ? 'var(--good)' : 'var(--fg-muted)', minWidth: 40, textAlign: 'right' }}>
                    {c.trend === 'up' ? '▲' : c.trend === 'down' ? '▼' : '·'} {c.pct > 0 ? '+' : ''}{c.pct}%
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* === In flight — agents + activity === */}
      <section className="section">
        <SectionHead
          eyebrow="Auto-Dev"
          title="In flight"
          action={<Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} onClick={() => setRoute('agent')}>Open queue</Button>}
        />
        <div className="l-grid">
          <Card className="col-7" title="Agents working" action={<Badge tone="accent" subtle>{AGENTS.filter(a => a.status === 'running').length} running</Badge>}>
            <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {AGENTS.filter(a => a.status === 'running' || a.status === 'review-needed').slice(0, 4).map((a) => (
                <MiniAgentCard key={a.id} agent={a} onClick={() => setRoute('agent')} />
              ))}
            </div>
          </Card>

          <Card className="col-5" title="Activity" action={<Button variant="ghost" size="sm" leftIcon={<Icons.Filter />}>Filter</Button>}>
            <div className="list">
              {ACTIVITY.slice(0, 7).map((a, i) => <ActivityRow key={i} a={a} />)}
            </div>
            <div className="list-foot">
              <Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} onClick={() => setRoute('activity')}>Full activity log</Button>
            </div>
          </Card>
        </div>
      </section>

      {/* === Ingestion heatmap === */}
      <section className="section">
        <SectionHead
          eyebrow="Sources"
          title="Ingestion"
          action={<Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} onClick={() => setRoute('sources')}>Sources</Button>}
        />
        <div className="l-grid">
          <Card className="col-12">
            <div className="card-pad">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 48px' }}>
                {HEATMAP.map((r) => (
                  <div key={r.lbl} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 40px', gap: 12, alignItems: 'center', padding: '6px 0' }}>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{r.lbl}</div>
                    <HeatRow values={r.data} max={75} />
                    <div className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)', textAlign: 'right' }}>{r.data.reduce((a, b) => a + b, 0)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--fg-subtle)' }}>
                <span className="t-caps">Mon → Sun · per source · last 7 days</span>
                <span style={{ flex: 1 }} />
                <span>less</span>
                <HeatRow values={[10, 25, 45, 65, 75]} max={75} />
                <span>more</span>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </Fragment>
  );
}

// ----- Kpi tile ------------------------------------------------------------
interface KpiProps {
  label: string;
  value: string;
  delta: string;
  dir: 'up' | 'down';
  subData: number[];
  subLabel: string;
  className?: string;
}
function Kpi({ label, value, delta, dir, subData, subLabel, className }: KpiProps) {
  return (
    <Card className={className}>
      <div className="stat">
        <div className="stat-label">{label}</div>
        <div className="stat-value">
          <span>{value}</span>
          <span className={`stat-delta ${dir}`}>{dir === 'up' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}{delta}</span>
        </div>
        <div style={{ marginTop: 4 }}>
          <Spark data={subData} h={32} w={220} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{subLabel}</div>
      </div>
    </Card>
  );
}

// ----- Activity row --------------------------------------------------------
function ActivityRow({ a }: { a: ActivityItem }) {
  const ICO: { i: ReactNode; color: string } = ({
    agent_done:   { i: <Icons.Check />,    color: 'var(--good)' },
    agent_failed: { i: <Icons.AlertTri />, color: 'var(--danger)' },
    approved:     { i: <Icons.Check />,    color: 'var(--good)' },
    rejected:     { i: <Icons.X />,        color: 'var(--danger)' },
    insight:      { i: <Icons.Sparkles />, color: 'var(--purple)' },
    ingestion:    { i: <Icons.Inbox />,    color: 'var(--info)' },
    merged:       { i: <Icons.GitPull />,  color: 'var(--good)' },
  } as Record<string, { i: ReactNode; color: string }>)[a.kind] || { i: <Icons.Spark />, color: 'var(--fg-muted)' };
  return (
    <div className="list-row top" style={{ padding: '9px 16px' }}>
      <div style={{ width: 14, height: 14, color: ICO.color, marginTop: 2, flexShrink: 0 }}>{ICO.i}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.45 }}>{a.text}</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)', whiteSpace: 'nowrap', flexShrink: 0 }}>{a.at}</div>
    </div>
  );
}

// ----- Mini agent card -----------------------------------------------------
function MiniAgentCard({ agent, onClick }: { agent: AgentRun; onClick: () => void }) {
  const running = agent.status === 'running';
  return (
    <div className="card" style={{ padding: 12, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`pulse ${running ? '' : 'idle'}`} />
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>{agent.id} · #{agent.issue}</div>
        <Badge tone={running ? 'accent' : 'info'} subtle style={{ marginLeft: 'auto' }}>
          {running ? `${Math.round(agent.progress * 100)}%` : 'Review'}
        </Badge>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-strong)', margin: '6px 0 4px', lineHeight: 1.35 }}>{agent.title}</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>{agent.branch}</div>
      <div style={{ marginTop: 8 }}>
        <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${agent.progress * 100}%`, height: '100%', background: running ? 'var(--accent)' : 'var(--info)' }} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
        <Icons.Clock /> <span>{agent.started}</span>
        <span className="dot-divider">·</span>
        <span className="mono">{agent.eta}</span>
      </div>
    </div>
  );
}
