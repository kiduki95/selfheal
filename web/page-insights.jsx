// ============================================================
// Insights & Proposals — Kanban with detail panel
// ============================================================

function InsightsPage() {
  const [proposals, setProposals] = useState(PROPOSALS);
  const [selected, setSelected] = useState('P-241');
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCategory, setRejectCategory] = useState('out-of-scope');
  const toast = useToast();
  const overlays = useOverlays();

  const cur = proposals.find(p => p.id === selected);

  const cols = [
    { key: 'pending',  label: 'Pending review',  tone: 'warn',   count: proposals.filter(p => p.column === 'pending').length },
    { key: 'approved', label: 'Approved',        tone: 'accent', count: proposals.filter(p => p.column === 'approved').length },
    { key: 'in-dev',   label: 'In Auto-Dev',     tone: 'info',   count: proposals.filter(p => p.column === 'in-dev').length },
    { key: 'rejected', label: 'Rejected',        tone: 'danger', count: proposals.filter(p => p.column === 'rejected').length },
  ];

  const approve = (id) => {
    setProposals(ps => ps.map(p => p.id === id ? { ...p, column: 'approved', approver: { name: 'Maya Ortiz', at: 'just now' } } : p));
    toast({ title: 'Proposal approved', body: `${id} sent to GitHub & Auto-Dev queue`, icon: <Icons.Check /> });
  };
  const sendToDev = (id) => {
    setProposals(ps => ps.map(p => p.id === id ? { ...p, column: 'in-dev' } : p));
    toast({ title: 'Auto-Dev agent dispatched', body: `${id} · GitHub issue #1849 opened`, icon: <Icons.Robot /> });
  };
  const confirmReject = () => {
    setProposals(ps => ps.map(p => p.id === rejectingId ? { ...p, column: 'rejected', rejectReason, rejectCategory, rejector: { name: 'Maya Ortiz', at: 'just now' } } : p));
    toast({ title: 'Proposal rejected', body: `Reason saved — future similar clusters will reference this.`, icon: <Icons.X /> });
    setRejectingId(null); setRejectReason('');
  };

  return (
    <Fragment>
      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 1.4fr', gap: 14, marginBottom: 18 }}>
        <Card pad>
          <div className="t-caps">This week</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">34</div>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>proposals generated</span>
          </div>
          <div style={{ marginTop: 6 }}><Spark data={[2, 4, 3, 5, 6, 8, 6]} h={26} w={180} /></div>
        </Card>
        <Card pad>
          <div className="t-caps">Approval rate</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">63%</div>
            <span className="stat-delta up mono"><Icons.ArrowUp />+8pt</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>Median time-to-decide · 6h 12m</div>
        </Card>
        <Card pad>
          <div className="t-caps">Avg ⌧ confidence</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }} className="mono fg-strong">0.86</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>Opus 4.7 · grounded in 1,063 reviews</div>
        </Card>
        <Card pad>
          <div className="t-caps">Next batch</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 500 }} className="mono fg-strong">in 2d 14h</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>Weekly · every Mon 09:00 KST</div>
        </Card>
        <Card pad>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icons.Sparkles />
            <span style={{ fontSize: 12, fontWeight: 500 }}>Insight skill</span>
            <Badge tone="purple" subtle style={{ marginLeft: 'auto' }}>claude-opus-4-7</Badge>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 8, lineHeight: 1.45 }}>
            Clusters reviews with voyage-3 embeddings → ranks impact × effort → drafts proposal cards. Tuned to Loop's roadmap themes.
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Button size="sm" variant="ghost" leftIcon={<Icons.Pencil />} onClick={() => toast({ title: 'Prompt editor', body: 'Opening skill prompt for claude-opus-4-7', icon: <Icons.Pencil /> })}>Edit prompt</Button>
            <Button size="sm" variant="ghost" leftIcon={<Icons.External />} onClick={() => toast({ title: 'Opening logs', body: 'Last 7 days of insight runs', icon: <Icons.Activity /> })}>View logs</Button>
          </div>
        </Card>
      </div>

      {/* Layout: kanban + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14, alignItems: 'flex-start' }}>
        <div className="kanban">
          {cols.map(col => (
            <div className="kanban-col" key={col.key}>
              <div className="kanban-head">
                <span style={{ width: 6, height: 6, borderRadius: 50, background: `var(--${col.tone})` }} />
                <span className="ttl">{col.label}</span>
                <span className="ct mono">{col.count}</span>
                <Button size="sm" variant="ghost" className="icon-only"><Icons.More /></Button>
              </div>
              <div className="kanban-body">
                {proposals.filter(p => p.column === col.key).map(p => (
                  <ProposalCard
                    key={p.id} p={p}
                    selected={selected === p.id}
                    onClick={() => setSelected(p.id)}
                    onApprove={() => approve(p.id)}
                    onReject={() => setRejectingId(p.id)}
                    onSendToDev={() => sendToDev(p.id)}
                  />
                ))}
                {col.count === 0 && (
                  <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 11.5, color: 'var(--fg-subtle)' }}>None</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {cur && (
          <DetailPanel
            p={cur}
            onApprove={() => approve(cur.id)}
            onReject={() => setRejectingId(cur.id)}
            onSendToDev={() => sendToDev(cur.id)}
            onOpenSlack={() => overlays.openSlack(cur.id)}
            onOpenGithub={() => toast({ title: 'Opening GitHub issue', body: `${cur.id} → loop/loop-app#1849`, icon: <Icons.Github /> })}
            onViewAgent={(agentId) => { window.dispatchEvent(new CustomEvent('selfheal:nav-agent', { detail: agentId })); overlays.navigate('agent'); }}
          />
        )}
      </div>

      {/* Reject modal */}
      {rejectingId && (
        <RejectModal
          id={rejectingId}
          category={rejectCategory} setCategory={setRejectCategory}
          reason={rejectReason} setReason={setRejectReason}
          onClose={() => { setRejectingId(null); setRejectReason(''); }}
          onConfirm={confirmReject}
        />
      )}
    </Fragment>
  );
}

