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

### 安装依赖

```bash
npm install
```

### 启动

**Windows:**
```bat
scripts\start.bat
```

**Linux / macOS:**
```bash
bash scripts/start.sh
```

启动后浏览器自动打开 `http://localhost:19900`。

### 开发模式（热重载）

```bash
# 终端 1 — 后端
npm run dev

# 终端 2 — 前端 HMR
npm run dev:web
```

---

## 接入客户端

将 LLM SDK 的 `base_url` 指向本地代理，其余配置保持不变：

**Python（OpenAI SDK）**
```python
from openai import OpenAI
client = OpenAI(
    base_url="http://localhost:19900/v1",
    api_key="any",   # 代理会替换为配置文件中的真实 key
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
| 配置 | js-yaml |
| 加密 | Node.js crypto（AES-256-GCM） |

---

## 致谢

界面设计和 Trace 展示风格参考了 [claude-tap](https://github.com/liaohch3/claude-tap) 项目。

---

## License

MIT
