// UI <-> backend contract (docs/architecture.md §3).
// The web/ mockup's window globals define the response shapes 1:1 -> UI swaps window.X for fetch('/api/x').
// Each route's `status` marks whether a backend already exists. Handlers live in src/api/routes/*.ts (Hono).
import type { Db } from '../db/db.js';

// Hono context — middleware injects db/repo; routes read them via c.var.db / c.var.repo.
export type ApiEnv = { Variables: { db: Db; repo: string } };

// Envelope for every /api response. `source` distinguishes live/mock so unwired pages don't break.
export interface ApiEnvelope<T> {
  source: 'live' | 'mock';
  repo: string;
  data: T;
  note?: string;
}
export const envelope = <T>(data: T, repo: string, source: 'live' | 'mock' = 'live', note?: string): ApiEnvelope<T> => ({ source, repo, data, note });

// --- Per-page response types (1:1 with web/data/mock.jsx · mock-extras.jsx shapes) ---

export interface PipelineStage { num: string; name: string; value: number; unit: string; sub: string; sparkData: number[]; }
export interface Category { name: string; count: number; share: number; trend: 'up' | 'down' | 'flat'; pct: number; }
export interface ActivityItem { kind: string; at: string; text: string; link: string; }
export interface DashboardData { pipeline: PipelineStage[]; categories: Category[]; activity: ActivityItem[]; }

// `status` standardized on 'error' (web mock previously used 'err'; both sides now agree on 'error').
export interface Source { id: string; kind: string; product: string; name: string; region: string; rate: number; lastSync: string; status: 'ok' | 'warn' | 'error'; own: boolean; }

// Reviews stream — GET /api/reviews. Mirrors web/src/data/mock-extras.ts RawReview 1:1.
// `src` is the SourceKind union on the frontend; backend keeps it as a plain string
// (source channel) since the DB stores arbitrary source identifiers. Fields with no DB
// source yet (author/country/priority/confidence) are derived/defaulted in the handler.
export interface RawReview {
  id: string;
  src: string;                                  // source channel (frontend narrows to SourceKind)
  author: string;
  country: string;
  lang: string;
  rating: number | null;
  sentiment: 'pos' | 'neg' | 'neu' | 'mix';
  priority: string;                             // 'P0'|'P1'|'P2'|'P3'
  when: string;                                 // relative time label, e.g. '14 min ago'
  text: string;
  text_en?: string;
  category: string;
  confidence: number;
  mapped: string | null;                        // mapped feature id (plain id) or null
  mappedLabel: string;                          // human label for the mapped feature/gap
  cluster: string | null;                       // signal_group id or null
  tags: string[];
  isOrphan?: boolean;                           // mapped to a gap (unmapped cluster)
  filtered?: boolean;                           // moderation dropped it (spam/PII)
}

// Processing graph — DOMAIN data only (docs/web-architecture.md §5.1 S2 decision).
// The backend returns the repo module tree + per-node sampled reviews; the client owns
// layout (processing.tsx buildGraph builds ReactFlow nodes/edges + dagre). So: NO node
// positions, NO 'f:'/'g:' ID prefixes, NO inline hex colors, NO style — those are all
// presentation concerns derived on the frontend from `heat`/`kind` via CSS variables.
//
// Node kinds, canonical across UI + backend. 'gap' is an unmapped review cluster
// (the web mock historically called these 'orphan'); both sides now use 'gap'.
export type GraphNodeKind = 'repo' | 'module' | 'feature' | 'gap';
// A repo module/feature/gap node. IDs are PLAIN IDs (e.g. 't_ko', 'orphan_teams', 'root')
// — NOT prefixed. The UI does side-panel and Reviews lookups by these raw IDs, so they are
// the canonical key. Feature vs gap is disambiguated by `kind`, not by an ID prefix.
// Mirrors web/src/data/mock.ts RepoModule exactly.
export interface RepoModule {
  id: string;
  parent: string | null;                        // parent module id; null for repo root + gaps
  label: string;
  kind: GraphNodeKind;
  heat: number;                                 // mapped-review count
  branchTag?: string;
  isOrphan?: boolean;                           // true for gap nodes
}
// A sampled review attached to a graph node. Mirrors web/src/data/mock.ts GraphReview.
export interface GraphReview {
  src: string;                                  // source channel (frontend narrows to SourceKind)
  sentiment: 'pos' | 'neg' | 'neu' | 'mix';
  rating: number | null;
  lang: string;
  text: string;
  tags: string[];
  date: string;                                 // relative time label
}
// /api/graph payload — matches useGraph.ts GraphPayload.
export interface GraphData { modules: RepoModule[]; reviews: Record<string, GraphReview[]>; }

export interface ProposalCard {
  id: string; kind: 'bug_fix' | 'feature_gap' | 'enhancement'; title: string; priority: number;
  target_module: string | null; placement: string | null; body: string; verdict?: string | null;
}

export interface AgentRun { id: string; proposal: string; title: string; branch: string; status: string; progress: number; }

// Audit/activity event — aligned to the richer web mock shape (web/src/data/mock-extras.ts).
// The earlier {at, action} pair was too thin for the Activity timeline UI (day grouping,
// actor avatars, tone-colored rows, expandable detail), so the mock shape wins.
export interface AuditEvent {
  id: string;
  t: string;            // time-of-day, e.g. '14:38:24'
  day: string;          // bucket label, e.g. 'Today' | 'Yesterday'
  actor: string;
  actorKind: 'agent' | 'human' | 'system';
  type: string;
  title: string;
  target: string;
  detail: string;
  tone: 'accent' | 'good' | 'info' | 'purple' | 'danger' | 'warn';
}

// --- Route table (single source of truth) ---
// status: 'live'    = backend table exists, can serve real data
//         'planned' = layer not built yet -> mock-shaped stub (501 + roadmap step)
export type RouteStatus = 'live' | 'planned';
export interface RouteSpec { path: string; page: string; status: RouteStatus; backend: string; roadmapStep?: number; }

export const ROUTES: RouteSpec[] = [
  { path: '/api/graph',     page: 'processing', status: 'live',    backend: 'feature_registry tree + gaps + processed_reviews', roadmapStep: 2 },
  { path: '/api/proposals', page: 'insights',   status: 'live',    backend: 'proposals',                                        roadmapStep: 3 },
  { path: '/api/reviews',   page: 'reviews',    status: 'live',    backend: 'processed_reviews',                                roadmapStep: 4 },
  { path: '/api/dashboard', page: 'dashboard',  status: 'live',    backend: 'metric_snapshots + processed_reviews aggregate (activity awaits audit)', roadmapStep: 5 },
  { path: '/api/sources',   page: 'sources',    status: 'planned', backend: 'Ingestion sources (not built)',                    roadmapStep: 6 },
  { path: '/api/agents',    page: 'agent',      status: 'planned', backend: 'Auto-Dev agent_runs (not built)',                  roadmapStep: 7 },
  { path: '/api/activity',  page: 'activity',   status: 'planned', backend: 'audit_events (not built)',                         roadmapStep: 8 },
];