// ----- Proposal card -------------------------------------------------------
function ProposalCard({ p, selected, onClick, onApprove, onReject, onSendToDev }) {
  return (
    <div className={`proposal-card ${selected ? 'expanded' : ''}`} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <PriDot p={p.pri} />
        <span className="proposal-id mono">{p.id}</span>
        <span className="dot-divider">·</span>
        <span style={{ fontSize: 10.5, color: 'var(--fg-subtle)' }} className="mono">{p.cluster}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--fg-subtle)' }} className="mono">⌧ {p.confidence}</span>
      </div>
      <div className="proposal-title">{p.title}</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.targetLabel}</div>

      <div className="proposal-meta">
        <Badge subtle><Icons.Layers /> {p.impacted.toLocaleString()} users</Badge>
        <Badge subtle><Icons.Clock /> {p.effort}</Badge>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--fg-subtle)' }}>
          <span>Impact</span><span className="mono">{p.impactScore}</span>
        </div>
        <div className="impact-bar"><div style={{ width: `${p.impactScore}%` }} /></div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {Object.entries(p.sources || {}).slice(0, 3).map(([s, c]) => (
          <span key={s} className="src-chip" style={{ padding: '1px 6px 1px 3px' }}>
            <span className="src-ico" style={{ background: (SRC_META[s] && SRC_META[s].bg) || '#555', width: 10, height: 10, fontSize: 7 }}>{SRC_META[s] && SRC_META[s].letter}</span>
            <span className="mono" style={{ fontSize: 10 }}>{c}</span>
          </span>
        ))}
      </div>

      {p.column === 'pending' && (
        <div className="proposal-actions">
          <Button size="sm" variant="primary" leftIcon={<Icons.Check />} onClick={(e) => { e.stopPropagation(); onApprove(); }}>Approve</Button>
          <Button size="sm" variant="ghost" leftIcon={<Icons.X />} onClick={(e) => { e.stopPropagation(); onReject(); }}>Reject</Button>
        </div>
      )}
      {p.column === 'approved' && (
        <div className="proposal-actions">
          <Button size="sm" variant="primary" leftIcon={<Icons.Robot />} onClick={(e) => { e.stopPropagation(); onSendToDev(); }}>Dispatch Agent</Button>
        </div>
      )}
      {p.column === 'in-dev' && p.agent && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <span className="pulse" />
          <span>Agent <span className="mono fg-accent">{p.agent}</span> running</span>
        </div>
      )}
      {p.column === 'rejected' && p.rejectReason && (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', paddingTop: 4, borderTop: '1px solid var(--border)', lineHeight: 1.4 }}>
          <Icons.X /> {p.rejectReason}
        </div>
      )}
    </div>
  );
}

