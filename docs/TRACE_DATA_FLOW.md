# Trace 数据流：从请求到 Raw JSON

本文档描述一条 Trace 记录是如何产生的——从客户端发出 LLM 请求，到前端 Raw JSON 面板展示原始内容，每一步数据经历了什么处理。

---

## 一、全局数据流概览

```
LLM 客户端
    │  POST /v1/chat/completions（或 /v1/messages）
    ▼
┌──────────────────────────────────────────────────────┐
│                   Hono HTTP 服务器                    │
│                                                      │
│  handleProxy()          ← 代理入口                   │
│      │                                               │
│      ├─ collector.create()     ← 创建 Trace 骨架     │
│      ├─ fetch(upstreamUrl)     ← 转发到真实 LLM      │
│      │       │                                       │
│      │   非流式 ──► collector.recordResponse()       │
│      │   流式   ──► proxySSEStream()                 │
│      │                   │                           │
│      │               逐 chunk 解析 + 透传             │
│      │                   │                           │
│      └─ collector.complete()  ← 归集 usage/工具调用  │
└──────────────────────────────────────────────────────┘
    │
    ├─ writer.write()    → 追写 traces-xxx.jsonl（磁盘）
    └─ ws.broadcast()   → 推送给前端 WebSocket
                              │
                         App.tsx 接收
                              │
                         TraceDetail.tsx 渲染
                              │
                         Raw JSON 面板（只显示 request + response）
```

---

## 二、数据生命周期详解

### 第 1 步：请求拦截（`handler.ts`）

客户端的请求进入 `handleProxy()`，在**转发给真实 LLM 之前**，LPT 就已经捕获并存储了请求的完整信息：

```typescript
// handler.ts
const rawText = await c.req.text();   // 读取原始请求 body
const body = JSON.parse(rawText);      // 解析为对象

const trace = collector.create(
  method,      // "POST"
  path,        // "/v1/chat/completions"
  reqHeaders,  // 所有请求头（脱敏后）
  body,        // 完整请求体（messages、tools、model 等）
);
```

此时 Trace 对象已包含：

| 字段 | 内容 | 来源 |
|------|------|------|
| `request.method` | `"POST"` | HTTP 请求 |
| `request.path` | `/v1/chat/completions` | HTTP 请求 |
| `request.headers` | 所有请求头（API Key 已脱敏） | `sanitizeHeaders()` |
| `request.body` | 完整 JSON body（含 messages、tools、model、temperature 等） | 请求体原文 |
| `status` | `"pending"` | LPT 初始化 |

> **注意**：`request.body` 是**原样存储**的，LPT 不修改任何字段内容，只做类型归一。

---

### 第 2 步：敏感信息脱敏（`sanitizer.ts`）

请求头中的 API Key 等敏感字段在存储前会被脱敏，**不影响转发**（转发使用的是原始值）：

```typescript
// sanitizer.ts
const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'api-key', 'cookie', 'set-cookie'];

// Authorization: Bearer sk-abcd1234...efgh5678
// → 存储为: "Bearer sk-ab...5678"（首4位 + 尾4位）

// x-api-key: sk-ant-xxx
// → 存储为: "***REDACTED***"
```

脱敏**只作用于 Trace 存储**，实际转发到上游 LLM 时仍使用完整 Key。

---

### 第 3 步-A：非流式响应（`handler.ts`）

```typescript
// handler.ts
const respBody = await upstreamResp.json();  // 完整响应体
const ttfb = Date.now() - startTime;

collector.recordResponse(
  trace.id,
  upstreamResp.status,                       // HTTP 状态码
  Object.fromEntries(upstreamResp.headers),  // 响应头（脱敏后）
  respBody,                                  // 完整 JSON 响应体（原样存储）
);
collector.complete(trace.id, ttfb, usage);
```

`recordResponse()` 中还会从响应体提取 tool_calls：

