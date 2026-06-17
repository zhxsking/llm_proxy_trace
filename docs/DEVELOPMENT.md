# LPT 开发指南

## 环境要求

| 工具 | 版本 |
|------|------|
| Node.js | 18+ |
| npm | 8+ |

## 安装

```bash
npm install
```

---

## 开发工作流

### 推荐方式（Windows）

```bat
scripts\dev.bat
```

会弹出两个终端窗口：
- **后端**（端口 9527）：`npx tsx watch src/index.ts` — 文件变动自动重启
- **前端**（Vite HMR）：`npx vite --config src/web/vite.config.ts` — 组件热替换

> 前端 Vite dev server 通过 proxy 配置将 `/api` 和 `/ws` 转发到后端，所以只需访问前端端口即可。

### 手动启动（跨平台）

```bash
# 终端 1
npm run dev

# 终端 2
npm run dev:web
```

---

## 构建

```bash
# 类型检查（不产生输出）
npm run typecheck

# 完整构建（TypeScript 编译 + Vite 前端打包）
npm run build

# 仅前端
npx vite build --config src/web/vite.config.ts

# 仅后端类型检查
npx tsc --noEmit
```

构建产物：
```
dist/
  index.js        # 后端（node dist/index.js 启动）
  web/
    index.html
    assets/
      index-*.js
      index-*.css
      inter-*.woff2
      jetbrains-mono-*.woff2
```

---

## 运行

### 开发（源码直接运行，无需构建）

```bash
npm run dev
# 等价于: npx tsx watch src/index.ts
```

### 生产（从构建产物运行）

```bash
npm run build   # 先构建
npm start       # node dist/index.js
```

### 一键脚本

```bash
# Linux / macOS
bash scripts/start.sh

# Windows
scripts\start.bat
```

> 脚本会自动检测 `dist/web/index.html` 是否存在，不存在则自动构建。

---

## 目录结构

```
src/
├── index.ts               # CLI 入口：加载配置、启动 HTTP、挂载 WebSocket
└── server/
    ├── app.ts             # 组装 Hono 应用，注册中间件和路由
    ├── types.ts           # TraceRecord、AppConfig、ProviderConfig 等类型
    ├── static.ts          # 服务 dist/web 静态文件（SPA fallback）
    ├── proxy/
    │   ├── handler.ts     # 代理入口：提供商匹配、Trace 创建、错误处理
    │   └── stream.ts      # SSE 流透传：chunk 积累、tool_call 拼接、usage 解析
    ├── providers/
    │   ├── registry.ts    # 注册、路由、模型列表刷新定时器
    │   ├── base.ts        # Provider 基类（buildRequest、parseModels）
    │   ├── openai.ts      # OpenAI 适配（/v1/chat/completions 等）
    │   └── anthropic.ts   # Anthropic 适配（/v1/messages）
    ├── trace/
    │   ├── collector.ts   # 内存 Map + LRU 驱逐 + WebSocket 回调触发
    │   ├── writer.ts      # 异步 JSONL 追写、文件轮转
    │   └── sanitizer.ts   # 替换敏感 Header 值为 ***
    ├── ws/
    │   └── server.ts      # ws.Server 封装：100 条事件缓冲、广播
    ├── config/
    │   ├── loader.ts      # YAML 加载/保存、默认值合并
    │   └── crypto.ts      # AES-256-GCM 加解密工具函数
    └── api/
        └── routes.ts      # /api/* 路由：traces、providers、config、stats

src/web/                   # React 前端
├── App.tsx                # 根组件：WebSocket 订阅、Trace 状态、主题、侧边栏
├── index.css              # CSS Variables 主题 + 全局样式
├── main.tsx               # React DOM 挂载点
├── components/
│   ├── TraceSidebar.tsx   # 请求列表：排序、筛选、model badge、进度指示
│   ├── TraceDetail.tsx    # 详情面板：TokenBar、Messages、Response、ToolCalls
│   └── SettingsPanel.tsx  # 提供商配置：添加/删除/启用
├── hooks/
│   └── useWebSocket.ts    # 自动重连、事件分发
├── fonts/
│   ├── inter.woff2        # Inter 字体（全字重 variable font）
│   └── jetbrains-mono-400.woff2
└── lib/
    └── api.ts             # fetch 封装：getTraces、getStats、addProvider 等
```
