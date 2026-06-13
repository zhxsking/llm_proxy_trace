// ============================================================
// Trace Collector - 创建/更新/完成 Trace，维护内存缓存
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import type { TraceRecord, TraceStatus, TokenUsage, RawChunk, ChatMessage, ToolCallInMessage } from '../types.js';
import { sanitizeHeaders } from './sanitizer.js';
import { TraceWriter } from './writer.js';
import path from 'node:path';

export class TraceCollector {
  private traces: Map<string, TraceRecord> = new Map();
  private writer: TraceWriter;
  private maxInMemory: number;
  private onNewTrace?: (trace: TraceRecord) => void;
  private onUpdateTrace?: (trace: Partial<TraceRecord> & { id: string }) => void;
  // 非流模式：延迟到 complete/markError 时才广播 trace:new
  private pendingBroadcast: Set<string> = new Set();

  constructor(traceDir: string, maxFileSize: number, maxInMemory: number) {
    this.writer = new TraceWriter(traceDir, maxFileSize);
    this.maxInMemory = maxInMemory;
  }

  /** 从 JSONL 文件加载历史记录（手动触发） */
  loadFromDisk(): number {
    const files = this.writer.getTraceFiles();
    if (files.length === 0) return 0;

    const allTraces: TraceRecord[] = [];
    // 从最新的文件往前读，凑够 maxInMemory 条
    for (let i = files.length - 1; i >= 0 && allTraces.length < this.maxInMemory; i--) {
      const need = this.maxInMemory - allTraces.length;
      const records = this.writer.readTracesFromFile(files[i], need);
      const fileName = path.basename(files[i]);
      for (const r of records) r.sourceFile = fileName;
      allTraces.unshift(...records);
    }

    // 按时间正序插入 Map（保证 getAll 倒序正确）
    const sorted = allTraces
      .slice(-this.maxInMemory)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    for (const trace of sorted) {
      // 历史记录中未完成的重置为 error（进程已退出，不可能再完成）
      if (trace.status === 'pending' || trace.status === 'streaming') {
        trace.status = 'error';
        if (!trace.error) trace.error = { code: 'INTERRUPTED', message: '服务重启，请求中断' };
      }
      this.traces.set(trace.id, trace);
    }

    console.log(`📂 已加载历史记录：${sorted.length} 条（来自 ${files.length} 个文件）`);
    return sorted.length;
  }

  /** 删除指定文件并清除其在内存中的记录 */
  deleteFile(fileName: string): boolean {
    const files = this.writer.getTraceFiles();
    const target = files.find(f => path.basename(f) === fileName);
    if (!target) return false;
    // 清除该文件中的内存记录
    for (const [id, trace] of this.traces.entries()) {
      if (trace.sourceFile === fileName) this.traces.delete(id);
    }
    this.writer.deleteFile(target);
    return true;
  }

  /** Set callbacks for WebSocket broadcasting */
  setCallbacks(
    onNew: (trace: TraceRecord) => void,
    onUpdate: (trace: Partial<TraceRecord> & { id: string }) => void,
  ): void {
    this.onNewTrace = onNew;
    this.onUpdateTrace = onUpdate;
  }

  /** Create a new trace from an incoming request */
  create(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): TraceRecord {
    const id = uuidv4();
    const trace: TraceRecord = {
      id,
      timestamp: new Date().toISOString(),
      provider: '',
      model: (body.model as string) || '',
      status: 'pending',
      duration: 0,
      ttfb: 0,
      request: {
        method,
        path,
        headers: sanitizeHeaders(headers),
        body: {
          ...body,
          model: (body.model as string) || '',
        },
      },
      response: {
        status: 0,
        headers: {},
        body: null,
      },
    };

    this.traces.set(id, trace);
    this.enforceMemoryLimit();

    // 非流模式延迟广播，markStreaming/complete/markError 时再决定
    this.pendingBroadcast.add(id);

    return trace;
  }

  /** Update trace with provider info */
  setProvider(id: string, providerName: string): void {
    const trace = this.traces.get(id);
    if (!trace) return;
    trace.provider = providerName;
  }

  /** Mark trace as streaming - 流式模式立即广播 trace:new */
  markStreaming(id: string): void {
    const trace = this.traces.get(id);
    if (!trace) return;
    trace.status = 'streaming';
    // 流式：立即广播，后续 update 追加 chunks
    if (this.pendingBroadcast.has(id)) {
      this.pendingBroadcast.delete(id);
      this.onNewTrace?.(trace);
    } else {
      this.onUpdateTrace?.({ id, status: 'streaming' });
    }
  }