```typescript
// collector.ts → recordResponse()
if (respObj.choices?.[0]?.message?.tool_calls) {
  trace.toolCalls = message.tool_calls.map(tc => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),  // 字符串 → 对象
  }));
}
```

这里是 `trace.toolCalls`（LPT 归集字段）和 `response.body`（原始响应）**分叉**的地方：
- `response.body` = 上游 LLM 返回的原始 JSON，**原样存储**
- `trace.toolCalls` = LPT 从响应体里提取并解析的归集视图，方便 UI 展示

---

### 第 3 步-B：流式 SSE 响应（`stream.ts`）

流式响应的处理更复杂：LPT 需要在**透传每个 chunk 的同时**，实时积累完整内容：

```
上游 LLM 推送 SSE chunks
        │
        ▼
  decoder.decode(value)   ← 解码 bytes → 文本
        │
        ├─ collector.appendChunk()   ← 存储原始 chunk（用于 Raw JSON 的 chunks 数组）
        │
        ├─ 解析 "data: {...}" 行
        │       ├─ delta.content          → 累加到 fullContent
        │       ├─ delta.reasoning_content → 累加到 reasoningContent
        │       ├─ delta.tool_calls        → 按 index 拼接 arguments
        │       └─ usage 字段             → 记录 token 数
        │
        └─ controller.enqueue(value)  ← 原样透传给客户端（零拷贝）
```

流结束后，用积累的内容**重建**一个完整的响应体，**模拟非流式格式**存入 Trace：

```typescript
// stream.ts → buildCompleteBody()
// 将流式碎片重新组装成与非流式响应相同的结构，
// 使前端可以用统一逻辑渲染流式和非流式 trace。
const completeBody = buildCompleteBody(fullContent, reasoningContent, model, toolCalls, usage);
collector.recordResponse(trace.id, status, headers, completeBody);
```

---

### 第 4 步：usage 归一化（`handler.ts` & `stream.ts`）

OpenAI 和 Anthropic 的 usage 字段命名不同，LPT 统一转换为内部格式：

```
OpenAI 原始                          LPT 内部（TokenUsage）
─────────────────────────────────────────────────────────
prompt_tokens              →  promptTokens
completion_tokens          →  completionTokens
total_tokens               →  totalTokens
completion_tokens_details
  .reasoning_tokens        →  reasoningTokens
prompt_tokens_details
  .cached_tokens           →  cachedTokens

Anthropic 原始
─────────────────────────────────────────────────────────
input_tokens               →  promptTokens
output_tokens              →  completionTokens
input + output             →  totalTokens（计算得出）
cache_read_input_tokens    →  cacheReadTokens
cache_creation_input_tokens → cacheWriteTokens
```

归一化后的 `usage` 存入 `trace.usage`，同时**原始 usage 仍保留在 `response.body` 中**。

---

### 第 5 步：持久化（`writer.ts`）

Trace 完成后，整个 `TraceRecord` 对象以 JSON Lines 格式追写到磁盘：

```typescript
// writer.ts
const lines = batch.map(t => JSON.stringify(t)).join('\n') + '\n';
fs.appendFile(file, lines, callback);
```

文件命名规则：`traces-2026-06-17T03-00-00-000Z.jsonl`，超过 `maxFileSize`（默认 50MB）自动轮转。

---

### 第 6 步：推送前端（`ws/server.ts` + `App.tsx`）

Trace 完成时通过 WebSocket 广播：

```typescript
// 非流式：一次性推送完整 trace
ws.broadcast({ type: 'trace:new', data: trace });

// 流式：先推 trace:new（pending），再逐步 update
ws.broadcast({ type: 'trace:new',    data: trace });       // 首个 chunk 时
ws.broadcast({ type: 'trace:chunk',  data: { id, chunk } });// 每个 chunk
ws.broadcast({ type: 'trace:complete', data: { id, usage } });// 结束时
```

前端 `App.tsx` 接收并维护 Trace 列表，点击后由 `TraceDetail.tsx` 渲染。

