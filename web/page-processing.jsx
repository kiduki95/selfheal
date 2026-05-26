// ============================================================
// Processing — Bigstep-style hierarchical graph + side panel
// ============================================================
// Maps repo modules / features against review clusters.
// Variants (tweak): tree | radial | force

const GRAPH_W = 1180;
const GRAPH_H = 640;

// Module ordering for layout
const MOD_ORDER = ['transcribe', 'summary', 'integrations', 'mobile', 'collab', 'auth'];
const ORPHAN_ORDER = ['orphan_teams', 'orphan_offline', 'orphan_widget'];

// ----- Layout: TREE --------------------------------------------------------
function computeTreeLayout() {
  const positions = {};
  const featW = 116;
  const featH = 36;
  const modW = 140;
  const modH = 52;
  const rootW = 168;
  const rootH = 52;

  // root
  positions['root'] = { x: GRAPH_W / 2 - rootW / 2, y: 18, w: rootW, h: rootH };

  // modules — 6 in a row centered
  const modGap = 20;
  const totalModW = MOD_ORDER.length * modW + (MOD_ORDER.length - 1) * modGap;
  // reserve right lane for orphans (~ 160px including divider)
  const orphanLaneW = 160;
  const available = GRAPH_W - orphanLaneW - 40;
  const startX = 20 + Math.max(0, (available - totalModW) / 2);
  MOD_ORDER.forEach((id, i) => {
    positions[id] = {
      x: startX + i * (modW + modGap),
      y: 118,
      w: modW, h: modH,
    };
  });

  // features under each module, stacked vertically
  MOD_ORDER.forEach((modId) => {
    const feats = MODULES.filter((m) => m.parent === modId);
    feats.forEach((f, i) => {
      const mp = positions[modId];
      positions[f.id] = {
        x: mp.x + (modW - featW) / 2,
        y: 220 + i * (featH + 10),
        w: featW, h: featH,
      };
    });
  });

  // orphans — right lane
  const orphanX = GRAPH_W - orphanLaneW + 16;
  ORPHAN_ORDER.forEach((id, i) => {
    positions[id] = {
      x: orphanX,
      y: 118 + i * 90,
      w: 140, h: 52,
    };
  });

  return positions;
}

// ----- Layout: RADIAL ------------------------------------------------------
function computeRadialLayout() {
  const positions = {};
  const cx = GRAPH_W / 2 - 100;
  const cy = GRAPH_H / 2 - 30;

  const featW = 110, featH = 32, modW = 134, modH = 48, rootW = 160, rootH = 48;
  positions['root'] = { x: cx - rootW / 2, y: cy - rootH / 2, w: rootW, h: rootH };

  // modules in inner ring
  const modR = 180;
  MOD_ORDER.forEach((id, i) => {
    const angle = (i / MOD_ORDER.length) * Math.PI * 2 - Math.PI / 2;
    positions[id] = {
      x: cx + Math.cos(angle) * modR - modW / 2,
      y: cy + Math.sin(angle) * modR - modH / 2,
      w: modW, h: modH, angle,
    };
  });

  // features in outer ring, grouped around their module's angle
  MOD_ORDER.forEach((modId) => {
    const mp = positions[modId];
    const feats = MODULES.filter((m) => m.parent === modId);
    const baseAngle = mp.angle;
    const spread = Math.PI / 6;
    feats.forEach((f, i) => {
      const offset = feats.length === 1 ? 0 : -spread / 2 + (i / (feats.length - 1)) * spread;
      const a = baseAngle + offset;
      const outerR = 310;
      positions[f.id] = {
        x: cx + Math.cos(a) * outerR - featW / 2,
        y: cy + Math.sin(a) * outerR - featH / 2,
        w: featW, h: featH,
      };
    });
  });

  // orphans at far right
  ORPHAN_ORDER.forEach((id, i) => {
    positions[id] = {
      x: GRAPH_W - 160,
      y: 30 + i * 70,
      w: 140, h: 50,
    };
  });

  return positions;
}

