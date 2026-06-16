// ============================================================
// LPT Core Types - 所有模块共享的类型定义
// ============================================================

// --- Chat Message Types ---

export interface ContentPart {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  image_url?: { url: string };
  // Anthropic tool_use / tool_result
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCallInMessage[];
}

export interface ToolCallInMessage {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// --- Tool Types ---

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

// --- Provider Config ---

export type ProviderType = 'openai' | 'anthropic';

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface ProvidersConfig {
  openai?: ProviderConfig;
  anthropic?: ProviderConfig;
}

// --- Token Usage ---

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // 扩展字段（按需存在）
  reasoningTokens?: number;       // OpenAI o1 / DeepSeek thinking tokens
  cacheReadTokens?: number;       // Anthropic prompt cache read
  cacheWriteTokens?: number;      // Anthropic prompt cache write
  cachedTokens?: number;          // OpenAI cached_tokens
}

// --- Raw SSE Chunk ---

export interface RawChunk {
  index: number;
  timestamp: number;
  data: string;
}

// --- Trace Record ---

export type TraceStatus = 'pending' | 'streaming' | 'completed' | 'error';

export interface TraceRecord {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  status: TraceStatus;
  duration: number;
  ttfb: number;
  sourceFile?: string;   // 来自哪个 JSONL 文件（仅历史记录有）

  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: {
      model: string;
      messages?: ChatMessage[];
      prompt?: string;
      tools?: ToolDefinition[];
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
}

// --- App Config ---

export interface ProxyConfig {
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface TraceConfig {
  dir: string;
  maxFileSize: number;
  maxAge: number;
  maxInMemory: number;
}

export interface DashboardConfig {
  autoOpen: boolean;
}

export interface AppConfig {
  proxy: ProxyConfig;
  providers: ProvidersConfig;
  trace: TraceConfig;
  dashboard: DashboardConfig;
}

// --- WebSocket Events ---

export type WSEvent =
  | { type: 'trace:new'; data: TraceRecord }
  | { type: 'trace:update'; data: Partial<TraceRecord> & { id: string } }
  | { type: 'trace:chunk'; data: { id: string; chunk: RawChunk } }
  | { type: 'trace:complete'; data: { id: string; duration: number; usage?: TokenUsage } }
  | { type: 'status'; data: { proxy: boolean; connections: number } };

// --- API Response Types ---

export interface TraceListResponse {
  traces: TraceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatsResponse {
  totalCalls: number;
  totalTokens: number;
  avgDuration: number;
  callsByModel: Record<string, number>;
  callsByProvider: Record<string, number>;
  recentCalls: TraceRecord[];
}
