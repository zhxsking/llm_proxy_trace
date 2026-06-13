// ============================================================
// Hono App - 主应用入口
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './types.js';
import { ProviderRegistry } from './providers/registry.js';
import { TraceCollector } from './trace/collector.js';
import { WSServer } from './ws/server.js';
import { handleProxy } from './proxy/handler.js';
import { createApiRoutes } from './api/routes.js';
import { serveStaticFiles } from './static.js';

export interface AppContext {
  app: Hono;
  registry: ProviderRegistry;
  collector: TraceCollector;
  ws: WSServer;
  config: AppConfig;
}

export function createApp(config: AppConfig, configPath?: string): AppContext {
  const app = new Hono();

  // Initialize services
  const registry = new ProviderRegistry();
  const collector = new TraceCollector(
    config.trace.dir,
    config.trace.maxFileSize,
    config.trace.maxInMemory,
  );
  const ws = new WSServer();

  // Register providers from config
  registry.registerAll(config.providers);

  // Wire up WebSocket callbacks for trace events
  collector.setCallbacks(
    (trace) => ws.broadcast({ type: 'trace:new', data: trace }),
    (update) => ws.broadcast({ type: 'trace:update', data: update }),
  );

  // Middleware
  // Security: restrict CORS to localhost origins only.
  // This prevents any web page from a remote origin from reading traces or
  // calling management APIs (which could expose LLM conversation contents).
  app.use('*', cors({
    origin: (origin) => {
      if (!origin) return origin; // same-origin / non-browser requests
      try {
        const url = new URL(origin);
        const host = url.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return origin;
      } catch { /* ignore malformed origin */ }
      return null; // reject everything else
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  }));

  // --- Management API (MUST be before proxy catch-all) ---
  const apiRoutes = createApiRoutes(collector, registry, config, configPath);
  app.route('/api', apiRoutes);

  // --- Health check ---
  app.get('/health', (c) => c.json({ status: 'ok', proxy: true }));

  // --- Proxy Routes ---
  // Models endpoint（返回空列表，不再远程拉取）
  app.get('/v1/models', (c) => c.json({ object: 'list', data: [] }));
  app.get('/models', (c) => c.json({ object: 'list', data: [] }));
  app.get('/api/tags', (c) => c.json({ models: [] }));
  // OpenAI-compatible completions
  app.post('/v1/chat/completions', async (c) => handleProxy(c, registry, collector, ws));
  app.post('/chat/completions', async (c) => handleProxy(c, registry, collector, ws));
  app.post('/v1/completions', async (c) => handleProxy(c, registry, collector, ws));
  app.post('/completions', async (c) => handleProxy(c, registry, collector, ws));

  // Anthropic-compatible
  app.post('/v1/messages', async (c) => handleProxy(c, registry, collector, ws));

  // Ollama-compatible
  app.post('/api/chat', async (c) => handleProxy(c, registry, collector, ws));
  app.post('/api/generate', async (c) => handleProxy(c, registry, collector, ws));

  // Catch-all for any remaining /v1/* paths (except /api/* management routes)
  app.all('/v1/*', async (c) => handleProxy(c, registry, collector, ws));

  // --- Static file serving for frontend (SPA) ---
  // Check for dist/web directory (built frontend)
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web');
  if (fs.existsSync(webDist)) {
    app.use('*', serveStaticFiles(webDist));
  }

  return { app, registry, collector, ws, config };
}