  /** Record a streaming chunk */
  appendChunk(id: string, chunkData: string): void {
    const trace = this.traces.get(id);
    if (!trace) return;

    if (!trace.response.chunks) {
      trace.response.chunks = [];
    }

    trace.response.chunks.push({
      index: trace.response.chunks.length,
      timestamp: Date.now(),
      data: chunkData,
    });
  }

  /** Record response for non-streaming request */
  recordResponse(id: string, status: number, headers: Record<string, string>, body: unknown): void {
    const trace = this.traces.get(id);
    if (!trace) return;

    trace.response = {
      status,
      headers: sanitizeHeaders(headers),
      body,
      chunks: trace.response.chunks, // preserve accumulated chunks
    };

    // Extract tool calls from response body
    if (body && typeof body === 'object') {
      const respObj = body as Record<string, unknown>;
      if (respObj.choices && Array.isArray(respObj.choices)) {
        const choice = respObj.choices[0] as Record<string, unknown>;
        const message = choice?.message as Record<string, unknown>;
        if (message?.tool_calls && Array.isArray(message.tool_calls)) {
          trace.toolCalls = (message.tool_calls as ToolCallInMessage[]).map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: (() => {
              try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; }
            })(),
          }));
        }
      }
    }
  }

  /** Complete a trace with timing and usage */
  complete(id: string, ttfb?: number, usage?: TokenUsage): void {
    const trace = this.traces.get(id);
    if (!trace) return;

    trace.status = 'completed';
    // B03: Use Date object arithmetic, not string comparison
    trace.duration = Date.now() - new Date(trace.timestamp).getTime();
    if (ttfb != null) trace.ttfb = ttfb;
    if (usage) trace.usage = usage;

    // Persist to JSONL
    this.writer.write(trace);
    // 非流模式：第一次广播带完整 trace；流式模式：发 update
    if (this.pendingBroadcast.has(id)) {
      this.pendingBroadcast.delete(id);
      this.onNewTrace?.(trace);
    } else {
      this.onUpdateTrace?.({ id, status: 'completed', duration: trace.duration, ttfb: trace.ttfb, usage, response: trace.response });
    }
  }

  /** Mark a trace as error */
  markError(id: string, code: string, message: string): void {
    const trace = this.traces.get(id);
    if (!trace) return;

    trace.status = 'error';
    trace.duration = Date.now() - new Date(trace.timestamp).getTime();
    trace.error = { code, message };

    // Persist even errors
    this.writer.write(trace);
    if (this.pendingBroadcast.has(id)) {
      this.pendingBroadcast.delete(id);
      this.onNewTrace?.(trace);
    } else {
      this.onUpdateTrace?.({ id, status: 'error', error: trace.error });
    }
  }

  /**
   * Enforce in-memory limit by evicting the oldest traces.
   * C02: O(n) via Map insertion order (oldest first) instead of O(n log n) sort.
   */
  private enforceMemoryLimit(): void {
    if (this.traces.size <= this.maxInMemory) return;
    const toRemove = this.traces.size - this.maxInMemory;
    let removed = 0;
    for (const key of this.traces.keys()) {
      this.traces.delete(key);
      if (++removed >= toRemove) break;
    }
  }

  /** Get a single trace by ID */
  get(id: string): TraceRecord | undefined {
    return this.traces.get(id);
  }

  /** Get all in-memory traces as array, sorted by timestamp desc */
  getAll(): TraceRecord[] {
    return Array.from(this.traces.values())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /** Search traces with filters */
  search(filters: {
    model?: string;
    provider?: string;
    status?: TraceStatus;
    keyword?: string;
    limit?: number;
    offset?: number;
  }): { traces: TraceRecord[]; total: number } {
    let traces = this.getAll();

    if (filters.model) {
      traces = traces.filter((t) => t.model === filters.model);
    }
    if (filters.provider) {
      traces = traces.filter((t) => t.provider === filters.provider);
    }
    if (filters.status) {
      traces = traces.filter((t) => t.status === filters.status);
    }
    if (filters.keyword) {
      const kw = filters.keyword.toLowerCase();
      traces = traces.filter((t) => {
        const msgs = t.request.body.messages;
        if (msgs) {
          return msgs.some((m) =>
            typeof m.content === 'string' && m.content.toLowerCase().includes(kw),
          );
        }
        // Also check prompt field
        if (typeof t.request.body.prompt === 'string') {
          return t.request.body.prompt.toLowerCase().includes(kw);
        }
        return false;
      });
    }

    const total = traces.length;
    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    traces = traces.slice(offset, offset + limit);

    return { traces, total };
  }

  /** Clear all in-memory traces */
  clear(): void {
    this.traces.clear();
  }

  /** Get trace writer for direct file operations */
  getWriter(): TraceWriter {
    return this.writer;
  }
}