// ----- Layout: FORCE (pre-computed pseudo-force) ---------------------------
function computeForceLayout() {
  // Hand-tuned "force-directed-looking" positions
  const positions = {
    root:         { x: 540, y: 290, w: 160, h: 50 },

    transcribe:   { x: 230, y: 110, w: 140, h: 48 },
    summary:      { x: 770, y: 110, w: 140, h: 48 },
    integrations: { x: 870, y: 320, w: 140, h: 48 },
    mobile:       { x: 770, y: 490, w: 140, h: 48 },
    collab:       { x: 230, y: 490, w: 140, h: 48 },
    auth:         { x: 120, y: 300, w: 140, h: 48 },

    t_ko:    { x: 30,  y: 30,  w: 112, h: 34 },
    t_en:    { x: 170, y: 30,  w: 112, h: 34 },
    t_dia:   { x: 310, y: 30,  w: 122, h: 34 },
    t_noise: { x: 80,  y: 200, w: 122, h: 34 },

    s_bullets:   { x: 690, y: 30, w: 122, h: 34 },
    s_actions:   { x: 820, y: 30, w: 122, h: 34 },
    s_decisions: { x: 950, y: 30, w: 122, h: 34 },
    s_translate: { x: 970, y: 230, w: 122, h: 34 },

    i_slack:  { x: 1030, y: 250, w: 100, h: 34 },
    i_notion: { x: 1030, y: 360, w: 100, h: 34 },
    i_linear: { x: 1030, y: 420, w: 100, h: 34 },
    i_gcal:   { x: 950,  y: 480, w: 130, h: 34 },

    m_ios:     { x: 760, y: 570, w: 100, h: 34 },
    m_android: { x: 870, y: 570, w: 110, h: 34 },
    m_ipad:    { x: 700, y: 540, w: 90,  h: 32 },

    c_share:   { x: 200, y: 570, w: 100, h: 34 },
    c_comment: { x: 80,  y: 540, w: 110, h: 32 },

    a_sso: { x: 30, y: 300, w: 80, h: 32 },

    orphan_teams:   { x: 480, y: 30,  w: 156, h: 52 },
    orphan_offline: { x: 480, y: 565, w: 156, h: 52 },
    orphan_widget:  { x: 380, y: 295, w: 130, h: 48 },
  };
  return positions;
}

// ----- Edge path (smooth cubic bezier) -------------------------------------
function edgePath(a, b) {
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y;
  const dy = (y2 - y1);
  return `M${x1},${y1} C${x1},${y1 + dy * 0.5} ${x2},${y2 - dy * 0.5} ${x2},${y2}`;
}

function edgePathAny(a, b) {
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h / 2;
  const x2 = b.x + b.w / 2;
  const y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
}

