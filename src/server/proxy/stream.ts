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
  providerType?: string,
): Promise<Response> {
  if (!upstreamResponse.body) {
    throw new Error('Upstream response has no body');
  }

  const startTime = requestStartTime;
  let ttfb = 0;
  let firstChunk = true;

  // Accumulate the full response from SSE chunks
  let fullContent = '';
  let reasoningContent = '';
  const toolCallsMap: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let usage: TokenUsage | undefined;

  const isAnthropic = providerType === 'anthropic';

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          let done: boolean;
          let value: Uint8Array | undefined;
          try {
            ({ done, value } = await reader.read());
          } catch (readErr) {
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
              if (isAnthropic) {
                parseAnthropicChunk(parsed, { fullContent, reasoningContent, toolCallsMap, usage },
                  (updates) => {
                    fullContent = updates.fullContent;
                    reasoningContent = updates.reasoningContent;
                    if (updates.usage) usage = updates.usage;
                  });
              } else {
                // OpenAI-compatible format
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
                if (parsed.usage && typeof parsed.usage === 'object') {
                  usage = extractUsageOpenAI(parsed.usage);
                }
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
            break;
          }
        }
      } finally {
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

// ─── Anthropic SSE parser ───────────────────────────────────────────────────

interface Accumulator {
  fullContent: string;
  reasoningContent: string;
  toolCallsMap: Map<number, { id: string; name: string; arguments: string }>;
  usage: TokenUsage | undefined;
}

function parseAnthropicChunk(
  parsed: Record<string, unknown>,
  acc: Accumulator,
  update: (updates: { fullContent: string; reasoningContent: string; usage?: TokenUsage }) => void,
): void {
  const type = parsed.type as string | undefined;

  // message_start: contains initial usage (input tokens)
  if (type === 'message_start') {
    const msg = parsed.message as Record<string, unknown> | undefined;
    if (msg?.usage) {
      acc.usage = mergeAnthropicUsage(acc.usage, msg.usage as Record<string, unknown>);
      update({ fullContent: acc.fullContent, reasoningContent: acc.reasoningContent, usage: acc.usage });
    }
    return;
  }

  // content_block_delta: text or thinking content
  if (type === 'content_block_delta') {
    const delta = parsed.delta as Record<string, unknown> | undefined;
    if (!delta) return;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      acc.fullContent += delta.text;
      update({ fullContent: acc.fullContent, reasoningContent: acc.reasoningContent });
    } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      acc.reasoningContent += delta.thinking;
      update({ fullContent: acc.fullContent, reasoningContent: acc.reasoningContent });
    } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      // tool use argument streaming
      const idx = (parsed.index as number) ?? 0;
      const existing = acc.toolCallsMap.get(idx);
      if (existing) existing.arguments += delta.partial_json;
    }
    return;
  }

  // content_block_start: tool_use block starts here (id + name)
  if (type === 'content_block_start') {
    const block = parsed.content_block as Record<string, unknown> | undefined;
    if (block?.type === 'tool_use') {
      const idx = (parsed.index as number) ?? 0;
      acc.toolCallsMap.set(idx, {
        id: (block.id as string) || '',
        name: (block.name as string) || '',
        arguments: '',
      });
    }
    return;
  }

  // message_delta: contains output token count + stop reason
  if (type === 'message_delta') {
    const deltaUsage = parsed.usage as Record<string, unknown> | undefined;
    if (deltaUsage) {
      acc.usage = mergeAnthropicUsage(acc.usage, deltaUsage);
      update({ fullContent: acc.fullContent, reasoningContent: acc.reasoningContent, usage: acc.usage });
    }
    return;
  }
}

/** 合并 Anthropic 分批下发的 usage 字段（input 在 message_start，output 在 message_delta） */
function mergeAnthropicUsage(
  existing: TokenUsage | undefined,
  raw: Record<string, unknown>,
): TokenUsage {
  const base = existing ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  if (raw.input_tokens != null)               base.promptTokens     = raw.input_tokens as number;
  if (raw.output_tokens != null)              base.completionTokens = raw.output_tokens as number;
  if (raw.cache_read_input_tokens != null)    base.cacheReadTokens  = raw.cache_read_input_tokens as number;
  if (raw.cache_creation_input_tokens != null) base.cacheWriteTokens = raw.cache_creation_input_tokens as number;
  base.totalTokens = base.promptTokens + base.completionTokens;
  return base;
}

// ─── OpenAI usage extractor ─────────────────────────────────────────────────

function extractUsageOpenAI(u: Record<string, unknown>): TokenUsage {
  const base: TokenUsage = {
    promptTokens: (u.prompt_tokens as number) || 0,
    completionTokens: (u.completion_tokens as number) || 0,
    totalTokens: (u.total_tokens as number) || 0,
  };

  const compDetails = u.completion_tokens_details as Record<string, unknown> | undefined;
  if (compDetails?.reasoning_tokens) base.reasoningTokens = compDetails.reasoning_tokens as number;

  const promptDetails = u.prompt_tokens_details as Record<string, unknown> | undefined;
  if (promptDetails?.cached_tokens) base.cachedTokens = promptDetails.cached_tokens as number;

  if (u.cache_read_input_tokens)    base.cacheReadTokens  = u.cache_read_input_tokens as number;
  if (u.cache_creation_input_tokens) base.cacheWriteTokens = u.cache_creation_input_tokens as number;
  if (!base.reasoningTokens && u.reasoning_tokens) base.reasoningTokens = u.reasoning_tokens as number;

  return base;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

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
