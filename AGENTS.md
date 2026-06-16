# AGENTS.md — LPT 项目 AI 协作指南

本文件为 AI Agent（Cursor、Claude、Copilot 等）提供项目上下文，帮助快速理解代码库并减少误操作。

---

## 项目简介

**LPT（LLM Proxy Trace）** 是一个本地 LLM 代理工具，将请求从 LLM 客户端透明转发到真实 Provider（OpenAI / Anthropic 等），同时捕获完整 Trace 并通过 Web 面板实时展示。

- **单进程、单端口**：代理 + API + WebSocket + 前端静态文件全部运行在同一个 Hono HTTP 服务器（默认 `localhost:19900`）
- **无外部数据库**：Trace 用内存 Map 存储，异步追写 JSONL 文件持久化
- **字体离线**：使用系统默认字体栈，无需 CDN

---

## 技术栈速查

| 层 | 技术 | 关键文件 |
|----|------|---------|
| 后端运行时 | Node.js 18+ + TypeScript | `tsconfig.json` |
| 后端框架 | Hono | `src/server/app.ts` |
| 前端框架 | React 18 + Vite | `src/web/vite.config.ts` |
| 样式 | CSS Variables（主题）+ Tailwind（布局 utility） | `src/web/index.css`, `src/web/tailwind.config.cjs` |
| 实时通信 | WebSocket (`ws` 库) | `src/server/ws/server.ts` |
| 配置格式 | YAML (`js-yaml`) | `lpt.config.yaml` |
| 加密 | Node.js crypto AES-256-GCM | `src/server/config/crypto.ts` |

> **样式说明**：所有颜色、主题、组件样式使用 CSS Variables（`index.css`）；布局工具类（flex/grid/gap/padding等）使用 Tailwind 生成。Tailwind 颜色扩展已清空，不与 CSS Variables 冲突。

---

## 目录结构

```
lpt/
├── README.md                    # 用户文档（快速开始、配置、API）
├── AGENTS.md                    # 本文件
├── lpt.config.yaml              # 运行时配置（端口、提供商、Trace 设置）
├── package.json                 # npm scripts: dev / build / typecheck
├── tsconfig.json                # TypeScript 配置（target ES2022, bundler resolution）
├── .gitignore
├── scripts/
│   ├── start.bat / start.sh     # 一键启动脚本
│   ├── dev.bat                  # Windows 开发模式
│   └── test_llm.py              # Python 端对端测试（需要真实 API Key）
├── docs/
│   ├── PRD.md                   # 产品需求文档（含完成状态）
│   ├── PLAN.md                  # 开发规划（历史/进度）
│   ├── TECHNICAL.md             # 技术方案
│   ├── ARCHITECTURE.md          # 系统架构详述
│   └── DEVELOPMENT.md           # 开发工作流、构建命令、FAQ
└── src/
    ├── index.ts                 # CLI 入口
    └── server/
    │   ├── app.ts               # Hono 应用组装（注册所有路由和中间件）
    │   ├── types.ts             # 所有共享类型（TraceRecord / AppConfig / WSEvent 等）
    │   ├── static.ts            # dist/web 静态文件服务 + SPA fallback
    │   ├── proxy/
    │   │   ├── handler.ts       # 代理入口：Provider 匹配、Trace 创建、错误处理
    │   │   └── stream.ts        # SSE 流透传：chunk 积累、tool_call 拼接、usage 解析
    │   ├── providers/
    │   │   ├── registry.ts      # Provider 注册、路由、模型列表刷新
    │   │   ├── base.ts          # BaseProvider 抽象基类
    │   │   ├── openai.ts        # OpenAI 适配器
    │   │   └── anthropic.ts     # Anthropic 适配器
    │   ├── trace/
    │   │   ├── collector.ts     # 内存 Map + LRU 驱逐 + 写回调
    │   │   ├── writer.ts        # 异步 JSONL 追写、文件轮转
    │   │   └── sanitizer.ts     # 替换 Authorization 等敏感 Header
    │   ├── ws/
    │   │   └── server.ts        # WSServer：100 条缓冲、广播、自动清理断连
    │   ├── config/
    │   │   ├── loader.ts        # YAML 加载/保存、默认值深合并
    │   │   └── crypto.ts        # AES-256-GCM 加解密工具
    │   └── api/
    │       └── routes.ts        # /api/* 路由：traces / providers / config / stats
    └── web/                     # React 前端（Vite 构建 → dist/web）
        ├── App.tsx              # 根组件：WebSocket 订阅、Trace 状态、主题切换
        ├── index.css            # 全局样式 + CSS Variables 主题（Light/Dark）
        ├── tailwind.config.cjs  # Tailwind 配置（仅 utility 用，无颜色覆盖）
        ├── components/
        │   ├── TraceSidebar.tsx # 左侧列表：排序、状态筛选、model badge
        │   ├── TraceDetail.tsx  # 右侧详情：TokenBar、消息、响应、ToolCall
        │   └── SettingsPanel.tsx # 提供商配置面板
        ├── hooks/
        │   └── useWebSocket.ts  # 自动重连 WebSocket hook
        └── lib/
            └── api.ts           # fetch 封装 + API 类型
```

---

## 核心数据类型

所有类型定义在 `src/server/types.ts`，前端通过 `src/web/lib/api.ts` 重新导出。

