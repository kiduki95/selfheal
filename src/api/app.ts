import { Hono } from 'hono';
import { Db } from '../db/db.js';
import { config } from '../config.js';
import { ROUTES, type ApiEnv } from './contract.js';
import { serveStaticWeb } from './static.js';
import { plannedRoute } from './routes/planned.js';
import graph from './routes/graph.js';
import proposals from './routes/proposals.js';
import reviews from './routes/reviews.js';
import dashboard from './routes/dashboard.js';

// Assembles the Hono app (docs/architecture.md §3): mounts per-resource routers under /api + static web/.
// Adding a layer = one router file + one line here. serve.ts only boots this app via the Node adapter.
export function createApp(db: Db = new Db()): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  // Inject db/repo into the context (routes read c.var.db / c.var.repo).
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('repo', config.targetRepo);
    await next();
  });

  const api = new Hono<ApiEnv>();
  api.route('/graph', graph);
  api.route('/proposals', proposals);
  api.route('/reviews', reviews);
  api.route('/dashboard', dashboard);
  // Unbuilt layers — mock-shaped 501 (UI keeps its mock fallback). Promote to a real router (as above) when the layer exists.
  for (const spec of ROUTES.filter((r) => r.status === 'planned')) {
    api.route(spec.path.replace(/^\/api/, ''), plannedRoute(spec));
  }
  app.route('/api', api);

  serveStaticWeb(app); // non-/api paths -> static web/ (catch-all, registered last)
  return app;
}
