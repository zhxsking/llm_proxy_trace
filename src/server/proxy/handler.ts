// ============================================================
// Proxy Handler - 代理请求处理核心
// ============================================================

import type { Context } from 'hono';
import type { ProviderRegistry } from '../providers/registry.js';
import type { TraceCollector } from '../trace/collector.js';
import type { WSServer } from '../ws/server.js';
import type { TraceRecord } from '../types.js';
import { proxySSEStream } from './stream.js';

/**
 * Handle proxy request: intercept → route → forward → trace
 */
export async function handleProxy(
  c: Context,
  registry: ProviderRegistry,
  collector: TraceCollector,
  ws: WSServer,
): Promise<Response> {
  const method = c.req.method;
  const path = c.req.path;
  const startTime = Date.now();

  // Parse request body - use raw text + JSON.parse for robustness
  let body: Record<string, unknown> = {};
  try {
    const rawText = await c.req.text();
    if (rawText) {
      body = JSON.parse(rawText);
    }
  } catch {
    // Non-JSON body (e.g., GET /v1/models)
  }

  // Create trace record
  const reqHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(c.req.header())) {
    if (typeof value === 'string') {
      reqHeaders[key] = value;
    }
  }

  const trace = collector.create(method, path, reqHeaders, body);

  // Resolve provider
  const provider = registry.resolveProvider(path);

  if (!provider) {
    collector.markError(trace.id, 'NO_PROVIDER', 'No provider available for this request');
    // Return 400 to prevent SDK auto-retry (502 triggers retries)
    return c.json({ error: { message: 'No provider configured', type: 'proxy_error' } }, 400);
  }

  collector.setProvider(trace.id, provider.type);

  // Build upstream request
  const upstreamUrl = provider.getUpstreamUrl(path);
  const upstreamHeaders = provider.getUpstreamHeaders(reqHeaders);

  const isStream = body.stream === true;

  try {
    // Forward request to upstream
    const upstreamResp = await fetch(upstreamUrl, {
      method,
      headers: upstreamHeaders,
      body: method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    // Non-2xx: always treat as error regardless of stream flag
    if (!upstreamResp.ok) {
      const errorBody = await upstreamResp.text();
      collector.recordResponse(trace.id, upstreamResp.status, Object.fromEntries(upstreamResp.headers.entries()), errorBody);
      collector.markError(trace.id, 'UPSTREAM_ERROR', `Upstream returned ${upstreamResp.status}: ${errorBody.slice(0, 200)}`);
      // B07: preserve original upstream status, pass through 4xx; translate 5xx to 502
      const clientStatus = upstreamResp.status >= 500 ? 502 : upstreamResp.status;
      return c.json({ error: { message: 'Upstream error', type: 'upstream_error', upstream_status: upstreamResp.status } }, clientStatus as 400);
    }

    // Handle streaming response
    if (isStream && upstreamResp.body) {
      return proxySSEStream(upstreamResp, trace, collector, ws, startTime, provider.type);
    }

    // Handle non-streaming response
    const respBody = await upstreamResp.json();
    const ttfb = Date.now() - startTime;

    collector.recordResponse(trace.id, upstreamResp.status, Object.fromEntries(upstreamResp.headers.entries()), respBody);

    // Extract usage
    const usage = extractUsageFromResponse(respBody as Record<string, unknown>, provider.type);
    collector.complete(trace.id, ttfb, usage);

    return c.json(respBody);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    collector.markError(trace.id, 'FETCH_ERROR', errorMsg);
    // Return 400 to prevent SDK auto-retry
    return c.json({ error: { message: 'Proxy fetch failed', type: 'proxy_error', detail: errorMsg } }, 400);
  }
}

function extractUsageFromResponse(
  body: Record<string, unknown>,
  providerType?: string,
): import('../types.js').TokenUsage | undefined {
  const usage = body.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  // Anthropic non-stream: { input_tokens, output_tokens, cache_read_input_tokens, ... }
  if (providerType === 'anthropic') {
    const result: import('../types.js').TokenUsage = {
      promptTokens:     (usage.input_tokens as number)  || 0,
      completionTokens: (usage.output_tokens as number) || 0,
      totalTokens:      ((usage.input_tokens as number) || 0) + ((usage.output_tokens as number) || 0),
    };
    if (usage.cache_read_input_tokens)     result.cacheReadTokens  = usage.cache_read_input_tokens as number;
    if (usage.cache_creation_input_tokens) result.cacheWriteTokens = usage.cache_creation_input_tokens as number;
    return result;
  }

  // OpenAI-compatible: { prompt_tokens, completion_tokens, total_tokens, ... }
  const result: import('../types.js').TokenUsage = {
    promptTokens:     (usage.prompt_tokens as number)     || 0,
    completionTokens: (usage.completion_tokens as number) || 0,
    totalTokens:      (usage.total_tokens as number)      || 0,
  };

  const compDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;
  if (compDetails?.reasoning_tokens) result.reasoningTokens = compDetails.reasoning_tokens as number;

  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  if (promptDetails?.cached_tokens) result.cachedTokens = promptDetails.cached_tokens as number;

  if (usage.cache_read_input_tokens)     result.cacheReadTokens  = usage.cache_read_input_tokens as number;
  if (usage.cache_creation_input_tokens) result.cacheWriteTokens = usage.cache_creation_input_tokens as number;
  if (!result.reasoningTokens && usage.reasoning_tokens) result.reasoningTokens = usage.reasoning_tokens as number;

  return result;
}