```typescript
interface TraceRecord {
  id: string;
  timestamp: string;        // ISO 8601
  provider: string;
  model: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  duration: number;         // ms（完成后才有值）
  ttfb: number;             // Time To First Byte（ms）
  request: { method, path, headers, body };
  response: { status, headers, body, chunks? };
  toolCalls?: ToolCallRecord[];
  usage?: { promptTokens, completionTokens, totalTokens };
  error?: { code: string; message: string };
}

// WebSocket 事件
type WSEvent =
  | { type: 'trace:new';    data: TraceRecord }
  | { type: 'trace:update'; data: Partial<TraceRecord> & { id: string } }
  | { type: 'connected';    data: { buffered: number } };
```

---

## 常用命令

```bash
npm run dev          # 后端开发（tsx watch，文件变动自动重启）
npm run dev:web      # 前端开发（Vite HMR）
npm run build        # 完整构建（tsc + vite build）
npm run build:web    # 仅构建前端
npm run typecheck    # TypeScript 类型检查（不输出文件）
```

---

## 路由规则

| 优先级 | 路径 | 处理器 | 说明 |
|--------|------|--------|------|
| 1 | `/api/*` | `routes.ts` | 管理 API，必须在代理路由之前注册 |
| 2 | `/health` | inline | 健康检查 |
| 3 | `/v1/models`, `/models` | `handleModels` | 模型列表 |
| 4 | `POST /v1/chat/completions` 等 | `handleProxy` | 代理转发 |
| 5 | `/v1/*` catch-all | `handleProxy` | 兜底代理 |
| 6 | `*` | `serveStaticFiles` | 前端 SPA（含 fallback） |

> **重要**：`/api/*` 管理路由必须注册在代理 catch-all 之前。

---

## 前端状态流

```
WebSocket 事件
  trace:new    → App.tsx setTraces(prev => [newTrace, ...prev])
  trace:update → App.tsx setTraces(prev => prev.map(t => t.id===id ? merge(t,update) : t))

用户操作
  点击侧边栏条目  → setSelectedId(id)
  切换主题       → document.documentElement.setAttribute('data-theme', 'dark'|'light')
                   localStorage.setItem('lpt-theme', theme)
  模型筛选 chip  → setModelFilter(model)
  清空          → DELETE /api/traces → setTraces([])
```

---

## 注意事项 / 易错点

1. **路由顺序**：`/api/*` 管理路由必须在 `app.ts` 中最先注册，否则会与代理 catch-all 冲突。

2. **流式响应积累**：`stream.ts` 对每个 SSE chunk 都调用 `collector.update()`，完成后调用 `collector.complete()`。修改流处理逻辑时注意不要破坏 `toolCalls` 的拼接逻辑（多个 chunk 合并 `function.arguments`）。

3. **CSS 方案**：颜色/主题用 CSS Variables（`var(--xxx)`，定义在 `index.css`），Light 在 `:root`，Dark 在 `[data-theme="dark"]`。布局工具类用 Tailwind 生成（`tailwind.config.cjs` 无颜色覆盖）。**不要**直接写 hardcode 颜色值，也不要用 Tailwind 颜色类（`text-blue-500` 等）。

4. **API Key 加密**：配置文件中的 `apiKey` 保存时自动加密为 `enc:xxx`，读取时自动解密。前端展示时用 `maskApiKey()` 替换为 `sk-***...`，不要在前端直接展示明文 key。

5. **TypeScript 构建**：`tsconfig.json` 的 `moduleResolution: bundler` 模式，导入路径需用 `.js` 扩展名（即使源文件是 `.ts`）。

7. **无 react-router**：前端无路由框架，所有状态在 `App.tsx`，组件树：App → TraceSidebar + TraceDetail + SettingsPanel（浮层）。

---

## 临时文件规范

AI Agent 在调试、验证过程中产生的**临时脚本、辅助文件**（如 `.py`、`.mjs`、`.sh` 工具脚本）必须放在 `tmp/` 目录下，不得散落在项目根目录。

- `tmp/` 已在 `.gitignore` 中忽略（`tmp/*`，保留 `tmp/.gitkeep`）
- 任务结束后及时清理，不留无用临时文件
- 截图等参考图片也放 `tmp/img/`

---

## Git 提交规范

- **使用中文提交注释**
- 格式：`<动词><内容>`，动词优先选：`新增`、`修复`、`重构`、`优化`、`删除`、`更新`、`整理`
- 示例：
  - `新增流式响应 thinking 内容支持`
  - `修复 tool_call 参数拼接错误`
  - `优化侧边栏排序性能`
  - `更新 README 快速开始章节`
  - `整理 scripts 目录`

---

## 新增功能检查清单

改动后请确认：

- [ ] `npm run typecheck` 无报错
- [ ] `npm run build:web` 构建成功
- [ ] 如涉及新 CSS class，在 `src/web/index.css` 中同时添加 Light 和 Dark 样式（用 `var(--xxx)` 引用颜色）
- [ ] 如涉及新 API 路由，在 `docs/DEVELOPMENT.md` 的 API 表格中更新
- [ ] 如涉及新配置字段，在 `src/server/types.ts` 更新类型，并在 `loader.ts` 的 `DEFAULT_CONFIG` 中添加默认值
- [ ] 提交信息使用中文
- [ ] **发布新版本时同步更新 `CHANGELOG.md`**，在顶部新增版本条目，记录新增 / 修复 / 变更内容
