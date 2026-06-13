// ============================================================
// Management API Routes
// ============================================================

import { Hono } from 'hono';
import path from 'node:path';
import type { TraceCollector } from '../trace/collector.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { AppConfig, ProviderType, ProviderConfig } from '../types.js';
import { maskApiKey } from '../config/crypto.js';
import { saveConfig } from '../config/loader.js';

export function createApiRoutes(
  collector: TraceCollector,
  registry: ProviderRegistry,
  config: AppConfig,
  configPath?: string,
): Hono {
  const api = new Hono();

  // --- Trace APIs ---

  api.get('/traces', (c) => {
    const model = c.req.query('model');
    const provider = c.req.query('provider');
    const status = c.req.query('status') as 'pending' | 'streaming' | 'completed' | 'error' | undefined;
    const keyword = c.req.query('keyword');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const result = collector.search({ model, provider, status, keyword, limit, offset });
    return c.json({
      traces: result.traces,
      total: result.total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
    });
  });

  // POST /api/traces/reload → 静态路由必须在 /:id 动态路由之前
  api.post('/traces/reload', (c) => {
    const count = collector.loadFromDisk();
    return c.json({ ok: true, loaded: count });
  });

  // GET /api/traces/files → 获取所有 JSONL 文件名列表
  api.get('/traces/files', (c) => {
    const files = collector.getWriter().getTraceFiles().map(f => path.basename(f));
    return c.json({ files });
  });

  // DELETE /api/traces/file/:name → 删除指定文件及其内存记录
  api.delete('/traces/file/:name', (c) => {
    const name = c.req.param('name');
    const ok = collector.deleteFile(name);
    return c.json({ ok });
  });

  api.get('/traces/:id', (c) => {
    const id = c.req.param('id');
    const trace = collector.get(id);
    if (!trace) return c.json({ error: 'Trace not found' }, 404);
    return c.json(trace);
  });

  api.delete('/traces', (c) => {
    const permanent = c.req.query('files') === 'true';
    collector.clear();
    if (permanent) {
      collector.getWriter().deleteAllFiles();
    }
    return c.json({ ok: true, permanent });
  });

  // --- Provider APIs ---

  // GET /api/providers → 返回当前已配置的 provider 列表
  api.get('/providers', (c) => {
    const providers = registry.getAll().map((p) => ({
      type: p.type,
      baseUrl: p.config.baseUrl,
      apiKey: p.config.apiKey ? maskApiKey(p.config.apiKey) : undefined,
    }));
    return c.json(providers);
  });

  // PUT /api/providers/:type → 更新某个 type 的配置
  api.put('/providers/:type', async (c) => {
    const type = c.req.param('type') as ProviderType;
    if (!['openai', 'anthropic', 'ollama'].includes(type)) {
      return c.json({ error: 'Invalid provider type' }, 400);
    }
    const body = await c.req.json<Partial<ProviderConfig>>();
    const existing: Partial<ProviderConfig> = config.providers[type] || {};
    const updated: ProviderConfig = {
      baseUrl: body.baseUrl ?? existing.baseUrl ?? '',
      apiKey: body.apiKey ?? existing.apiKey,
      headers: body.headers ?? existing.headers,
    };
    config.providers[type] = updated;
    registry.registerAll(config.providers);
    saveConfig(config, configPath);
    return c.json({ ok: true });
  });

  // DELETE /api/providers/:type → 移除某个 type
  api.delete('/providers/:type', (c) => {
    const type = c.req.param('type') as ProviderType;
    delete config.providers[type];
    registry.registerAll(config.providers);
    saveConfig(config, configPath);
    return c.json({ ok: true });
  });

  // --- Config APIs ---

  api.get('/config', (c) => {
    return c.json({
      proxy: config.proxy,
      trace: { dir: config.trace.dir, maxFileSize: config.trace.maxFileSize },
      dashboard: config.dashboard,
      providerCount: Object.keys(config.providers).length,
    });
  });

  // --- Stats APIs ---

  api.get('/stats', (c) => {
    const allTraces = collector.getAll();
    const completed = allTraces.filter((t) => t.status === 'completed');

    const totalCalls = allTraces.length;
    const totalTokens = completed.reduce((sum, t) => sum + (t.usage?.totalTokens || 0), 0);
    const avgDuration = completed.length > 0
      ? completed.reduce((sum, t) => sum + t.duration, 0) / completed.length
      : 0;

    const callsByModel: Record<string, number> = {};
    const callsByProvider: Record<string, number> = {};
    for (const t of allTraces) {
      callsByModel[t.model] = (callsByModel[t.model] || 0) + 1;
      callsByProvider[t.provider] = (callsByProvider[t.provider] || 0) + 1;
    }

    return c.json({
      totalCalls,
      totalTokens,
      avgDuration: Math.round(avgDuration),
      callsByModel,
      callsByProvider,
      recentCalls: allTraces.slice(0, 10),
    });
  });

  return api;
}
