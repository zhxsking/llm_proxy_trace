# LLM Proxy Trace - 产品需求文档 (PRD)

## 1. 产品概述

### 1.1 产品名称
LLM Proxy Trace（简称 LPT）

### 1.2 产品定位
本地大模型代理工具，在本机启动一个轻量代理服务，拦截并透明转发所有 LLM API 请求，同时捕获完整 Trace 并通过 Web 面板实时展示。

**单进程、单端口**：代理 + API + WebSocket + 前端静态文件全部运行在同一个 Hono HTTP 服务器（默认 `localhost:9527`），无需额外部署。

### 1.3 目标用户
- 本地开发/调试 LLM 应用的开发者
- 需要观测 LLM 调用链路、Token 用量、工具调用的团队
- 对 LLM 交互过程有审计/回溯需求的场景

### 1.4 核心价值
- **零侵入**：只需修改 API Base URL 指向本地代理，无需改动应用代码
- **全链路 Trace**：记录请求、响应、工具调用、流式 Token、thinking 内容等完整链路
- **实时可视化**：Web 面板实时展示调用详情，支持流式响应逐字显示
- **多提供商支持**：OpenAI / Anthropic / Ollama / vLLM / 自定义兼容 API

---

## 2. 功能需求

### 2.1 代理核心 (Proxy Core)

| ID | 功能 | 优先级 | 状态 | 描述 |
|----|------|--------|------|------|
| P01 | HTTP 代理转发 | P0 | ✅ | 接收客户端请求，转发至配置的上游 LLM 提供商，返回响应 |
| P02 | SSE 流式透传 | P0 | ✅ | 支持 SSE (Server-Sent Events) 流式响应的实时透传与 Trace 记录 |
| P03 | 多提供商路由 | P0 | ✅ | 根据请求路径/模型名自动路由到对应提供商 |
| P04 | 模型列表代理 | P0 | ✅ | 代理 /v1/models 接口，返回聚合后的模型列表 |
| P05 | 请求/响应拦截 | P0 | ✅ | 在转发前后拦截请求与响应，提取 Trace 数据 |
| P06 | 错误兜底 | P1 | ✅ | 上游超时/错误时返回规范错误信息，记录失败 Trace |
| P07 | 重试机制 | P2 | ⬜ | 可配置的请求重试策略（次数、间隔） |

### 2.2 提供商管理 (Provider Management)

| ID | 功能 | 优先级 | 状态 | 描述 |
|----|------|--------|------|------|
| PR01 | 提供商配置 | P0 | ✅ | 配置提供商名称、Base URL、API Key、类型(OpenAI/Anthropic/Ollama/Custom) |
| PR02 | 模型自动发现 | P0 | ✅ | 调用提供商 /models 接口获取可用模型列表 |
| PR03 | 模型缓存 | P1 | ✅ | 缓存模型列表，可配置刷新间隔（默认 5 分钟） |
| PR04 | 多提供商聚合 | P1 | ✅ | 聚合多个提供商的模型列表，统一通过代理访问 |
| PR05 | 提供商启停 | P1 | ✅ | 可单独启用/禁用某个提供商 |
| PR06 | API Key 加密存储 | P1 | ✅ | API Key 本地 AES-256-GCM 加密存储，界面掩码显示 |

### 2.3 Trace 日志系统 (Trace System)

| ID | 功能 | 优先级 | 状态 | 描述 |
|----|------|--------|------|------|
| T01 | 请求快照记录 | P0 | ✅ | 记录完整请求：URL、Method、Headers(脱敏)、Body |
| T02 | 响应快照记录 | P0 | ✅ | 记录完整响应：Status、Headers、Body |
| T03 | 流式响应记录 | P0 | ✅ | 捕获 SSE 流每个 chunk，拼接完整响应并记录 |
| T04 | 工具调用追踪 | P0 | ✅ | 解析响应中的 tool_calls，记录工具名、参数、返回结果 |
| T05 | Token 用量统计 | P0 | ✅ | 从响应中提取 usage，记录 prompt/completion/total tokens |
| T06 | 耗时统计 | P0 | ✅ | 记录请求开始/结束时间，计算 TTFB 和总耗时 |
| T07 | thinking 内容捕获 | P1 | ✅ | 捕获模型思考过程（reasoning_content / thinking block） |
| T08 | 日志持久化 | P1 | ✅ | JSONL 格式写入本地文件 |
| T09 | 敏感信息脱敏 | P1 | ✅ | API Key、Authorization Header 等自动脱敏 |
| T10 | 日志搜索 | P2 | ✅ | 按模型/关键词搜索 Trace 记录 |

