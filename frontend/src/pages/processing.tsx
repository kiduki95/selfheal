// ============================================================
// Processing — repo code-map + review-signal heatmap (ReactFlow)
// ============================================================
// Real graph engine (@xyflow/react v12) with dagre auto-layout.
// Nodes/edges are derived from mock MODULES; backend /api/graph
// already returns ReactFlow-shaped data for the eventual swap.
//   - dagre lays out the module→feature containment tree (TB)
//   - gap/orphan clusters float in a dedicated right-side zone
//   - heat (reviews/7d) drives node color + minimap
//   - selecting a node highlights its neighbourhood and opens the panel

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import dagre from '@dagrejs/dagre';
import { Icons } from '../components/icons';
import { Card, Badge, Button, SourceChip, ErrorState } from '../components/ui';
import { useOverlays } from '../components/overlays';
import { useGraph } from '../api/hooks/useGraph';
import { useAppStore } from '../store';
import type { RepoModule, GraphReview } from '../data/mock';

type NodeKind = 'repo' | 'module' | 'feature' | 'gap';
interface GraphNodeData extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
  heat: number;
  heatPct: number;
  branchTag?: string;
  isOrphan: boolean;
  active: boolean;
  dim: boolean;
}
type GNode = Node<GraphNodeData>;

const SIZE: Record<NodeKind, { w: number; h: number }> = {
  repo:    { w: 184, h: 56 },
  module:  { w: 158, h: 60 },
  feature: { w: 150, h: 44 },
  gap:     { w: 170, h: 58 },
};

