# LLM Proxy Trace - 技术方案

## 1. 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Node.js | >= 18 | 原生 SSE/WebSocket 支持 |
| 语言 | TypeScript | 5.x | 类型安全，bundler 模块解析 |
| 后端框架 | Hono | latest | 轻量高性能，TypeScript 原生 |
| 前端框架 | React | 18.x | 组件化，Hooks |
| 前端构建 | Vite | 5.x | 极速 HMR，原生 ESM |
| 样式 | CSS Variables | - | 纯 CSS 自定义属性，无运行时依赖 |
| Markdown | react-markdown + remark-gfm | - | 响应渲染 + GFM 扩展 |
| 实时通信 | WebSocket (ws) | 8.x | 低延迟双向通信 |
| 配置 | js-yaml | - | 人类可读配置格式 |
| 加密 | Node.js crypto | - | API Key AES-256-GCM 加密 |
| 包管理 | npm | - | 标准 npm |

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    LLM Application                       │
│           OPENAI_BASE_URL=http://localhost:9527/v1        │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / SSE
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Proxy Server (Hono · port 9527)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Request  │→ │ Provider  │→ │ Upstream LLM Provider│  │
│  │ Intercept│  │ Router    │  │ (OpenAI/Anthropic/…) │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Response │← │ SSE      │← │ Stream Proxy          │  │
│  │ Intercept│  │ Handler  │  │ (chunk-by-chunk)      │  │
│  └──────────┘  └──────────┘  └──────────────────────┘  │
└──────────┬─────────────────────────────┬────────────────┘
           │                             │
           ▼                             ▼
┌──────────────────────┐  ┌─────────────────────────────┐
│   Trace System       │  │   WebSocket Server           │
│  Collector (memory)  │  │   Broadcaster                │
│  Writer (JSONL)      │  │   (trace:new / trace:update) │
│  Sanitizer           │  └──────────────┬──────────────┘
└──────────────────────┘                 │ WS
                                         ▼
                              ┌──────────────────────────┐
                              │   Web Dashboard (React)  │
                              │   TraceSidebar           │
                              │   TraceDetail            │
                              │   SettingsPanel          │
                              └──────────────────────────┘
```

---

## 3. 目录结构

```
lpt/
├── README.md
├── AGENTS.md                    # AI 协作指南
├── PLAN.md                      # 开发规划（历史/进度）
├── lpt.config.yaml              # 运行时配置
├── package.json
├── tsconfig.json
├── scripts/
│   ├── start.bat / start.sh     # 一键启动脚本
│   ├── dev.bat                  # Windows 开发模式
│   ├── test.mjs                 # 后端 API 全量测试
│   ├── test-frontend.mjs        # 前端构建产物验证
│   ├── check-bundle.mjs         # JS bundle 检查
│   ├── test-server.mjs          # 最小化服务器启动测试
│   ├── test.config.yaml         # 测试用配置（port 9877）
│   └── test_llm.py              # Python 端对端测试
├── docs/
│   ├── PRD.md                   # 产品需求文档
│   ├── TECHNICAL.md             # 技术方案（本文件）
│   ├── ARCHITECTURE.md          # 架构详述
│   └── DEVELOPMENT.md           # 开发工作流
└── src/
    ├── index.ts                 # CLI 入口
    └── server/
    │   ├── app.ts               # Hono 应用组装（路由注册）
    │   ├── types.ts             # 所有共享类型
    │   ├── static.ts            # 静态文件服务 + SPA fallback
    │   ├── proxy/
    │   │   ├── handler.ts       # 代理入口：Provider 匹配、Trace 创建
    │   │   └── stream.ts        # SSE 流透传：chunk 积累、tool_call 拼接
    │   ├── providers/
    │   │   ├── registry.ts      # Provider 注册、路由、模型列表刷新
    │   │   ├── base.ts          # BaseProvider 抽象基类
    │   │   ├── openai.ts        # OpenAI 适配器
    │   │   └── anthropic.ts     # Anthropic 适配器
    │   ├── trace/
    │   │   ├── collector.ts     # 内存 Map + LRU 驱逐 + 写回调
    │   │   ├── writer.ts        # 异步 JSONL 追写
    │   │   └── sanitizer.ts     # 替换 Authorization 等敏感 Header
    │   ├── ws/
    │   │   └── server.ts        # WSServer：100 条缓冲、广播、断连清理
    │   ├── config/
    │   │   ├── loader.ts        # YAML 加载/保存、默认值深合并
    │   │   └── crypto.ts        # AES-256-GCM 加解密工具
    │   └── api/
    │       └── routes.ts        # /api/* 路由
    └── web/                     # React 前端（Vite → dist/web）
        ├── App.tsx              # 根组件：WebSocket 订阅、Trace 状态、主题切换
        ├── index.css            # 全局样式 + CSS Variables 主题（Light/Dark）
        ├── fonts/               # Inter.woff2 + JetBrains Mono woff2（离线）
        ├── components/
        │   ├── TraceSidebar.tsx # 左侧列表
        │   ├── TraceDetail.tsx  # 右侧详情
        │   └── SettingsPanel.tsx
        ├── hooks/
        │   └── useWebSocket.ts  # 自动重连 WebSocket hook
        └── lib/
            └── api.ts           # fetch 封装 + API 类型