---

## 三、TraceRecord 完整结构

一条 Trace 记录包含两类字段：

### 原始字段（来自 LLM 请求/响应，Raw JSON 面板展示这部分）

```typescript
{
  request: {
    method: string,           // HTTP 方法
    path: string,             // 请求路径
    headers: Record<string, string>,  // 请求头（API Key 已脱敏）
    body: {                   // 完整请求体，原样存储
      model: string,
      messages: ChatMessage[],
      tools?: ToolDefinition[],
      stream?: boolean,
      temperature?: number,
      // ...其余字段全部保留
    }
  },
  response: {
    status: number,           // HTTP 状态码
    headers: Record<string, string>,  // 响应头
    body: unknown,            // 完整响应体（非流式原样，流式重建）
    chunks?: RawChunk[],      // 流式模式下的原始 SSE chunks
  }
}
```

### LPT 归集字段（LPT 自身添加，不属于 LLM 原始数据）

```typescript
{
  id: string,               // LPT 生成的 UUID
  timestamp: string,        // 请求开始时间
  provider: string,         // 识别出的 Provider（openai / anthropic）
  model: string,            // 从请求体提取的 model 名称
  status: TraceStatus,      // pending / streaming / completed / error
  duration: number,         // 总耗时（ms）
  ttfb: number,             // Time To First Byte（ms）
  toolCalls?: ToolCallRecord[],  // 从响应体提取 + 参数反序列化后的工具调用列表
  usage?: TokenUsage,       // 从 response.body.usage 归一化后的 token 数据
  error?: { code, message },    // 错误信息（仅出错时）
  sourceFile?: string,      // 来自哪个 JSONL 文件（历史记录加载时附加）
}
```

---

## 四、Raw JSON 面板展示的内容

`TraceDetail.tsx` 中 Raw JSON 面板**只展示原始数据**：

```typescript
const rawJson = { request: trace.request, response: trace.response };
<JsonTree data={rawJson} />
```

这确保了：
- ✅ 展示的是**真实的 LLM 请求体和响应体**，无任何 LPT 加工
- ✅ 可以直接复制出来用于复现请求、调试 prompt
- ❌ 不包含 `toolCalls`、`usage`、`duration` 等 LPT 归集字段（这些在其他面板展示）

---

## 五、流式 vs 非流式的 response.body 差异

| | 非流式（`stream: false`） | 流式（`stream: true`） |
|---|---|---|
| `response.body` 来源 | 上游返回的原始 JSON，直接存储 | LPT 从 SSE chunks 重建的 JSON（格式与非流式相同） |
| `response.chunks` | 无 | 有，每个元素是一段原始 SSE 文本 |
| 结构 | OpenAI: `{choices:[{message:{content,...}}]}` | 同左（重建后一致） |
| 时效性 | 完成后一次性获得 | 流结束后重建，期间 UI 实时更新 |

流式重建的目的是**让前端渲染逻辑统一**：无论哪种模式，`TraceDetail.tsx` 都从 `response.body` 读取内容，不需要区分是否流式。

---

## 六、数据分叉点汇总

以下是同一份数据被"分叉"存储在不同位置的关键节点：

```
上游 LLM 响应
    │
    ├──► response.body.usage（原始 usage 字段，如 prompt_tokens）
    │         └──► trace.usage（LPT 归一化，如 promptTokens）
    │
    ├──► response.body.choices[0].message.tool_calls（原始字符串参数）
    │         └──► trace.toolCalls（LPT 解析，arguments 是对象不是字符串）
    │
    └──► response.body（原样，Raw JSON 展示此字段）
              └──► TraceDetail.tsx 各面板从这里解析渲染内容
```

**设计原则**：原始数据永远保留在 `request` / `response` 中不变；LPT 归集字段是对原始数据的"视图层"处理，专为 UI 展示和检索优化，不替代原始数据。
