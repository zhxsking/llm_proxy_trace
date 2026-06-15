# LPT — LLM Proxy Trace

> 本地 LLM 代理工具，零侵入地拦截并可视化所有 OpenAI / Anthropic / Ollama API 调用

```
你的应用  ──►  http://localhost:19900  ──►  真实 LLM Provider
                        │
                        ▼
             Web Dashboard（实时 Trace 监控）
```

---

## 功能特性

- **零侵入代理** — 只需把 `base_url` 改为 `http://localhost:19900`，无需修改任何应用代码
- **实时流式追踪** — WebSocket 推送，实时响应
- **完整 Trace 记录** — 请求体、响应体、思考链（thinking）、Tool Call、Token 用量全记录
- **Markdown 渲染** — 响应内容支持原文 / Markdown 双视图，代码块语法高亮
- **Token 用量统计** — 输入/输出/推理/缓存命中 Token 分项展示，实时速度统计

---

## 快速开始

### 方式一：npx 一键启动（推荐）

无需安装，直接运行：

```bash
npx llmpt
```

### 方式二：全局安装

```bash
npm install -g llmpt
llmpt
```

启动后浏览器打开 `http://localhost:19900`。

---

## 与 Claude Code 集成

`llmpt claude` 是为 Claude Code 专门设计的一键命令——自动启动 LPT 代理服务，再拉起 Claude Code 并将其流量路由过来，全程无需手动改任何配置：

```bash
# 等同于 claude，但所有请求都会被 LPT 拦截记录
npx llmpt claude

# 传递 claude 参数
npx llmpt claude --model claude-opus-4-5
npx llmpt claude -c                        # 继续上次会话
npx llmpt claude --dangerously-skip-permissions
```

启动时会打印两行状态，之后完全静默（不污染 Claude Code 的 TUI 界面）：

```
🚀 LPT 启动中...
✅ LPT 代理已就绪：http://localhost:19900
🔍 启动 claude (interactive)
```

退出 Claude Code 后，LPT 服务也会自动关闭。

> **实现原理**：通过 `claude --settings <tempfile>` 向 Claude Code 注入 `ANTHROPIC_BASE_URL`，使其将 API 请求发往本地代理。无需修改任何全局配置文件。

---

## 配置

首次运行会在系统配置目录自动生成 `.env`，并打印出文件路径。编辑该文件填入 `BASE_URL` 和 `API Key` 后，重启服务即可生效。

如果当前目录存在 `.env`，会优先使用当前目录的配置，修改后重启服务生效。

---

## 接入其他客户端

将 LLM SDK 的 `base_url` 指向本地代理，其余配置保持不变：

**Python（OpenAI SDK）**
```python
from openai import OpenAI
client = OpenAI(
    base_url="http://localhost:19900/v1",
    api_key="any",   # 代理会替换为 .env 中的真实 key
)
```

**环境变量（适用于大多数客户端）**
```bash
OPENAI_BASE_URL=http://localhost:19900/v1
OPENAI_API_KEY=any

# Anthropic
ANTHROPIC_BASE_URL=http://localhost:19900
```

---

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Node.js 18+ |
| 语言 | TypeScript 5.x |
| 后端框架 | [Hono](https://hono.dev) |
| 前端框架 | React 18 + Vite 6 |
| 样式 | CSS Variables + Tailwind CSS |
| 字体 | 系统默认字体栈 |
| 实时通信 | WebSocket (`ws`) |
| Markdown | react-markdown + remark-gfm + highlight.js |
| 配置 | dotenv (.env) |
| 加密 | Node.js crypto（AES-256-GCM） |

---

## 致谢

界面设计和 Trace 展示风格参考了 [claude-tap](https://github.com/liaohch3/claude-tap) 项目。

---

## License

MIT