```

---

## 4. 核心数据模型

```typescript
// src/server/types.ts
interface TraceRecord {
  id: string;
  timestamp: string;        // ISO 8601
  provider: string;
  model: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  duration: number;         // ms（完成后才有值）
  ttfb: number;             // Time To First Byte（ms）
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;  // 已脱敏
    body: Record<string, unknown>;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    chunks?: string[];
  };
  toolCalls?: ToolCallRecord[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: { code: string; message: string };
}

// WebSocket 事件
type WSEvent =
  | { type: 'trace:new';    data: TraceRecord }
  | { type: 'trace:update'; data: Partial<TraceRecord> & { id: string } }
  | { type: 'connected';    data: { buffered: number } };
```

---

## 5. 关键技术实现

### 5.1 代理转发

`proxy/handler.ts` → Provider 匹配 → 构建上游请求头（注入 API Key） → 判断是否流式：
- **非流式**：`await fetch` → 透传响应 + 记录 Trace
- **流式**：`proxy/stream.ts` → ReadableStream chunk-by-chunk 透传 + 积累 content/tool_call/thinking

### 5.2 SSE 流式透传

```
upstream SSE → TextDecoder → 按行解析 "data: {...}" → 
  积累 content delta (thinking_content / content)
  积累 tool_call arguments (多 chunk 拼接)
  每 chunk 调用 collector.update() → WS broadcast
  [DONE] → collector.complete() → 最终写 JSONL
```

### 5.3 Trace 持久化

- 内存维护最近 1000 条（LRU 驱逐）
- 异步追写 JSONL 文件（每行一条 JSON）
- 文件轮转：> 50MB 或超 7 天创建新文件

### 5.4 API Key 加密

密钥派生：`SHA-256(hostname + username + salt)` → AES-256-GCM 加密 → 存储为 `enc:base64`。运行时读取时自动解密，前端显示 `sk-***...`。

### 5.5 路由优先级

```
/api/*          → 管理 API（必须在代理之前注册）
/health         → 健康检查
/v1/models      → 聚合模型列表
POST /v1/chat/completions 等 → 代理转发
/v1/* catch-all → 代理转发
*               → 前端 SPA
```

> 注意：Ollama 的 `/api/chat` 路径与管理 API `/api/*` 共用前缀，顺序敏感。

---

## 6. API 接口

### 管理 API（`/api/*`）

| Method | Path | 说明 |
|--------|------|------|
| GET | /api/traces | 获取 Trace 列表（支持 keyword/limit/provider/model 筛选） |
| GET | /api/traces/:id | 获取单条 Trace 详情 |
| DELETE | /api/traces | 清空所有 Trace |
| GET | /api/providers | 获取提供商列表 |
| POST | /api/providers | 添加提供商 |
| PUT | /api/providers/:name | 更新提供商 |
| DELETE | /api/providers/:name | 删除提供商 |
| POST | /api/providers/:name/refresh | 刷新模型列表 |
| GET | /api/config | 获取当前配置 |
| PUT | /api/config | 更新配置 |
| GET | /api/stats | 获取统计信息 |

### WebSocket

```
ws://localhost:9527/ws
```

事件类型：`connected`、`trace:new`、`trace:update`

---

## 7. 样式方案

全量使用 **CSS Variables**（`src/web/index.css`），无运行时 CSS 框架依赖：

```css
:root {
  --bg: #f9fafb;
  --bg-card: #ffffff;
  --text: #111827;
  --blue: #3b82f6;
  /* ... */
}
[data-theme="dark"] {
  --bg: #0f1117;
  --bg-card: #161b27;
  --text: #e8eaf0;
  /* ... */
}
```

主题切换：`document.documentElement.setAttribute('data-theme', 'dark')`，状态存 `localStorage('lpt-theme')`。

---

## 8. 构建与运行

```bash
# 开发
npm run dev          # 后端 tsx watch
npm run dev:web      # 前端 Vite HMR

# 构建
npm run build        # tsc + vite build
npm run build:web    # 仅构建前端

# 验证
npm run typecheck    # TypeScript 类型检查
npm test             # 后端 API 全量测试
npm run test:frontend # 前端构建产物验证

# 一键启动（生产）
scripts/start.bat    # Windows
scripts/start.sh     # Linux/macOS
```
