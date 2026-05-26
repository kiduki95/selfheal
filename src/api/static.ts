import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiEnv } from './contract.js';

// Static serving for the built web/ UI (Vite + React + TS → web/dist). Run `npm --prefix web run build` first.
const WEB_DIR = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function serveStaticWeb(app: Hono<ApiEnv>) {
  app.get('*', async (c) => {
    const pathname = c.req.path;
    if (pathname.startsWith('/api')) return c.json({ error: 'unknown api route', path: pathname }, 404);
    if (pathname === '/favicon.ico') return c.body(null, 204);
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
    const full = normalize(join(WEB_DIR, rel));
    if (!full.startsWith(normalize(WEB_DIR))) return c.text('forbidden', 403); // block path traversal
    try {
      const body = await readFile(full);
      return c.body(body, 200, { 'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream' });
    } catch {
      return c.text('not found', 404);
    }
  });
}