// ----- Build graph (dagre tree + floating gap zone) ------------------------
function buildGraph(modules: RepoModule[]): { nodes: GNode[]; edges: Edge[] } {
  // Heat normalization — root is an outlier (whole-repo total), so the color
  // scale is anchored to the hottest non-root node, derived from the data.
  const MAX_HEAT = Math.max(1, ...modules.filter((m) => m.id !== 'root').map((m) => m.heat));
  const tree = modules.filter((m) => !m.isOrphan);

  const kindOf = (id: string, kind: string): NodeKind =>
    id === 'root' ? 'repo' : kind === 'module' ? 'module' : 'feature';

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 22, ranksep: 64, marginx: 24, marginy: 24 });

  tree.forEach((m) => {
    const s = SIZE[kindOf(m.id, m.kind)];
    g.setNode(m.id, { width: s.w, height: s.h });
  });
  const containment = tree.filter((m) => m.parent).map((m) => ({ source: m.parent as string, target: m.id }));
  containment.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  let maxX = 0;
  let minY = Infinity;
  const placed = tree.map((m) => {
    const kind = kindOf(m.id, m.kind);
    const s = SIZE[kind];
    const p = g.node(m.id);
    const x = p.x - s.w / 2;
    const y = p.y - s.h / 2;
    maxX = Math.max(maxX, x + s.w);
    minY = Math.min(minY, y);
    return { m, kind, x, y };
  });

  // Gap/orphan clusters — fixed lane to the right of the laid-out tree.
  const gapX = maxX + 96;
  const gapY0 = (minY === Infinity ? 24 : minY) + 40;
  const gaps = modules.filter((m) => m.isOrphan).map((m, i) => ({
    m, kind: 'gap' as NodeKind, x: gapX, y: gapY0 + i * 100,
  }));

  const nodes: GNode[] = [...placed, ...gaps].map(({ m, kind, x, y }) => ({
    id: m.id,
    type: kind,
    position: { x, y },
    // Explicit dimensions let ReactFlow skip measurement and keep
    // onlyRenderVisibleElements culling accurate.
    width: SIZE[kind].w,
    height: SIZE[kind].h,
    data: {
      label: m.label,
      kind: m.kind as NodeKind,
      heat: m.heat,
      heatPct: Math.min(1, m.heat / MAX_HEAT),
      branchTag: m.branchTag,
      isOrphan: !!m.isOrphan,
      active: false,
      dim: false,
    },
    style: { width: SIZE[kind].w, height: SIZE[kind].h },
  }));

  const edges: Edge[] = containment.map((e) => ({
    id: `e-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    style: { stroke: 'var(--border-strong)', strokeWidth: 1.4 },
  }));

  return { nodes, edges };
}

// ----- Custom node components ----------------------------------------------
function NodeShell({ data, kind }: { data: GraphNodeData; kind: NodeKind }) {
  const Icon = kind === 'repo' ? Icons.Database : kind === 'gap' ? Icons.AlertTri : kind === 'module' ? Icons.Folder : Icons.Code;
  const cls = ['rf-node', kind, data.active ? 'active' : '', data.dim ? 'dim' : ''].filter(Boolean).join(' ');
  const showMeter = kind === 'module' || kind === 'repo';
  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} className="rf-handle" />
      <div className="rf-node-head">
        <Icon />
        <span className="rf-node-name mono">{data.label}</span>
        {kind === 'gap'
          ? <span className="rf-heat-badge">{data.heat}</span>
          : kind !== 'feature' && <span className="rf-heat-badge">{data.heat}</span>}
      </div>
      {kind === 'repo' && <div className="rf-node-sub mono">classified · {data.branchTag || 'main'}</div>}
      {kind === 'gap' && <div className="rf-node-sub mono">unmapped cluster</div>}
      {showMeter && (
        <div className="rf-heat-meter"><div style={{ width: `${data.heatPct * 100}%` }} /></div>
      )}
      {kind === 'feature' && (
        <div className="rf-feat-bar" style={{ background: `linear-gradient(90deg, var(--accent) ${data.heatPct * 100}%, var(--surface-2) ${data.heatPct * 100}%)` }} />
      )}
      <Handle type="source" position={Position.Bottom} className="rf-handle" />
    </div>
  );
}
const RepoNode = ({ data }: NodeProps<GNode>) => <NodeShell data={data} kind="repo" />;
const ModuleNode = ({ data }: NodeProps<GNode>) => <NodeShell data={data} kind="module" />;
const FeatureNode = ({ data }: NodeProps<GNode>) => <NodeShell data={data} kind="feature" />;
const GapNode = ({ data }: NodeProps<GNode>) => <NodeShell data={data} kind="gap" />;

const minimapColor = (n: GNode): string =>
  n.data.isOrphan
    ? '#d59b4a'
    : `rgba(236, 90, 68, ${0.22 + (n.data.heatPct || 0) * 0.6})`;

// ----- Page ----------------------------------------------------------------
// Outer wraps the graph in a ReactFlowProvider so the hooks below (and any
// future useReactFlow) have the internal store available. colorMode follows
// the app theme passed from the shell.
interface ProcessingPageProps {
  colorMode?: 'dark' | 'light';
  /** Deep-link node id from the URL (?node=...). Pre-selects a graph node. */
  selectedNode?: string;
  /** Reflect the in-graph selection back to the URL / caller. */
  onSelectNode?: (id: string | null) => void;
}

export function ProcessingPage({ colorMode = 'dark', selectedNode, onSelectNode }: ProcessingPageProps) {
  const { data, isLoading, isError, error, refetch } = useGraph();

  if (isLoading) {
    return (
      <div className="graph-frame" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="mono" style={{ color: 'var(--fg-subtle)', fontSize: 13 }}>Loading graph…</div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <ErrorState message={error instanceof Error ? error.message : 'Failed to load the processing graph.'} onRetry={() => refetch()} />
      </Card>
    );
  }

  return (
    <ReactFlowProvider>
      <ProcessingGraph
        colorMode={colorMode}
        modules={data.data.modules}
        reviews={data.data.reviews}
        deepLinkNode={selectedNode}
        onSelectNode={onSelectNode}
      />
    </ReactFlowProvider>
  );
}

function ProcessingGraph({ colorMode, modules, reviews: reviewsMap, deepLinkNode, onSelectNode }: {
  colorMode: 'dark' | 'light';
  modules: RepoModule[];
  reviews: Record<string, GraphReview[]>;
  deepLinkNode?: string;
  onSelectNode?: (id: string | null) => void;
}) {
  const overlays = useOverlays();
  // The selection is URL-driven when a ?node= deep link is present; otherwise
  // it falls back to the default focus node. `setSelect` updates both local
  // state, the URL (via onSelectNode), and the shared store node selection.
  const storeSelectNode = useAppStore((s) => s.selectNode);
  const [selected, setSelectedRaw] = useState<string | null>(deepLinkNode ?? 't_ko');

  const setSelect = (id: string | null) => {
    setSelectedRaw(id);
    storeSelectNode(id);
    onSelectNode?.(id);
  };

  // Keep local selection in sync if the URL ?node= changes (back/forward, or a
  // shared deep link). Only react to defined deep-link values.
  useEffect(() => {
    if (deepLinkNode !== undefined && deepLinkNode !== selected) {
      setSelectedRaw(deepLinkNode);
      storeSelectNode(deepLinkNode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkNode]);

  const nodeTypes = useMemo(() => ({ repo: RepoNode, module: ModuleNode, feature: FeatureNode, gap: GapNode }), []);
  const base = useMemo(() => buildGraph(modules), [modules]);
  const [nodes, setNodes, onNodesChange] = useNodesState<GNode>(base.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(base.edges);

  // Selection → neighbourhood highlight + dim the rest + light up touching edges.
  useEffect(() => {
    const sel = selected;
    const nb = new Set<string>();
    if (sel) {
      nb.add(sel);
      modules.forEach((m) => { if (m.parent === sel) nb.add(m.id); });
      const node = modules.find((m) => m.id === sel);
      if (node?.parent) nb.add(node.parent);
    }
    setNodes((nds) => nds.map((n) => ({
      ...n,
      data: { ...n.data, active: sel === n.id, dim: sel ? !nb.has(n.id) : false },
    })));
    setEdges((eds) => eds.map((e) => {
      const active = !!sel && (e.source === sel || e.target === sel);
      return {
        ...e,
        animated: active,
        style: {
          stroke: active ? 'var(--accent)' : 'var(--border-strong)',
          strokeWidth: active ? 2 : 1.4,
          opacity: sel ? (active ? 1 : 0.3) : 1,
        },
      };
    }));
  }, [selected, setNodes, setEdges, modules]);

  const selectedNode = modules.find((m) => m.id === selected);
  const reviews = (selected ? reviewsMap[selected] : undefined) || [];

  return (
    <Fragment>
      {/* Toolbar */}
      <div className="graph-toolbar">
        <Badge dot tone="good">Live · last sync 2m ago</Badge>
        <span className="dot-divider">·</span>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }} className="mono">loop-app @ a3f9c1d · main</span>
        <div className="spacer" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Heat:</span>
          <span style={{ fontSize: 11 }} className="mono">reviews / 7d</span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
            {[0.1, 0.25, 0.45, 0.7, 0.95].map((a, i) =>
              <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, transparent)` }} />
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" leftIcon={<Icons.Refresh />} onClick={() => overlays.confirm({
          title: 'Re-cluster all reviews?',
          body: 'Re-embeds all 1,247,318 vectors and rebuilds clusters with k=148. Takes ~2 min. The graph will be partially blank during the run.',
          confirmLabel: 'Re-cluster',
          onConfirm: () => overlays.toast({ title: 'Re-clustering started', body: 'voyage-3 · eta ~2 min · graph will refresh', icon: <Icons.Refresh /> }),
        })}>Re-cluster</Button>
        <Button size="sm" leftIcon={<Icons.Database />} onClick={() => overlays.navigate('reviews')}>Raw reviews</Button>
      </div>

      <div className="graph-frame">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => setSelect(n.id)}
          onPaneClick={() => setSelect(null)}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.3}
          maxZoom={2.2}
          nodesConnectable={false}
          onlyRenderVisibleElements
          colorMode={colorMode}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border-strong)" />
          <Controls position="top-left" showInteractive={false} />
          <MiniMap position="bottom-left" pannable zoomable nodeColor={minimapColor} maskColor="rgba(0,0,0,0.4)" />
        </ReactFlow>

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
              <Button variant="ghost" className="icon-only" onClick={() => setSelect(null)}><Icons.X /></Button>
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
                    <span className={`badge subtle ${r.sentiment === 'neg' ? 'danger' : r.sentiment === 'pos' ? 'good' : ''}`} style={{ marginLeft: 'auto', fontSize: 10.5 }}>
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
                <div style={{ marginTop: 16, padding: 12, background: 'var(--warn-soft)', borderRadius: 6, border: '1px dashed var(--warn)' }}>
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
