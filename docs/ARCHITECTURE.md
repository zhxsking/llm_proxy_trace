# LPT 架构说明

## 系统架构

```
┌─────────────────────────────────────────┐
│           LLM 应用（你的代码）              │
│  base_url = http://localhost:9527/v1    │
└──────────────────┬──────────────────────┘
                   │ HTTP / SSE
                   ▼
┌─────────────────────────────────────────┐
│            Hono 代理服务器                 │
│                                         │
│  /v1/*  →  handler.ts  →  upstream LLM  │
│  /api/* →  routes.ts   (管理 API)         │
│  /*     →  static.ts   (前端 SPA)         │
│                                         │
│  ┌──────────┐   ┌─────────────────────┐  │
│  │ stream.ts │   │  ProviderRegistry  │  │
│  │ SSE 透传  │   │  提供商路由 + 模型   │  │
│  └────┬─────┘   └─────────────────────┘  │
│       │                                 │
│  ┌────▼──────────────┐                  │
│  │  TraceCollector   │                  │
│  │  内存 + JSONL 持久化 │                  │
│  └────┬──────────────┘                  │
│       │                                 │
│  ┌────▼──────┐                          │
│  │ WSServer  │  广播 trace:new / update  │
│  └────┬──────┘                          │
└───────┼─────────────────────────────────┘
        │ WebSocket /ws
        ▼
┌─────────────────────────────────────────┐
│          React Web Dashboard            │
│                                         │
│  App.tsx                                │
│  ├── TraceSidebar  （请求列表）             │
│  ├── TraceDetail   （详情 + Markdown）     │
│  └── SettingsPanel （提供商配置）           │
└─────────────────────────────────────────┘
```

---

## 数据流

### 流式请求（stream=true）

```
客户端                LPT                   上游
  │                    │                     │
  │── POST /v1/chat ──►│                     │
  │                    │── POST (fetch) ────►│
  │                    │◄── SSE chunks ──────│
  │                    │  ┌─ collector.start()
  │                    │  │  积累 chunks
  │                    │  │  ws.broadcast(trace:update)
  │◄── SSE chunk ──────│  └─ controller.enqueue()
  │        ...         │        ...          │
  │                    │◄── [DONE] ──────────│
  │                    │  ┌─ collector.complete()
  │                    │  │  写入 JSONL
  │                    │  └─ ws.broadcast(trace:update)
```

### 非流式请求

```
客户端          LPT              上游
  │              │                │
  │── POST ─────►│── POST ───────►│
  │              │◄─ JSON ────────│
  │              │ collector.complete()
  │◄─ JSON ──────│
```
