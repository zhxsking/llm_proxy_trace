// ============================================================
// SSE Stream Proxy - 流式响应透传与 Trace 记录
// ============================================================

import type { TraceCollector } from '../trace/collector.js';
import type { WSServer } from '../ws/server.js';
import type { TraceRecord, TokenUsage, RawChunk } from '../types.js';

/**
 * Proxy an SSE stream from upstream to client, recording chunks for trace.
 * 使用 start() 异步循环驱动，避免 pull() 回调的竞态问题。
 */
export async function proxySSEStream(
  upstreamResponse: Response,
  trace: TraceRecord,
  collector: TraceCollector,
  ws: WSServer,
  requestStartTime: number,
): Promise<Response> {
  if (!upstreamResponse.body) {
    throw new Error('Upstream response has no body');
  }

  // startTime 来自 handler，包含完整的请求发出时间，确保 TTFB 统计准确
  const startTime = requestStartTime;
  let ttfb = 0;
  let firstChunk = true;

  // Accumulate the full response from SSE chunks
  let fullContent = '';
  let reasoningContent = '';
  const toolCallsMap: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let usage: TokenUsage | undefined;

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();

  // 用 start() 而不是 pull()，用一个 async 循环完整驱动读取，
  // 彻底避免 pull() 竞态导致的 ERR_INVALID_STATE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          let done: boolean;
          let value: Uint8Array | undefined;
          try {
            ({ done, value } = await reader.read());
          } catch (readErr) {
            // 上游连接被关闭（客户端断开 / 超时）
            const msg = readErr instanceof Error ? readErr.message : String(readErr);
            if (!msg.includes('aborted') && !msg.includes('closed') && !msg.includes('disconnected')) {
              console.error('[Stream] Reader error:', readErr);
            }
            break;
          }

          if (done) break;
          if (!value) continue;

          const chunk = decoder.decode(value, { stream: true });

          // Record TTFB
          if (firstChunk) {
            ttfb = Date.now() - startTime;
            firstChunk = false;
            collector.markStreaming(trace.id);
          }

          // Record chunk for trace
          collector.appendChunk(trace.id, chunk);

          // Parse SSE data lines
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta) {
                if (typeof delta.content === 'string') fullContent += delta.content;
                if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content;
                if (Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (tc.id && tc.function?.name) {
                      toolCallsMap.set(idx, { id: tc.id, name: tc.function.name, arguments: tc.function.arguments || '' });
                    } else if (tc.function?.arguments) {
                      const existing = toolCallsMap.get(idx);
                      if (existing) existing.arguments += tc.function.arguments;
                    }
                  }
                }
              }
              // 提取 usage（含扩展字段）
              if (parsed.usage && typeof parsed.usage === 'object') {
                usage = extractUsage(parsed.usage);
              }
            } catch { /* Not JSON, skip */ }
          }

          // Broadcast chunk
          const chunkIndex = collector.get(trace.id)?.response?.chunks?.length ?? 0;
          const rawChunk: RawChunk = {
            index: Math.max(0, chunkIndex - 1),
            timestamp: Date.now(),
            data: chunk,
          };
          ws.broadcast({ type: 'trace:chunk', data: { id: trace.id, chunk: rawChunk } });

          // Pass through to client
          try {
            controller.enqueue(value);
          } catch {
            // Client disconnected — stop reading
            break;
          }
        }
      } finally {
        // 无论正常结束还是异常退出，都完成 trace 并关闭 controller
        const totalDuration = Date.now() - startTime;
        const toolCalls = Array.from(toolCallsMap.values());
        const completeBody = buildCompleteBody(fullContent, reasoningContent, trace.model, toolCalls, usage);

        collector.recordResponse(
          trace.id,
          upstreamResponse.status,
          Object.fromEntries(upstreamResponse.headers.entries()),
          completeBody,
        );
        collector.complete(trace.id, ttfb, usage);
        ws.broadcast({ type: 'trace:complete', data: { id: trace.id, duration: totalDuration, usage } });

        try { controller.close(); } catch { /* already closed */ }
        reader.releaseLock();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  // Forward relevant headers from upstream
  const responseHeaders: Record<string, string> = {};
  for (const [k, v] of upstreamResponse.headers.entries()) {
    if (['content-length', 'content-encoding', 'transfer-encoding'].includes(k.toLowerCase())) continue;
    responseHeaders[k] = v;
  }
  responseHeaders['content-type'] = 'text/event-stream';
  responseHeaders['cache-control'] = 'no-cache';
  responseHeaders['connection'] = 'keep-alive';
  responseHeaders['x-accel-buffering'] = 'no';

  return new Response(stream, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

/** 从 usage 对象提取全部字段（含各家扩展） */
function extractUsage(u: Record<string, unknown>): TokenUsage {
  const base: TokenUsage = {
    promptTokens: (u.prompt_tokens as number) || 0,
    completionTokens: (u.completion_tokens as number) || 0,
    totalTokens: (u.total_tokens as number) || 0,
  };

  // OpenAI o1 / reasoning tokens
  const compDetails = u.completion_tokens_details as Record<string, unknown> | undefined;
  if (compDetails?.reasoning_tokens) {
    base.reasoningTokens = compDetails.reasoning_tokens as number;
  }

  // OpenAI prompt cache
  const promptDetails = u.prompt_tokens_details as Record<string, unknown> | undefined;
  if (promptDetails?.cached_tokens) {
    base.cachedTokens = promptDetails.cached_tokens as number;
  }

  // Anthropic cache
  if (u.cache_read_input_tokens) base.cacheReadTokens = u.cache_read_input_tokens as number;
  if (u.cache_creation_input_tokens) base.cacheWriteTokens = u.cache_creation_input_tokens as number;

  // GLM/DeepSeek: completion_tokens_details.reasoning_tokens 或直接 reasoning_tokens
  if (!base.reasoningTokens && u.reasoning_tokens) {
    base.reasoningTokens = u.reasoning_tokens as number;
  }

  return base;
}

function buildCompleteBody(
  content: string,
  reasoningContent: string,
  model: string,
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  usage?: TokenUsage,
): Record<string, unknown> {
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: content || null,
  };
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop' }],
    usage: usage ? {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
    } : undefined,
  };
}
