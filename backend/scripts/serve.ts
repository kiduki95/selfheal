import { serve } from '@hono/node-server';
import { createApp } from '../src/api/app.js';
import { config } from '../src/config.js';
import { ROUTES } from '../src/api/contract.js';

// Product UI server — boots the Hono app (src/api/app.ts) on the Node adapter. `npm run serve`.
// Serves the built frontend (../frontend/dist) + /api/*. Build the frontend first
// (`cd frontend && npm run build`). See docs/architecture.md §3.
const PORT = Number(process.env.PORT ?? 5175);

serve({ fetch: createApp().fetch, port: PORT }, () => {
  console.log(`\n🖥  selfheal UI → http://localhost:${PORT}  (repo: ${config.targetRepo})`);
  console.log(`   live   : ${ROUTES.filter((r) => r.status === 'live').map((r) => r.path).join(', ')}`);
  console.log(`   planned: ${ROUTES.filter((r) => r.status === 'planned').map((r) => r.path).join(', ')}\n`);
});
