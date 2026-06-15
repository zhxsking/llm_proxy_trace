# Changelog

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
- 支持 OpenAI / Anthropic / Ollama 三类 Provider
- 实时 WebSocket 推送，Trace 列表自动更新
- Trace 详情：System Prompt、Messages、Response、Tool Calls、Raw JSON
- Markdown 渲染（react-markdown + highlight.js 代码高亮）
- Token 用量栏（prompt / completion / reasoning / cache）
- 深色 / 浅色主题切换
- Trace JSONL 持久化，重启可恢复历史
- AES-256-GCM API Key 加密存储