// ----- Detail panel --------------------------------------------------------
function DetailPanel({ p, onApprove, onReject, onSendToDev, onOpenSlack, onOpenGithub, onViewAgent }) {
  return (
    <div className="card" style={{ position: 'sticky', top: 0, maxHeight: 'calc(100vh - 180px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PriDot p={p.pri} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{p.id} · {p.cluster}</span>
          <Badge subtle style={{ marginLeft: 'auto' }}>P{p.pri}</Badge>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-strong)', marginTop: 6, letterSpacing: '-0.01em' }}>{p.title}</div>
        <div className="mono" style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 4 }}>→ {p.targetLabel}</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {p.problem && (
          <div style={{ marginBottom: 14 }}>
            <div className="t-caps" style={{ marginBottom: 4 }}>Problem</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.55 }}>{p.problem}</div>
          </div>
        )}
        {p.proposal && (
          <div style={{ marginBottom: 14 }}>
            <div className="t-caps" style={{ marginBottom: 4 }}>Proposed change</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.55 }}>{p.proposal}</div>
          </div>
        )}
        {p.expectedImpact && (
          <div style={{ marginBottom: 14 }}>
            <div className="t-caps" style={{ marginBottom: 4 }}>Expected impact</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.55 }}>{p.expectedImpact}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Stat label="Users impacted" v={p.impacted.toLocaleString()} />
          <Stat label="Effort" v={p.effort} />
          <Stat label="Confidence" v={p.confidence.toFixed(2)} />
          <Stat label="Impact score" v={`${p.impactScore} / 100`} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="t-caps" style={{ marginBottom: 6 }}>Source breakdown</div>
          {Object.entries(p.sources || {}).map(([s, c]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <SourceChip src={s} />
              <div style={{ flex: 1, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(c / Math.max(...Object.values(p.sources))) * 100}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg-muted)', width: 32, textAlign: 'right' }}>{c}</span>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="t-caps" style={{ marginBottom: 6 }}>Skill / Agent</div>
          <Badge tone="purple" subtle><Icons.Sparkles />{p.skill}</Badge>
          {p.similar > 0 && (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>
              {p.similar} similar past proposal{p.similar > 1 ? 's' : ''} found · referencing reject comments
            </div>
          )}
        </div>

        {p.approver && (
          <div style={{ padding: 10, background: 'var(--accent-soft)', borderRadius: 6, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <Icons.Check />
              <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Approved by {p.approver.name}</span>
              <span style={{ color: 'var(--fg-muted)', marginLeft: 'auto' }} className="mono">{p.approver.at}</span>
            </div>
          </div>
        )}
        {p.rejector && (
          <div style={{ padding: 10, background: 'var(--danger-soft)', borderRadius: 6, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <Icons.X />
              <span style={{ color: 'var(--danger)', fontWeight: 500 }}>Rejected by {p.rejector.name}</span>
              <span style={{ color: 'var(--fg-muted)', marginLeft: 'auto' }} className="mono">{p.rejector.at}</span>
            </div>
            {p.rejectReason && (
              <div style={{ fontSize: 12, color: 'var(--fg)', marginTop: 6, lineHeight: 1.5 }}>{p.rejectReason}</div>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, background: 'var(--bg-soft)' }}>
        {p.column === 'pending' && (
          <Fragment>
            <Button variant="primary" leftIcon={<Icons.Check />} onClick={onApprove} style={{ flex: 1 }}>Approve & queue</Button>
            <Button variant="ghost" leftIcon={<Icons.X />} onClick={onReject}>Reject</Button>
            <Button variant="ghost" className="icon-only" onClick={onOpenSlack} title="View Slack thread"><Icons.Slack /></Button>
          </Fragment>
        )}
        {p.column === 'approved' && (
          <Fragment>
            <Button variant="primary" leftIcon={<Icons.Robot />} onClick={onSendToDev} style={{ flex: 1 }}>Dispatch Auto-Dev agent</Button>
            <Button variant="ghost" leftIcon={<Icons.Github />} onClick={onOpenGithub}>GitHub issue</Button>
          </Fragment>
        )}
        {p.column === 'in-dev' && (
          <Fragment>
            <Button variant="ghost" leftIcon={<Icons.Robot />} style={{ flex: 1 }} onClick={() => onViewAgent(p.agent)}>View agent {p.agent}</Button>
            <Button variant="ghost" leftIcon={<Icons.Github />} onClick={onOpenGithub}>#1849</Button>
          </Fragment>
        )}
        {p.column === 'rejected' && (
          <Fragment>
            <Button variant="ghost" leftIcon={<Icons.Refresh />} style={{ flex: 1 }}>Re-open</Button>
            <Button variant="ghost" leftIcon={<Icons.Pencil />}>Edit reason</Button>
          </Fragment>
        )}
      </div>
    </div>
  );
}

function Stat({ label, v }) {
  return (
    <div style={{ padding: 10, background: 'var(--bg-soft)', borderRadius: 6 }}>
      <div className="t-caps" style={{ fontSize: 9.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, color: 'var(--fg-strong)', fontWeight: 500, marginTop: 2 }}>{v}</div>
    </div>
  );
}

// ----- Reject modal --------------------------------------------------------
function RejectModal({ id, category, setCategory, reason, setReason, onClose, onConfirm }) {
  const cats = [
    { v: 'out-of-scope',  l: 'Out of scope / roadmap conflict' },
    { v: 'duplicate',     l: 'Duplicate / overlaps existing work' },
    { v: 'low-value',     l: 'Low value vs. effort' },
    { v: 'wrong-cluster', l: 'Cluster is wrong — re-cluster' },
    { v: 'wont-fix',      l: "Won't fix — by design" },
    { v: 'other',         l: 'Other' },
  ];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ width: 480, maxWidth: '100%' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icons.X />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-strong)' }}>Reject {id}</div>
          <Button variant="ghost" className="icon-only" onClick={onClose} style={{ marginLeft: 'auto' }}><Icons.X /></Button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 14, lineHeight: 1.5 }}>
            The reason is attached to the cluster and remembered by the insight skill.
            Future similar feedback will reference this comment.
          </div>
          <div className="t-caps" style={{ marginBottom: 6 }}>Category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            {cats.map(c => (
              <label key={c.v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, background: category === c.v ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }} onClick={() => setCategory(c.v)}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: `1.5px solid ${category === c.v ? 'var(--accent)' : 'var(--border-strong)'}`, background: category === c.v ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {category === c.v && <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent-fg)' }} />}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>{c.l}</span>
              </label>
            ))}
          </div>
          <div className="t-caps" style={{ marginBottom: 6 }}>Reason / note (will be remembered)</div>
          <div className="comment-box">
            <textarea
              placeholder="e.g. Overlaps with workspace-templates RFC already in design (Issue #2104). Revisit Q2."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" leftIcon={<Icons.X />} onClick={onConfirm}>Reject proposal</Button>
        </div>
      </div>
    </div>
  );
}

window.InsightsPage = InsightsPage;
