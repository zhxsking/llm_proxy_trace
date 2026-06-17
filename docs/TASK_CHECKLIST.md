# LPT 改进任务 Checklist

> 创建时间: 2026-06-12  
> 最后更新: 2026-06-12  
> 目标: 精简代码、修复 Bug、美化前端（参考 claude-tap 风格）

---

## 一、Bug 修复 ✅ (7/7)

- [x] **B01** `stream.ts`: `reasoning_content` 字段未被捕获（GLM/DeepSeek thinking 流）→ 已修复，积累 reasoningContent 并写入 completeBody
- [x] **B02** `stream.ts`: 流式响应 usage 用 regex 匹配不可靠 → 改为直接从 parsed.usage 对象提取
- [x] **B03** `collector.ts`: `complete()` 的 duration 计算 → 已改用 `Date.now() - new Date(timestamp).getTime()`
- [x] **B04** `ws/server.ts`: 事件缓冲 pendingBroadcasts 无限增长 → 加 MAX_PENDING_EVENTS=100 上限
- [x] **B05** `TraceDetail.tsx`: 系统消息重复显示 → messages 过滤掉 system/developer 角色
- [x] **B06** `TraceSidebar.tsx`: streaming 状态判断改为 explicit check (`trace.status === 'streaming'`)
- [x] **B07** `handler.ts`: 上游错误状态码 → 4xx 直通，5xx → 502

---

## 二、代码精简 ✅ (4/4)

- [x] **C01** `ws/server.ts`: 合并两个 connection handler 为 `handleConnection()` 私有方法
- [x] **C02** `collector.ts`: `enforceMemoryLimit()` 改用 Map 迭代器 O(n) 而非 sort O(n log n)
- [x] **C03** `api/routes.ts`: 统计逻辑用 reduce 简化（已有所改善）
- [x] **C04** `app.ts`: 删除 proxyPaths 数组 loop，改为直接注册 explicit 路由

---

## 三、前端美化 ✅ (15/15)

### 3.1 暗色主题支持
- [x] **F01** `index.css`: 添加完整 `[data-theme="dark"]` CSS 变量集（参考 claude-tap）
- [x] **F02** `App.tsx`: Header 添加 🌙/☀️ 主题切换按钮，持久化到 localStorage

### 3.2 Header 升级
- [x] **F03** 添加模型筛选 chip（彩色 .filter-chip 样式，点击过滤 traces）
- [x] **F04** Token 用量改为彩色 dot + 数值格式，toLocaleString 数字格式化

### 3.3 Sidebar 升级
- [x] **F05** 添加排序模式选择（Time / Model / Status）segment control
- [x] **F06** 每条 item 加入模型 badge（彩色背景徽章，按模型族配色）
- [x] **F07** 添加 position indicator（当前第几条/共几条 + 进度条）

### 3.4 TraceDetail 升级
- [x] **F08** `thinking` 内容默认折叠，显示行数 + 预览文本，点击展开
- [x] **F09** 使用 `react-markdown` + `remark-gfm` 渲染 assistant 消息
- [x] **F10** 流式响应时显示实时打字机光标（`.streaming-cursor` CSS 动画）
- [x] **F11** 工具调用 block 可折叠，显示参数数量，默认折叠
- [x] **F12** 每个消息 block 右上角 Copy 按钮（hover 显示，点击复制文本）

### 3.5 整体布局
- [x] **F13** Sidebar 宽度可拖拽调整（240px ~ 600px）
- [x] **F14** 空状态显示详细使用说明（base_url 配置示例）
- [x] **F15** 错误状态 badge 更醒目（红色 pill 显示状态码）

---

## 四、新功能 ✅ (4/4)

- [x] **N01** `TraceSidebar`: 顶部状态快速过滤（All / Streaming / Error）chips
- [x] **N02** `TraceDetail`: 添加 Request Headers 折叠面板
- [x] **N03** `SettingsPanel`: 动态从服务器 `/api/config` 加载实际端口
- [x] **N04** 流式响应时 detail panel 自动滚动到底部（useEffect + scrollTop）

---

## 五、构建与集成测试 ✅ (3/3)

- [x] **T01** TypeScript 类型检查通过（`npx tsc --noEmit` 0 errors）
- [x] **T02** Vite 前端构建成功（346KB JS, 24KB CSS, 2.25s 构建时间）
- [x] **T03** 后端启动无错误（`npx tsx test_server.mjs` 所有 health/stats/config 接口正常）

---

## 进度总览

| 类别 | 完成 | 总数 | 状态 |
|------|------|------|------|
| Bug 修复 | 7 | 7 | ✅ 全部完成 |
| 代码精简 | 4 | 4 | ✅ 全部完成 |
| 前端美化 | 15 | 15 | ✅ 全部完成 |
| 新功能 | 4 | 4 | ✅ 全部完成 |
| 测试 | 3 | 3 | ✅ 全部完成 |
| **合计** | **33** | **33** | ✅ **100%** |

---

## 关键变更文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/server/proxy/stream.ts` | 重写 | 修复 B01/B02，reasoning_content 支持 |
| `src/server/trace/collector.ts` | 重构 | 修复 B03，C02 O(n) 优化 |
| `src/server/ws/server.ts` | 精简 | C01 合并重复代码，B04 缓冲上限 |
| `src/server/proxy/handler.ts` | 修复 | B07 状态码处理 |
| `src/server/app.ts` | 精简 | C04 路由注册 |
| `src/server/providers/registry.ts` | 修复 | TypeScript 抽象类实例化 |
| `src/server/static.ts` | 修复 | Hono Next 类型签名 |
| `tsconfig.json` | 修复 | 添加 DOM 库支持前端类型检查 |
| `src/web/App.tsx` | 重写 | F02/F03/F04/F13/F14，暗色主题，模型筛选 |
| `src/web/index.css` | 重写 | F01 完整暗色主题 CSS 变量 |
| `src/web/components/TraceSidebar.tsx` | 重写 | F05/F06/F07，排序/徽章/位置指示器 |
| `src/web/components/TraceDetail.tsx` | 重写 | F08-F12/N02/N04，Markdown/thinking/copy |
| `src/web/components/SettingsPanel.tsx` | 增强 | N03 动态端口 |
| `src/web/lib/api.ts` | 增强 | ConfigInfo 类型，类型修复 |