// ----- Page ----------------------------------------------------------------
function ProcessingPage({ graphStyle }) {
  const [selected, setSelected] = useState('t_ko');
  const [showRaw, setShowRaw] = useState(false);
  const overlays = useOverlays();

  const positions = useMemo(() => {
    if (graphStyle === 'radial') return computeRadialLayout();
    if (graphStyle === 'force')  return computeForceLayout();
    return computeTreeLayout();
  }, [graphStyle]);

  // Build edges from parent relations
  const edges = useMemo(() => {
    return MODULES
      .filter((m) => m.parent && positions[m.id] && positions[m.parent])
      .map((m) => ({ from: m.parent, to: m.id, dashed: false }));
  }, [positions]);

  const selectedNode = MODULES.find((m) => m.id === selected);
  const reviews = REVIEWS[selected] || [];

  return (
    <Fragment>
      {/* Toolbar */}
      <div className="graph-toolbar">
        <Badge dot tone="accent">Live · last sync 2m ago</Badge>
        <span className="dot-divider">·</span>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }} className="mono">loop-app @ a3f9c1d · main</span>
        <div className="spacer" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Heat:</span>
          <span style={{ fontSize: 11 }} className="mono">reviews / 7d</span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
            {[0.1, 0.25, 0.45, 0.7, 0.95].map((a, i) =>
              <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: `rgba(0, 212, 168, ${a})` }} />
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" leftIcon={<Icons.Filter />}>Filter</Button>
        <Button size="sm" variant="ghost" leftIcon={<Icons.Refresh />} onClick={() => overlays.confirm({
          title: 'Re-cluster all reviews?',
          body: 'Re-embeds all 1,247,318 vectors and rebuilds clusters with k=148. Takes ~2 min. The graph will be partially blank during the run.',
          confirmLabel: 'Re-cluster',
          onConfirm: () => overlays.toast({ title: 'Re-clustering started', body: 'voyage-3 · eta ~2 min · graph will refresh', icon: <Icons.Refresh /> }),
        })}>Re-cluster</Button>
        <Button size="sm" leftIcon={<Icons.Database />} onClick={() => overlays.navigate('reviews')}>{showRaw ? 'Hide raw' : 'Raw reviews'}</Button>
      </div>

      <div className="graph-frame">
        <div className="graph-canvas">
          {/* SVG layer for edges */}
          <svg width={GRAPH_W} height={GRAPH_H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs>
              <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const a = positions[e.from];
              const b = positions[e.to];
              const isActiveChain = (selected === e.from || selected === e.to);
              const dPath = graphStyle === 'force' ? edgePathAny(a, b) : edgePath(a, b);
              return (
                <path
                  key={i}
                  d={dPath}
                  fill="none"
                  stroke={isActiveChain ? 'var(--accent)' : 'var(--border-strong)'}
                  strokeWidth={isActiveChain ? 1.6 : 1.2}
                  strokeDasharray={e.dashed ? '4 4' : '0'}
                  opacity={isActiveChain ? 1 : 0.85}
                />
              );
            })}
            {/* Orphan dashed lines to a virtual "incoming" point */}
            {ORPHAN_ORDER.map((id) => {
              const p = positions[id];
              if (!p) return null;
              const x1 = p.x;
              const y1 = p.y + p.h / 2;
              return (
                <path
                  key={id}
                  d={`M${x1 - 24},${y1} L${x1},${y1}`}
                  stroke="var(--warn)"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  fill="none"
                  opacity="0.6"
                />
              );
            })}
            {/* Vertical separator before orphan lane (tree only) */}
            {graphStyle === 'tree' && (
              <line
                x1={GRAPH_W - 180}
                y1={90}
                x2={GRAPH_W - 180}
                y2={GRAPH_H - 30}
                stroke="var(--border)"
                strokeDasharray="4 6"
                strokeWidth="1"
              />
            )}
          </svg>

          {/* Tree-only header labels */}
          {graphStyle === 'tree' && (
            <Fragment>
              <div className="t-caps" style={{ position: 'absolute', left: 30, top: 90 }}>Repo modules</div>
              <div className="t-caps" style={{ position: 'absolute', right: 30, top: 90, color: 'var(--warn)' }}>Unmapped clusters · 3</div>
            </Fragment>
          )}

          {/* Nodes */}
          {MODULES.map((m) => {
            const p = positions[m.id];
            if (!p) return null;
            return (
              <GraphNode
                key={m.id}
                m={m}
                p={p}
                selected={selected === m.id}
                onClick={() => setSelected(m.id)}
              />
            );
          })}
        </div>

        {/* Side panel */}
        {selectedNode && (
          <div className="graph-side">
            <div className="graph-side-head">
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Badge tone={selectedNode.isOrphan ? 'warn' : selectedNode.kind === 'module' ? 'accent' : 'info'} subtle>
                    {selectedNode.isOrphan ? 'unmapped' : selectedNode.kind}
                  </Badge>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>{selectedNode.heat} reviews / 7d</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)', marginTop: 6 }} className="mono">{selectedNode.label}</div>
                {selectedNode.isOrphan ? (
                  <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 4 }}>
                    Cluster doesn't map to any existing module.<br />→ Proposed as new module / feature.
                  </div>
                ) : (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                    {selectedNode.branchTag ? `loop-app/${selectedNode.label.replace('/', '')}` : `loop-app/.../${selectedNode.label}`}
                  </div>
                )}
              </div>
              <Button variant="ghost" className="icon-only" onClick={() => setSelected(null)}><Icons.X /></Button>
            </div>
            <div className="graph-side-body">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="t-caps">Top reviews</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }}>{reviews.length || 0} of {selectedNode.heat}</div>
              </div>
              {reviews.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-subtle)', fontSize: 12 }}>
                  Sampled reviews load on focus.<br />
                  <span className="mono">~{selectedNode.heat} total in cluster</span>
                </div>
              )}
              {reviews.map((r, i) => (
                <div key={i} className="review-item">
                  <div className="review-head">
                    <SourceChip src={r.src} />
                    {r.rating != null && <span className="badge subtle" style={{ fontSize: 10.5 }}>★ {r.rating}</span>}
                    <span className="badge subtle" style={{ fontSize: 10.5 }}>{r.lang}</span>
                    <span className={`badge subtle ${r.sentiment === 'neg' ? 'danger' : r.sentiment === 'pos' ? 'accent' : ''}`} style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                      {r.sentiment}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--fg-subtle)' }}>{r.date}</span>
                  </div>
                  <div className="review-text">{r.text}</div>
                  <div className="review-tags">
                    {r.tags.map((t) => <span key={t} className="badge subtle" style={{ fontSize: 10 }}>#{t}</span>)}
                  </div>
                </div>
              ))}
              {selectedNode.isOrphan && (
                <div style={{ marginTop: 16, padding: 12, background: 'var(--warn-soft)', borderRadius: 6, border: '1px solid var(--warn)', borderStyle: 'dashed' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Icons.Sparkles />
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--warn)' }}>Proposal generated</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.4 }}>
                    A proposal card has been created. Review and approve to wire this into the codebase.
                  </div>
                  <Button size="sm" variant="ghost" rightIcon={<Icons.ArrowRight />} style={{ marginTop: 8 }} onClick={() => overlays.navigate('insights')}>Open proposal P-238</Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Below: stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 14 }}>
        <Card pad>
          <div className="t-caps">Mapped coverage</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--fg-strong)' }} className="mono">87.2%</div>
            <span className="stat-delta up mono"><Icons.ArrowUp />+3.4pt</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>1,063 / 1,219 reviews mapped</div>
        </Card>
        <Card pad>
          <div className="t-caps">Hottest module</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }} className="mono">transcribe/</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>312 reviews · korean-asr dominates (60%)</div>
        </Card>
        <Card pad>
          <div className="t-caps">Unmapped clusters</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--warn)' }} className="mono">3</div>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>134 reviews</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>Proposed as new modules</div>
        </Card>
        <Card pad>
          <div className="t-caps">Last re-cluster</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }} className="mono">2h 18m ago</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>voyage-3 · pgvector · k=148</div>
        </Card>
      </div>
    </Fragment>
  );
}

