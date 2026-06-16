# Changelog

## v1.3.2 (2026-06-16)

### 修复
- 清除所有残留 Ollama 相关文档内容（AGENTS.md、README.md、docs/）
- AGENTS.md 新增「发布版本必须同步更新 CHANGELOG」规则

---

## v1.3.1 (2026-06-16)

### 修复
- 清除旧版构建产物中残留的 `dist/server/providers/ollama.*` 文件

---

## v1.3.0 (2026-06-16)

### 变更
- **移除 Ollama 支持**：删除 `OllamaProvider`，去掉 `/api/chat`、`/api/generate`、`/api/tags` 路由，清理 types / loader / routes 中所有 ollama 引用

---

## v1.2.8 (2026-06-15)

### 新增
- `llmpt claude` 模式下启动后自动打开浏览器 Dashboard

---

## v1.2.7 (2026-06-15)

### 修复
- `llmpt claude` 模式下静默所有后续 `console.log`，避免污染 Claude Code TUI 界面

---

## v1.2.6 (2026-06-15)

### 修复
- `claude --settings` 只接受文件路径，改回临时文件方案（文件名含 PID 避免冲突，claude 退出后自动删除）

---

## v1.2.5 (2026-06-15)

### 新增
- 启动时检查端口占用（同时探测 IPv4/IPv6），占用时打印 `netstat`/`lsof` 查找命令后退出

---

## v1.2.4 (2026-06-15)

### 修复
- `llmpt claude` 现在先启动 LPT 服务，再 spawn Claude Code；Claude 退出后服务一并关闭

---

## v1.2.3 (2026-06-15)

### 新增
- `llmpt claude [...args]` 子命令：通过 `--settings` 临时文件注入 `ANTHROPIC_BASE_URL`，让 Claude Code 流量过代理

---

## v1.2.2 (2026-06-15)

### 修复
- Auth header 透传：provider 未配置 `apiKey` 时，将请求中的 `x-api-key` / `authorization` 转发给上游
- 同时透传 `anthropic-*` 头（如 `anthropic-beta`）

---

## v1.2.1 (2026-06-15)

### 修复
- Anthropic 非流式响应 token 解析：使用 `input_tokens`/`output_tokens` 而非 OpenAI 字段名
- Anthropic 流式 SSE 解析：处理 `content_block_delta` 事件（`text_delta`/`thinking_delta`）

---

## v1.2.0 (2026-06-15)

### 修复
- 流式响应错误状态：上游返回 4xx/5xx 时不再走 SSE 路径，统一进入 error 分支记录

---

## v1.1.9 (2026-06-15)

### 变更
- `.env.example` 所有值改为注释状态，用户需主动填入才能生效

---

## v1.1.3 (2026-06-15)

### 新增
- `resolveEnvPath`：优先读 `cwd/.env`，其次 `AppData/llmpt/.env`，不存在时从 `.env.example` 自动生成
- `resolveConfigPath`：同优先级逻辑解析 `lpt.config.yaml`
- `traces` 目录若仍为默认 `./traces`，自动重定向到 `AppData/llmpt/traces`
- 启动日志精简为三行：🚀 启动中 / ✅ 已启动 / 📝 配置路径

---

## v1.1.0 (2026-06-15)

### 新增

- **Thinking 内联展示**：响应区域的 Thinking 内容不再独立成一个顶层 Section，改为嵌在 Response Section 内部顶部，以折叠块形式展示（默认收起），与 messages 历史中的 ThinkingBlock 风格一致
- **Thinking Markdown 渲染**：Thinking 折叠块展开后支持「原文 / 渲染」切换，渲染模式走 react-markdown，修复了因父容器 `.content-block` 的 `white-space: pre-wrap` 继承导致空行堆积的问题
- **Thinking 复制按钮**：hover 到 Thinking 标题行时出现复制按钮，固定在行尾右侧
- **自定义 ConfirmDialog**：替换浏览器原生 `window.confirm`，所有删除确认操作改为居中精美弹窗，支持 Esc 取消、Enter 确认、毛玻璃遮罩、弹出动画

### 优化

- Thinking 标题行三角符号与文字间距加宽
- Thinking 展开时 toggle 按钮（原文/渲染）与标题同行，不再另起一行
- 去掉 Thinking 标题行的行数统计（`N 行`）信息，界面更简洁

---

## v1.0.0 (2026-06-14)

初始发布。

- 单进程单端口代理服务（默认 19900）
- 支持 OpenAI / Anthropic 两类 Provider
- 实时 WebSocket 推送，Trace 列表自动更新
- Trace 详情：System Prompt、Messages、Response、Tool Calls、Raw JSON
- Markdown 渲染（react-markdown + highlight.js 代码高亮）
- Token 用量栏（prompt / completion / reasoning / cache）
- 深色 / 浅色主题切换
- Trace JSONL 持久化，重启可恢复历史
- AES-256-GCM API Key 加密存储
