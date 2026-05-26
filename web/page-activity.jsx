// ============================================================
// Activity log — full audit timeline
// ============================================================

function ActivityPage() {
  const [filters, setFilters] = useState({ actorKind: 'all', type: 'all' });
  const [openId, setOpenId] = useState(null);

  const filtered = AUDIT_EVENTS.filter(e => {
    if (filters.actorKind !== 'all' && e.actorKind !== filters.actorKind) return false;
    if (filters.type !== 'all' && e.type !== filters.type) return false;
    return true;
  });

  // Group by day
  const grouped = filtered.reduce((acc, e) => {
    (acc[e.day] = acc[e.day] || []).push(e);
    return acc;
  }, {});

  // Hourly buckets for heatmap (today)
  const hourBuckets = Array.from({ length: 24 }, (_, h) => Math.floor(Math.random() * 8 + (h > 8 && h < 19 ? 6 : 1)));

  return (
    <Fragment>
      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 1.6fr', gap: 14, marginBottom: 14 }}>
        <Card pad>
          <div className="t-caps">Events · today</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">142</div>
            <span className="stat-delta up mono"><Icons.ArrowUp />+18</span>
          </div>
          <div style={{ marginTop: 6 }}><Spark data={[4, 12, 8, 14, 22, 18, 24]} h={22} w={180} /></div>
        </Card>
        <Card pad>
          <div className="t-caps">Human approvals</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-accent">8</div>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>3 rejections</span>
          </div>
        </Card>
        <Card pad>
          <div className="t-caps">Agent runs</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">14</div>
            <span style={{ fontSize: 11, color: 'var(--danger)' }}>1 failed</span>
          </div>
        </Card>
        <Card pad>
          <div className="t-caps">Settings changes</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">3</div>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>by Maya, Daniel</span>
          </div>
        </Card>
        <Card pad>
          <div className="t-caps">Activity by hour · today</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginTop: 8, height: 40 }}>
            {hourBuckets.map((v, i) => {
              const max = Math.max(...hourBuckets);
              return (
                <div key={i} title={`${i}:00 · ${v} events`}
                  style={{
                    flex: 1,
                    height: `${(v / max) * 100}%`,
                    background: i === 14 ? 'var(--accent)' : 'var(--accent-soft)',
                    borderRadius: 1,
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--fg-subtle)', marginTop: 4 }} className="mono">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
        </Card>
      </div>

      {/* Filter bar */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterChip label="Actor" value={filters.actorKind} options={[
            ['all', 'All'], ['human', 'Humans'], ['agent', 'Agents'], ['system', 'System'],
          ]} onChange={(v) => setFilters({ ...filters, actorKind: v })} />
          <FilterChip label="Type" value={filters.type} options={[
            ['all', 'All event types'],
            ['approval', 'Approval'],
            ['reject', 'Rejection'],
            ['insight', 'Insight'],
            ['agent_step', 'Agent step'],
            ['agent_failed', 'Agent failed'],
            ['agent_done', 'Agent done'],
            ['merge', 'Merge'],
            ['ingestion', 'Ingestion'],
            ['cluster', 'Cluster'],
            ['settings', 'Settings'],
            ['security', 'Security'],
            ['invite', 'Team'],
            ['digest', 'Digest'],
          ]} onChange={(v) => setFilters({ ...filters, type: v })} />
          <FilterChip label="Range" value="24h" options={[
            ['24h', 'Last 24h'], ['7d', 'Last 7d'], ['30d', 'Last 30d'], ['all', 'All time'],
          ]} onChange={() => {}} />
          <span className="dot-divider" style={{ margin: 0 }}>·</span>
          <Button size="sm" variant="ghost" leftIcon={<Icons.Filter />}>More filters</Button>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{filtered.length} events</span>
          <Button size="sm" variant="ghost" leftIcon={<Icons.External />}>Export</Button>
        </div>
      </Card>

      {/* Timeline */}
      <Card>
        <div style={{ padding: '4px 0' }}>
          {Object.entries(grouped).map(([day, events]) => (
            <Fragment key={day}>
              <div style={{
                padding: '10px 18px',
                position: 'sticky', top: 0,
                background: 'var(--bg-soft)',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
                zIndex: 1,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span className="t-caps" style={{ color: 'var(--fg)' }}>{day}</span>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>{events.length} events</span>
              </div>
              {events.map((e) => (
                <EventRow
                  key={e.id} e={e}
                  open={openId === e.id}
                  onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </Card>
    </Fragment>
  );
}

// ----- Event row ----------------------------------------------------------
function EventRow({ e, open, onToggle }) {
  const ICO = {
    agent_step:   <Icons.Robot />,
    agent_failed: <Icons.AlertTri />,
    agent_done:   <Icons.Check />,
    approval:     <Icons.Check />,
    reject:       <Icons.X />,
    insight:      <Icons.Sparkles />,
    ingestion:    <Icons.Inbox />,
    cluster:      <Icons.Layers />,
    merge:        <Icons.GitPull />,
    settings:     <Icons.Cog />,
    security:     <Icons.Cog />,
    invite:       <Icons.Plus />,
    digest:       <Icons.Slack />,
  }[e.type] || <Icons.Spark />;

  const toneVar = `var(--${e.tone || 'fg-muted'})`;

  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '70px 28px 1fr auto auto',
          gap: 12,
          padding: '11px 18px',
          alignItems: 'center',
          cursor: 'pointer',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{e.t}</div>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: `color-mix(in oklab, ${toneVar} 12%, transparent)`,
          color: toneVar,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{ICO}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--fg-strong)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11, color: 'var(--fg-muted)' }}>
              <ActorChip actor={e.actor} actorKind={e.actorKind} />
              <span>→</span>
              <span className="mono" style={{ color: 'var(--fg)' }}>{e.target}</span>
            </div>
          </div>
        </div>
        <Badge subtle style={{ color: toneVar }}>{e.type.replace('_', ' ')}</Badge>
        {open ? <Icons.ChevUp /> : <Icons.ChevDown />}
      </div>
      {open && (
        <div style={{
          padding: '14px 18px 18px',
          background: 'var(--bg-soft)',
          borderBottom: '1px solid var(--border)',
          paddingLeft: 130,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div>
              <div className="t-caps" style={{ marginBottom: 6 }}>Detail</div>
              <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.55 }}>{e.detail}</div>
            </div>
            <div>
              <div className="t-caps" style={{ marginBottom: 6 }}>Metadata</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <MetaRow k="Event ID"   v={e.id} mono />
                <MetaRow k="Timestamp"  v={`${e.day} · ${e.t}`} mono />
                <MetaRow k="Actor"      v={`${e.actor} (${e.actorKind})`} />
                <MetaRow k="Target"     v={e.target} mono />
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <Button size="sm" variant="ghost" leftIcon={<Icons.External />}>Open target</Button>
                <Button size="sm" variant="ghost" leftIcon={<Icons.Link />}>Copy link</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActorChip({ actor, actorKind }) {
  if (actorKind === 'human') {
    const initials = actor.split(' ').map(s => s[0]).join('').slice(0, 2);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span className="avatar" style={{ width: 14, height: 14, fontSize: 7.5 }}>{initials}</span>
        <span style={{ color: 'var(--fg)' }}>{actor}</span>
      </span>
    );
  }
  if (actorKind === 'agent') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, background: 'var(--info-soft)', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icons.Robot />
        </span>
        <span className="mono" style={{ color: 'var(--fg)' }}>{actor}</span>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: 'var(--surface-2)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icons.Cog />
      </span>
      <span style={{ color: 'var(--fg-muted)' }} className="mono">{actor}</span>
    </span>
  );
}

function MetaRow({ k, v, mono }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, padding: '3px 0' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{k}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 12, color: 'var(--fg)' }}>{v}</div>
    </div>
  );
}

window.ActivityPage = ActivityPage;