// ----- Node ----------------------------------------------------------------
function GraphNode({ m, p, selected, onClick }) {
  const max = 312;
  const heatPct = Math.min(1, m.heat / max);
  const isHot = heatPct > 0.5;
  const isCold = m.heat < 25;

  const cls = [
    'node',
    m.kind === 'feature' ? 'node-feat' : '',
    m.kind === 'module'  ? 'node-module' : '',
    m.id === 'root'      ? 'node-root' : '',
    m.isOrphan           ? 'node-orphan' : '',
    selected             ? 'selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      style={{
        left: p.x, top: p.y,
        width: p.w, minWidth: p.w,
        padding: m.kind === 'feature' ? '5px 8px' : '8px 10px',
      }}
      onClick={onClick}
    >
      <div className="node-head">
        {m.id === 'root' ? (
          <Icons.Database />
        ) : m.isOrphan ? (
          <Icons.AlertTri />
        ) : m.kind === 'module' ? (
          <Icons.Folder />
        ) : (
          <Icons.Code />
        )}
        <span className="node-name mono">{m.label}</span>
      </div>
      {m.kind !== 'feature' && (
        <div className="node-meta">
          <span>{m.heat}</span>
          <span className="dot-divider">·</span>
          <span>{m.isOrphan ? 'unmapped' : m.branchTag || 'feature'}</span>
        </div>
      )}
      {m.kind !== 'feature' && (
        <div className={`node-heat ${isHot ? '' : isCold ? 'cold' : ''}`}>
          {m.heat}
        </div>
      )}
      {/* Heat bar at bottom for features */}
      {m.kind === 'feature' && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, var(--accent) ${heatPct * 100}%, var(--surface-2) ${heatPct * 100}%)` }} />
      )}
    </div>
  );
}

window.ProcessingPage = ProcessingPage;