### 2.4 Web 监控面板 (Web Dashboard)

| ID | 功能 | 优先级 | 状态 | 描述 |
|----|------|--------|------|------|
| W01 | 调用列表 | P0 | ✅ | 时间线展示所有调用记录，显示模型、状态、耗时、Token 数 |
| W02 | 调用详情 | P0 | ✅ | 展示单次调用的完整信息：提示词、响应、工具调用、Token 用量 |
| W03 | 实时推送 | P0 | ✅ | WebSocket 实时推送新调用通知和流式响应增量 |
| W04 | 流式响应实时显示 | P0 | ✅ | 流式响应逐字/逐 chunk 实时显示在详情页 |
| W05 | 提示词展示 | P0 | ✅ | 按角色(system/user/assistant/tool)分块展示消息列表 |
| W06 | 响应 Markdown 渲染 | P0 | ✅ | 模型响应支持 Markdown 渲染，含原文/渲染切换 |
| W07 | 工具调用展示 | P0 | ✅ | 展示工具调用链：工具名、输入参数(JSON)、输出结果 |
| W08 | 模型/状态筛选 | P1 | ✅ | Header 模型 chip 筛选，侧边栏状态筛选 |
| W09 | 配置管理面板 | P1 | ✅ | Web 端管理提供商配置、代理设置 |
| W10 | 暗色/亮色主题 | P1 | ✅ | 可切换，默认跟随系统，localStorage 持久化 |
| W11 | 侧边栏宽度调整 | P1 | ✅ | 鼠标拖拽调整左侧列表宽度 |
| W12 | thinking 块展示 | P1 | ✅ | 折叠式展示模型思考过程 |

---

## 3. 非功能需求

| 类别 | 需求 | 指标 |
|------|------|------|
| 性能 | 代理转发延迟增加 | < 10ms（非流式） |
| 性能 | 流式透传首字节延迟 | < 5ms |
| 性能 | Trace 写入不阻塞响应 | 异步写入 |
| 可靠性 | 代理服务可用性 | 99.9% |
| 安全 | API Key 不明文存储 | AES-256-GCM 加密 |
| 安全 | API Key 不出现在 Trace 中 | 自动脱敏 |
| 兼容 | OpenAI API 兼容 | /v1/chat/completions, /v1/models |
| 兼容 | Anthropic API 兼容 | /v1/messages |
| 兼容 | Ollama API 兼容 | /api/chat, /api/generate |
| 存储 | Trace 内存驻留 | 最近 1000 条 LRU |
| 存储 | JSONL 持久化 | 追写文件，支持轮转 |

---

## 4. 用户交互流程

### 4.1 首次使用
1. 启动 LPT 服务 → 自动打开 Web 面板（`localhost:9527`）
2. 在配置面板添加提供商（URL + API Key）
3. LPT 自动获取模型列表
4. 将应用的 `OPENAI_BASE_URL` 改为 `http://localhost:9527/v1`
5. 正常使用应用，LPT 自动记录 Trace

### 4.2 日常使用
1. 启动 LPT → Web 面板实时显示调用
2. 点击调用记录 → 查看详情（提示词/响应/工具/Token）
3. 流式响应实时逐字显示
4. 按模型/状态筛选历史调用
5. 原文/渲染视图切换查看消息内容

---

## 5. 配置文件格式

```yaml
# lpt.config.yaml
proxy:
  port: 9527
  logLevel: info

providers:
  - name: my-openai
    type: openai
    baseUrl: https://api.openai.com
    apiKey: enc:...  # AES-256-GCM 加密，由程序自动加密写入
    enabled: true

trace:
  dir: ./traces
  maxFileSize: 50MB
  maxAge: 7d
  sanitizeKeys: true

dashboard:
  autoOpen: true
```

---

## 6. 里程碑（已完成）

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | 代理核心 + 单提供商转发 | ✅ |
| M2 | Trace 记录 + 日志持久化 | ✅ |
| M3 | Web 面板基础版（调用列表 + 详情） | ✅ |
| M4 | 实时推送 + 流式显示 | ✅ |
| M5 | 多提供商 + 配置管理 UI | ✅ |
| M6 | 暗色主题 + 筛选 + 本地字体 + 文档 | ✅ |
