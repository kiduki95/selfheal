// ============================================================
// Dashboard — pipeline hero, top KPIs, category breakdown,
// recent activity, queue snapshot, agent strip
// ============================================================

function DashboardPage({ setRoute }) {
  return (
    <Fragment>
      {/* === Pipeline hero strip === */}
      <div className="pipeline" style={{ marginBottom: 18 }}>
        {PIPELINE.map((s, i) => (
          <div className="pipe-stage" key={s.num} onClick={() => {
            const r = ['dashboard','sources','processing','insights','agent','agent'][i] || 'dashboard';
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

      {/* === Row: KPIs + sparklines === */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        <Kpi label="Coverage of feedback"          value="87.2%" delta="+3.4pt" dir="up"   subData={[60, 64, 70, 68, 74, 80, 83, 85, 87]} subLabel="reviews mapped to repo modules" />
        <Kpi label="Avg time to PR"                value="11.2h" delta="−2.1h"  dir="up"   subData={[18, 19, 16, 14, 14, 13, 12, 12, 11]} subLabel="median, approved → PR opened" />
        <Kpi label="Approval rate"                 value="63%"   delta="+8pt"   dir="up"   subData={[48, 52, 55, 51, 58, 60, 61, 62, 63]} subLabel="of generated proposals" />
        <Kpi label="Auto-Dev test pass"            value="92%"   delta="−1pt"   dir="down" subData={[94, 93, 95, 94, 93, 92, 94, 92, 92]} subLabel="green on first run" />
      </div>

      {/* === Row: queues + activity === */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 14, marginBottom: 18 }}>
        <Card title="Top categories (7d)" action={<Button variant="ghost" size="sm" rightIcon={<Icons.ChevRight />}>Open</Button>}>
          <div style={{ padding: '4px 0 4px' }}>
            {CATEGORIES.slice(0, 6).map((c) => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>{c.name}</span>
                    <span className="badge subtle" style={{ marginLeft: 'auto', fontFamily: 'Geist Mono' }}>{c.count}</span>
                  </div>
                  <div style={{ marginTop: 5, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${c.share * 3}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 11, color: c.trend === 'up' ? 'var(--accent)' : c.trend === 'down' ? 'var(--danger)' : 'var(--fg-muted)', minWidth: 36, textAlign: 'right' }}>
                  {c.trend === 'up' ? '▲' : c.trend === 'down' ? '▼' : '·'} {c.pct > 0 ? '+' : ''}{c.pct}%
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Approval queue" action={<Badge tone="accent" dot>11 pending</Badge>}>
          <div>
            {PROPOSALS.filter(p => p.column === 'pending').slice(0, 4).map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                <PriDot p={p.pri} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--fg-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }} className="mono">{p.id} · {p.impacted.toLocaleString()} users · {p.effort}</div>
                </div>
                <Button size="sm" variant="ghost">Open</Button>
              </div>
            ))}
            <div style={{ padding: 10, display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} onClick={() => setRoute('insights')}>See all 11</Button>
            </div>
          </div>
        </Card>

        <Card title="Activity" action={<Button variant="ghost" size="sm" leftIcon={<Icons.Filter />}>Filter</Button>}>
          <div>
            {ACTIVITY.slice(0, 8).map((a, i) => <ActivityRow key={i} a={a} />)}
          </div>
        </Card>
      </div>

      {/* === Row: agent strip + heatmap === */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
        <Card
          title="Auto-Dev — agents in flight"
          action={<Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} onClick={() => setRoute('agent')}>Open queue</Button>}
        >
          <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {AGENTS.filter(a => a.status === 'running' || a.status === 'review-needed').map((a) => (
              <MiniAgentCard key={a.id} agent={a} onClick={() => setRoute('agent')} />
            ))}
          </div>
        </Card>

        <Card title="Ingestion heatmap (last 7d × source)" action={<Button variant="ghost" size="sm" rightIcon={<Icons.ChevRight />}>Sources</Button>}>
          <div style={{ padding: 14 }}>
            {[
              { lbl: 'App Store',  data: [38, 42, 51, 47, 62, 71, 58] },
              { lbl: 'Play Store', data: [28, 31, 34, 29, 41, 38, 32] },
              { lbl: 'Reddit',     data: [4, 7, 12, 8, 9, 14, 22] },
              { lbl: 'X / Twitter',data: [12, 18, 14, 16, 19, 21, 17] },
              { lbl: 'Intercom',   data: [9, 11, 14, 13, 12, 15, 18] },
              { lbl: 'Otter (cmp)',data: [44, 41, 46, 43, 48, 52, 47] },
              { lbl: 'Fireflies (cmp)',data: [12, 14, 11, 13, 16, 14, 19] },
            ].map((r) => (
              <div key={r.lbl} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 36px', gap: 12, alignItems: 'center', padding: '4px 0' }}>
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{r.lbl}</div>
                <HeatRow values={r.data} max={75} />
                <div className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)', textAlign: 'right' }}>{r.data.reduce((a,b)=>a+b,0)}</div>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--fg-subtle)' }}>
              <span>Mon</span><span style={{ flex: 1 }}/><span>Wed</span><span style={{ flex: 1 }}/><span>Fri</span><span style={{ flex: 1 }}/><span>Sun</span>
            </div>
          </div>
        </Card>
      </div>
    </Fragment>
  );
}

// ----- Kpi tile ------------------------------------------------------------
function Kpi({ label, value, delta, dir, subData, subLabel }) {
  return (
    <Card>
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
function ActivityRow({ a }) {
  const ICO = {
    agent_done:   { i: <Icons.Check />,    color: 'var(--accent)' },
    agent_failed: { i: <Icons.AlertTri />, color: 'var(--danger)' },
    approved:     { i: <Icons.Check />,    color: 'var(--accent)' },
    rejected:     { i: <Icons.X />,        color: 'var(--danger)' },
    insight:      { i: <Icons.Sparkles />, color: 'var(--purple)' },
    ingestion:    { i: <Icons.Inbox />,    color: 'var(--info)' },
    merged:       { i: <Icons.GitPull />,  color: 'var(--accent)' },
  }[a.kind] || { i: <Icons.Spark />, color: 'var(--fg-muted)' };
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 16px', alignItems: 'flex-start', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 14, height: 14, color: ICO.color, marginTop: 2, flexShrink: 0 }}>{ICO.i}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.45 }}>{a.text}</div>
      <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)', whiteSpace: 'nowrap', flexShrink: 0 }}>{a.at}</div>
    </div>
  );
}

// ----- Mini agent card -----------------------------------------------------
function MiniAgentCard({ agent, onClick }) {
  const running = agent.status === 'running';
  const review = agent.status === 'review-needed';
  return (
    <div className="card" style={{ padding: 12, cursor: 'pointer' }} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`pulse ${running ? '' : 'idle'}`} />
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>{agent.id} · #{agent.issue}</div>
        <Badge tone={running ? 'accent' : 'info'} subtle style={{ marginLeft: 'auto' }}>
          {running ? `${Math.round(agent.progress*100)}%` : 'Review'}
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

window.DashboardPage = DashboardPage;
