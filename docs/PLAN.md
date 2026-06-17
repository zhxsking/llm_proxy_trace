# LLM Proxy Trace - 开发规划

## 总体策略

自底向上、逐层构建，每个阶段完成后立即验证可用性。

---

## 阶段进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | 项目基础搭建（骨架、配置、加解密） | ✅ |
| Phase 2 | 代理核心（OpenAI/Anthropic/Ollama 适配器） | ✅ |
| Phase 3 | Trace 系统（收集、持久化、脱敏） | ✅ |
| Phase 4 | WebSocket 实时推送 | ✅ |
| Phase 5 | Web 面板（列表 + 详情 + 设置） | ✅ |
| Phase 6 | 多提供商 + 配置管理 UI | ✅ |
| Phase 7 | 暗色主题 + 筛选过滤 + 本地字体 + 文档 | ✅ |
| Phase 8 | 代码整理：删除死代码、统一 CSS 方案 | ✅ |

---

## 已完成功能清单

### 后端
- [x] Hono 单端口服务（代理 + API + WS + 静态文件）
- [x] 多提供商路由（OpenAI / Anthropic / Ollama / Custom）
- [x] SSE 流式透传（chunk 积累、tool_call 拼接、thinking_content 捕获）
- [x] Trace 收集器（内存 LRU 1000 条 + JSONL 持久化）
- [x] 敏感信息脱敏（Authorization / API Key）
- [x] API Key AES-256-GCM 加密存储
- [x] WebSocket 服务（100 条缓冲、自动重连、断连清理）
- [x] 完整管理 API（traces / providers / config / stats）

### 前端
- [x] 单页应用（无路由框架，状态全在 App.tsx）
- [x] 实时 WebSocket 订阅 + 自动重连
- [x] TraceSidebar：调用列表、状态/模型筛选、排序
- [x] TraceDetail：消息渲染、ThinkingBlock、ToolCallBlock、TokenBar、复制按钮
- [x] 原文 / Markdown 渲染切换（TextWithToggle）
- [x] SettingsPanel：提供商 CRUD
- [x] 暗色/亮色主题切换（CSS Variables，跟随系统）
- [x] 侧边栏宽度拖拽调整
- [x] 本地字体（Inter + JetBrains Mono，无 CDN 依赖）

---

## 待办 / 未来规划

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P2 | 日志轮转 | 单文件 > 50MB 自动轮转 |
| P2 | 请求重试 | 可配置重试策略 |
| P3 | 统计概览 | 调用量趋势、平均延迟图表 |
| P3 | 多轮对话关联 | 通过 Trace ID 关联多轮请求 |

---

## 断点恢复

每个阶段完成后 git commit（中文消息）。恢复时查看 `git log` 确定最后完成的阶段。

当前 git 状态：`master` 分支，项目已稳定可用。
