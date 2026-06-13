// ============================================================
// API Client - 后端 API 调用
// ============================================================

const API_BASE = '/api';

export interface TraceListResult {
  traces: TraceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TraceRecord {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  duration: number;
  ttfb: number;
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: {
      model: string;
      messages?: ChatMessage[];
      prompt?: string;
      system?: string | unknown[];
      tools?: unknown[];
      stream?: boolean;
      temperature?: number;
      max_tokens?: number;
      [key: string]: unknown;
    };
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    chunks?: RawChunk[];
  };
  toolCalls?: ToolCallRecord[];
  usage?: TokenUsage;
  error?: { code: string; message: string };
  sourceFile?: string;  // 来自哪个 JSONL 文件
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCallInMessage[];
}

export interface ContentPart {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  tool_use_id?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface ToolCallInMessage {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cachedTokens?: number;
}

export interface RawChunk {
  index: number;
  timestamp: number;
  data: string;
}

export interface ProviderInfo {
  type: string;
  baseUrl: string;
  apiKey?: string;
}

export interface StatsInfo {
  totalCalls: number;
  totalTokens: number;
  avgDuration: number;
  callsByModel: Record<string, number>;
  callsByProvider: Record<string, number>;
  recentCalls: TraceRecord[];
}

export interface ConfigInfo {
  proxy: { port: number; logLevel: string };
  trace: { dir: string };
  dashboard: { autoOpen: boolean };
  providerCount: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, options);
  if (!resp.ok) {
    throw new Error(`API error: ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  // Traces
  getTraces: (params?: { model?: string; provider?: string; status?: string; keyword?: string; limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.model) search.set('model', params.model);
    if (params?.provider) search.set('provider', params.provider);
    if (params?.status) search.set('status', params.status);
    if (params?.keyword) search.set('keyword', params.keyword);
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return request<TraceListResult>(`/traces${qs ? '?' + qs : ''}`);
  },

  getTrace: (id: string) => request<TraceRecord>(`/traces/${id}`),

  reloadTraces: () => request<{ ok: boolean; loaded: number }>('/traces/reload', { method: 'POST' }),

  getTraceFiles: () => request<{ files: string[] }>('/traces/files'),

  deleteTraceFile: (name: string) =>
    request<{ ok: boolean }>(`/traces/file/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  deleteTraces: (permanent = false) =>
    request<{ ok: boolean; permanent: boolean }>(`/traces${permanent ? '?files=true' : ''}`, { method: 'DELETE' }),

  // Providers
  getProviders: () => request<ProviderInfo[]>('/providers'),

  // Stats
  getStats: () => request<StatsInfo>('/stats'),

  // Config
  getConfig: () => request<ConfigInfo>('/config'),
};
