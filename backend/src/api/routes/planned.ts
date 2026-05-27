import { Hono } from 'hono';
import { config } from '../../config.js';
import type { RouteSpec } from '../contract.js';

// Router for unbuilt layers — every method returns a mock-shaped 501. UI keeps its window mock fallback.
// When the layer (Ingestion/Auto-Dev/Audit) exists, swap for a real router in app.ts -> planned becomes live.
export function plannedRoute(spec: RouteSpec) {
  const r = new Hono();
  r.all('*', (c) =>
    c.json(
      { source: 'mock', repo: config.targetRepo, data: null, note: `Unbuilt layer — ${spec.backend}. Roadmap docs/architecture.md §6 step ${spec.roadmapStep}. UI uses mock fallback.` },
      501,
    ),
  );
  return r;
}
