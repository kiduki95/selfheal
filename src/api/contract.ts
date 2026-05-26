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

export interface Source { id: string; kind: string; product: string; name: string; region: string; rate: number; lastSync: string; status: 'ok' | 'warn' | 'error'; own: boolean; }

export interface RawReviewRow { id: string; src: string; sentiment: string; rating: number | null; lang: string; text: string; category: string; severity?: string; feature?: string | null; fstate?: string | null; date: string; }

// Processing graph — React Flow nodes/edges (matches the existing ui-server.ts buildGraph output).
export interface GraphNode { id: string; position: { x: number; y: number }; data: { label: string }; style?: Record<string, unknown>; }
export interface GraphEdge { id: string; source: string; target: string; style?: Record<string, unknown>; }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface ProposalCard {
  id: string; kind: 'bug_fix' | 'feature_gap' | 'enhancement'; title: string; priority: number;
  target_module: string | null; placement: string | null; body: string; verdict?: string | null;
}

export interface AgentRun { id: string; proposal: string; title: string; branch: string; status: string; progress: number; }
export interface AuditEvent { id: string; at: string; actor: string; action: string; detail: string; }

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
