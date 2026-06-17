import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, Copy, Check, ChevronDown } from 'lucide-react';
import type { TraceRecord, ChatMessage, ContentPart, ToolCallRecord, ToolCallInMessage } from '../lib/api';
import { MarkdownRenderer } from './MarkdownRenderer';

interface Props {
  trace: TraceRecord;
}

// Section 折叠状态跨 trace 切换时保持
const sectionStates: Record<string, boolean> = {};

export function TraceDetail({ trace }: Props) {
  const statusCode = trace.response.status || 0;
  const isError = statusCode >= 400 || trace.status === 'error';
  const isStreaming = trace.status === 'streaming';
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming && detailRef.current) {
      detailRef.current.scrollTop = detailRef.current.scrollHeight;
    }
  }, [trace.response, isStreaming]);

  const rawJson = trace;
  const allMessages = (trace.request.body.messages || []) as ChatMessage[];
  const systemPrompt = extractSystem(trace);
  const messages = allMessages.filter(m => m.role !== 'system' && m.role !== 'developer');
  const responseContent = extractResponseContent(trace);
  // 拆分 thinking 和正文
  const thinkingContent = Array.isArray(responseContent)
    ? (responseContent as ContentPart[]).filter(b => b.type === 'thinking').map(b => b.thinking || '').join('\n\n')
    : '';
  const responseOnly: string | ContentPart[] | null = Array.isArray(responseContent)
    ? (() => {
        const nonThinking = (responseContent as ContentPart[]).filter(b => b.type !== 'thinking');
        if (nonThinking.length === 0) return null;
        if (nonThinking.length === 1 && nonThinking[0].type === 'text') return nonThinking[0].text || null;
        return nonThinking;
      })()
    : responseContent;
  const tools = (trace.request.body.tools || []) as unknown[];
  const toolCalls = trace.toolCalls || [];
  const usage = trace.usage;

  // 从 response.body 提取 assistant tool_calls（用于 Response section 渲染）
  const responseToolCalls = extractResponseToolCalls(trace);

  // 获取各 Section 的复制内容
  const getMessagesText = () => messages.map(m => {
    const c = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? (m.content as ContentPart[]).map(b => b.text || b.thinking || '').join('\n') : '';
    return `[${m.role.toUpperCase()}]\n${c}`;
  }).join('\n\n---\n\n');

  const getResponseText = () => {
    if (!responseOnly) return '';
    if (typeof responseOnly === 'string') return responseOnly;
    return (responseOnly as ContentPart[]).map(b => b.text || '').join('\n\n');
  };

  const getToolCallsText = () => toolCalls.map(tc =>
    `${tc.name}(${JSON.stringify(tc.arguments, null, 2)})`
  ).join('\n\n');


  return (
    <div ref={detailRef} className="detail-content">

      {isError && (
        <div className="error-banner">
          <span className="eb-icon">⚠</span>
          <span className="eb-code">{statusCode >= 400 ? `HTTP ${statusCode}` : (trace.error?.code || 'Error')}</span>
          <span className="eb-sep">·</span>
          <span className="eb-message">{trace.error?.message || 'Unknown error'}</span>
        </div>
      )}

      <TokenBar usage={usage} duration={trace.duration} ttfb={trace.ttfb} isStreaming={isStreaming} />

      {/* System Prompt */}
      {systemPrompt && (
        <Section title="System Prompt" defaultOpen={false} copyText={systemPrompt} badge="system">
          <SystemPromptView text={systemPrompt} />
        </Section>
      )}

      {/* Messages */}
      {messages.length > 0 && (
        <Section title="Messages" defaultOpen={true} badge={`${messages.length}`} copyText={getMessagesText()}>
          <div className="messages-list">
            {messages.map((msg, i) => (
              <MessageBlock key={i} message={msg} />
            ))}
          </div>
        </Section>
      )}

      {/* Response */}
      <Section
        title="Response"
        defaultOpen={true}
        badge={statusCode ? `${statusCode}` : isStreaming ? 'live' : undefined}
        copyText={getResponseText() || undefined}
      >
        {thinkingContent && (
          <ThinkingSection content={thinkingContent} />
        )}
        {(responseOnly || responseToolCalls.length > 0) ? (
          <MessageBlock
            message={{ role: 'assistant', content: responseOnly ?? '', tool_calls: responseToolCalls.length > 0 ? responseToolCalls : undefined }}
            isStreaming={isStreaming}
          />
        ) : trace.error ? (
          <div className="msg system" style={{ marginBottom: 0 }}>
            <span className="msg-role" style={{ background: 'var(--red)', color: '#fff' }}>ERROR</span>
            <div className="content-block">
              [{trace.error.code}] {trace.error.message}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', padding: '4px 0' }}>
            {isStreaming
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                  接收中 <span className="streaming-dots"><span/><span/><span/></span>
                </span>
              : 'No response content'}
          </div>
        )}
      </Section>

      {/* Tools Definition */}
      {tools.length > 0 && (
        <Section title="Tools Definition" defaultOpen={false} badge={`${tools.length}`} copyText={JSON.stringify(tools, null, 2)}>
          <ToolsDefinition tools={tools as ToolDef[]} />
        </Section>
      )}

      {/* Raw JSON — 只展示原始请求/响应体，不含 LPT 归集字段 */}
      <Section title="Raw JSON" defaultOpen={false} copyText={JSON.stringify(rawJson, null, 2)}>
        <JsonTree data={rawJson} />
      </Section>

    </div>
  );
}

// ─── Token 用量栏 ───

interface UsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cachedTokens?: number;
}

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function TokenBar({ usage, duration, ttfb, isStreaming }: {
  usage?: UsageData; duration: number; ttfb: number; isStreaming: boolean;
}) {
  const hasCache = (usage?.cachedTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0) > 0;

  return (
    <div className="token-usage-bar">
      <div className="token-bar">
        {isStreaming ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            接收中 <span className="streaming-dots"><span/><span/><span/></span>
          </span>
        ) : usage ? (
          <>
            <span className="tok-group">
              <span className="tok-item">
                <span className="tok-label">合计</span>
                <span className="tok-val" style={{ color: 'var(--text)', fontSize: '12px' }}>{usage.totalTokens.toLocaleString()}</span>
              </span>
            </span>
            <span className="tok-group">
              <span className="tok-item">
                <span className="tok-arrow" style={{ color: 'var(--blue)' }}>↑</span>
                <span className="tok-val">{usage.promptTokens.toLocaleString()}</span>
              </span>
              <span className="tok-item">
                <span className="tok-arrow" style={{ color: 'var(--green)' }}>↓</span>
                <span className="tok-val">{usage.completionTokens.toLocaleString()}</span>
              </span>
              {(usage.reasoningTokens || 0) > 0 && (
                <span className="tok-item">
                  <span className="tok-dot" style={{ background: 'var(--indigo)' }} />
                  <span className="tok-label">推理</span>
                  <span className="tok-val">{usage.reasoningTokens!.toLocaleString()}</span>
                </span>
              )}
            </span>
            {hasCache && (
              <span className="tok-group">
                {(usage.cachedTokens || 0) > 0 && (
                  <span className="tok-item">
                    <span className="tok-dot" style={{ background: 'var(--cyan)' }} />
                    <span className="tok-label">缓存命中</span>
                    <span className="tok-val">{usage.cachedTokens!.toLocaleString()}</span>
                  </span>
                )}
                {(usage.cacheReadTokens || 0) > 0 && (
                  <span className="tok-item">
                    <span className="tok-dot" style={{ background: 'var(--cyan)' }} />
                    <span className="tok-label">缓存读</span>
                    <span className="tok-val">{usage.cacheReadTokens!.toLocaleString()}</span>
                  </span>
                )}
                {(usage.cacheWriteTokens || 0) > 0 && (
                  <span className="tok-item">
                    <span className="tok-dot" style={{ background: 'var(--amber)' }} />
                    <span className="tok-label">缓存写</span>
                    <span className="tok-val">{usage.cacheWriteTokens!.toLocaleString()}</span>
                  </span>
                )}
              </span>
            )}
            <span className="tok-group">
              {ttfb > 0 && (
                <span className="tok-item">
                  <span className="tok-label">首字</span>
                  <span className="tok-val">{fmtMs(ttfb)}</span>
                </span>
              )}
              {duration > 0 && (
                <span className="tok-item">
                  <span className="tok-label">耗时</span>
                  <span className="tok-val">{fmtMs(duration)}</span>
                </span>
              )}
              {duration > 0 && (usage.completionTokens || 0) > 0 && (
                <span className="tok-item">
                  <span className="tok-label">速度</span>
                  <span className="tok-val">{Math.round(usage.completionTokens / (duration / 1000))} tok/s</span>
                </span>
              )}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>无 token 数据</span>
        )}
      </div>
    </div>
  );
}

// ─── Section (可折叠) ───

function Section({
  title, defaultOpen, badge, copyText, children,
}: {
  title: string;
  defaultOpen: boolean;
  badge?: string;
  copyText?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(sectionStates[title] ?? defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    sectionStates[title] = next;
  };

  return (
    <div className="section">
      <div className="section-header" onClick={toggle}>
        <span className={`chevron${open ? ' open' : ''}`}>&#9654;</span>
        <span className="title">{title}</span>
        {badge && <span className="badge">{badge}</span>}
        {/* 复制按钮紧跟标题，所有 Section 统一显示 */}
        {copyText !== undefined && copyText !== '' && (
          <CopyButton getText={() => copyText} className="copy-btn" stopPropagation />
        )}
      </div>
      {open && <div className="section-body open">{children}</div>}
    </div>
  );
}

// ─── 消息规范化：将各 Provider 格式统一为内部标准结构后再渲染 ───────────────────
//
// 目标：MessageBlock / ContentBlock / ToolUseBlock 只维护一套渲染逻辑。
//
// 规范化规则：
//   1. Anthropic tool_result 消息：
//      { role:'user', content:[{type:'tool_result', tool_use_id, content}] }
//      → { role:'tool', content: string, tool_call_id }
//
//   2. ContentPart tool_use：统一用 ToolUseBlock 渲染（可折叠，与 OpenAI MsgToolCallBlock 相同交互）
//
//   3. ContentPart text block：toggle 统一提到 MessageBlock 顶层 header row，
//      ContentBlock 只负责渲染文本内容，不再内嵌独立的 toggle bar

interface NormalizedMessage {
  role: string;
  /** 纯字符串（OpenAI）或 ContentPart[]（Anthropic/多块） */
  content: string | ContentPart[];
  /** OpenAI tool 消息的关联 call id */
  tool_call_id?: string;
  /** OpenAI assistant 消息的 tool_calls 列表 */
  tool_calls?: ToolCallInMessage[];
}

function normalizeMessage(
  msg: ChatMessage | { role: string; content: string | ContentPart[] }
): NormalizedMessage {
  const role = msg.role;
  const content = msg.content;

  // Anthropic tool_result：role=user, content 全部是 tool_result block
  if (
    role === 'user' &&
    Array.isArray(content) &&
    content.length > 0 &&
    (content as ContentPart[]).every(b => b.type === 'tool_result')
  ) {
    if (content.length === 1) {
      // 单个 tool_result：规范化为 role=tool 的纯文本（与 OpenAI tool 消息一致）
      const block = (content as ContentPart[])[0];
      const raw = (block as unknown as Record<string, unknown>).content ?? block.text;
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
      return { role: 'tool', content: text, tool_call_id: block.tool_use_id };
    } else {
      // 多个 tool_result：保持 ContentPart[] 路径，由 ContentBlock 逐块渲染
      return { role: 'tool', content: content as ContentPart[] };
    }
  }

  return {
    role,
    content,
    tool_call_id: (msg as ChatMessage).tool_call_id,
    tool_calls: (msg as ChatMessage).tool_calls,
  };
}

// ─── Message Block（唯一入口，接受任意格式，内部先规范化）────────────────────────

function MessageBlock({
  message, isStreaming,
}: {
  message: ChatMessage | { role: string; content: string | ContentPart[] };
  isStreaming?: boolean;
}) {
  const norm = normalizeMessage(message);
  const { role, content, tool_calls: toolCalls } = norm;

  const isAssistant = role === 'assistant';
  const isPlainText = typeof content === 'string';

  // ContentPart[] 中若含 text block，toggle 统一在顶层 header row，
  // 并通过 prop 传给各 ContentBlock，避免每个 text block 自己有一套 toggle
  const hasTextBlock = !isPlainText && Array.isArray(content)
    && (content as ContentPart[]).some(
      b => b.type === 'text' || b.type === 'input_text' || b.type === 'output_text'
    );
  const showToggle = (isPlainText && content.trim().length > 0) || hasTextBlock;
  const [mode, setMode] = useState<'raw' | 'markdown'>('markdown');

  const getTextContent = (): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return (content as ContentPart[])
        .map(b => b.text || b.thinking || '')
        .filter(Boolean)
        .join('\n\n');
    }
    return '';
  };

  const roleClass =
    role === 'user' ? 'user'
    : role === 'assistant' ? 'assistant'
    : role === 'system' || role === 'developer' ? 'system'
    : role === 'tool' ? 'tool_result'
    : '';

  const hasContent = isPlainText
    ? content.trim().length > 0
    : Array.isArray(content) && content.length > 0;
  const [collapsed, setCollapsed] = useState(role === 'tool');

  return (
    <div className={`msg ${roleClass}`}>
      <div className="msg-header-row">
        <span
          className="msg-role msg-role-toggle"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? '展开' : '收起'}
        >
          <span className={`msg-collapse-arrow${collapsed ? '' : ' open'}`}>▶</span>
          {role.toUpperCase()}
        </span>
        {showToggle && !collapsed && (
          <div className="text-toggle-bar" style={{ marginLeft: '8px', marginTop: 0 }}>
            <button className={`text-toggle-btn${mode === 'raw' ? ' active' : ''}`} onClick={() => setMode('raw')}>原文</button>
            <button className={`text-toggle-btn${mode === 'markdown' ? ' active' : ''}`} onClick={() => setMode('markdown')}>渲染</button>
          </div>
        )}
        <span style={{ marginLeft: 'auto' }}><CopyButton getText={getTextContent} /></span>
      </div>

      {!collapsed && (
        <>
          {isPlainText ? (
            // 纯字符串路径（OpenAI / 规范化后的 tool）
            <TextPane text={content as string} mode={mode} />
          ) : Array.isArray(content) ? (
            // ContentPart[] 路径（Anthropic assistant / 多块内容）
            <div className="content-parts-list">
              {(content as ContentPart[]).map((block, i) => (
                <ContentBlock
                  key={i}
                  block={block}
                  // 外层统一的 mode 传入，text block 直接用，其余 block 忽略
                  textMode={hasTextBlock ? mode : 'markdown'}
                  isStreaming={isStreaming && i === (content as ContentPart[]).length - 1}
                />
              ))}
            </div>
          ) : content ? (
            <JsonTree data={content} />
          ) : null}

          {toolCalls && toolCalls.length > 0 && (
            <div className="msg-tool-calls">
              {toolCalls.map((tc) => (
                <ToolUseBlock key={tc.id} name={tc.function.name} callId={tc.id} rawArgs={tc.function.arguments} />
              ))}
            </div>
          )}
        </>
      )}

      {collapsed && (hasContent || (toolCalls && toolCalls.length > 0)) && (
        <div className="msg-collapsed-hint">
          {[
            hasContent
              ? (isPlainText
                  ? `${(content as string).slice(0, 60).replace(/\n/g, ' ')}…`
                  : `${(content as ContentPart[]).length} 块`)
              : '',
            toolCalls?.length ? `${toolCalls.length} tool_call` : '',
          ].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  );
}

// ─── 统一 Tool Use Block（OpenAI tool_calls + Anthropic tool_use ContentPart 共用）───
//
// 接受两种调用方式：
//   a. OpenAI：name / callId / rawArgs（JSON string）
//   b. Anthropic ContentPart：直接传 block，内部提取 name / id / input

interface ToolUseBlockProps {
  // 方式 a（OpenAI tool_calls / MsgToolCallBlock）
  name?: string;
  callId?: string;
  rawArgs?: string;       // JSON string，需要 parse
  // 方式 b（Anthropic ContentPart tool_use）
  block?: ContentPart;    // block.name / block.id / block.input（已经是对象）
}

function ToolUseBlock({ name, callId, rawArgs, block }: ToolUseBlockProps) {
  const [open, setOpen] = useState(false);

  const fnName   = name   ?? block?.name   ?? 'tool_use';
  const fnCallId = callId ?? block?.id     ?? '';

  // 参数：rawArgs 是 JSON string（OpenAI），block.input 是已解析对象（Anthropic）
  let args: unknown = block?.input ?? rawArgs;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { /* keep raw string */ }
  }
  const argCount = args && typeof args === 'object' ? Object.keys(args as object).length : 0;

  return (
    <div className="tool-block">
      <div className="tool-block-header" onClick={() => setOpen(o => !o)}>
        <span className={`tb-arrow${open ? ' open' : ''}`}>&#9654;</span>
        <span className="tb-name">{fnName}</span>
        {!open && argCount > 0 && <span className="tb-desc">({argCount} args)</span>}
        {fnCallId && (
          <span style={{ marginLeft: 'auto', opacity: 0.45, fontSize: '11px', fontFamily: 'var(--mono)' }}>
            {fnCallId}
          </span>
        )}
      </div>
      {open && (
        <div className="tool-block-body open">
          {typeof args === 'object'
            ? <JsonTree data={args} />
            : <pre className="text-raw">{String(args)}</pre>}
        </div>
      )}
    </div>
  );
}

// ─── Content Block（只负责单个 ContentPart 的渲染，不含 toggle 逻辑）────────────

function ContentBlock({
  block, textMode, isStreaming,
}: {
  block: ContentPart;
  /** 外层 MessageBlock 传入的 raw/markdown 模式，仅对 text 类型生效 */
  textMode?: 'raw' | 'markdown';
  isStreaming?: boolean;
}) {
  const mode = textMode ?? 'markdown';

  if (block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') {
    // toggle 由外层 MessageBlock 统一控制，这里只渲染文本内容
    return (
      <div className="content-block">
        <TextPane text={block.text || ''} mode={mode} isStreaming={isStreaming} />
      </div>
    );
  }

  if (block.type === 'thinking') {
    return <ThinkingBlock content={block.thinking || ''} />;
  }

  if (block.type === 'tool_use') {
    // 复用 ToolUseBlock，与 OpenAI MsgToolCallBlock 相同交互
    return <ToolUseBlock block={block} />;
  }

  if (block.type === 'tool_result') {
    // Anthropic tool_result 作为独立 ContentPart（极少见，通常已由 normalizeMessage 处理）
    const raw = (block as unknown as Record<string, unknown>).content ?? block.text;
    return (
      <div className="content-block block-framed" style={{ borderColor: 'var(--purple)', background: 'var(--purple-bg)' }}>
        <span className="tool-use-label" style={{ color: 'var(--purple)', background: 'color-mix(in srgb, var(--purple) 15%, transparent)' }}>
          ↩ tool_result: {block.tool_use_id || ''}
        </span>
        <div className="content-block-text">
          {typeof raw === 'string' ? raw : <JsonTree data={raw} />}
        </div>
      </div>
    );
  }

  return <JsonTree data={block} />;
}

// ─── 统一文本容器：raw/markdown 都在同一框内，切换不改容器高度 ───
// 两种模式同时渲染，用 display:none 隐藏非激活一侧，容器高度由两者中较高者撑开

function TextPane({
  text,
  mode,
  isStreaming,
  sans,
  compact,
  className,
}: {
  text: string;
  mode: 'raw' | 'markdown';
  isStreaming?: boolean;
  sans?: boolean;
  compact?: boolean;  // compact=true 时渲染模式用 pre-wrap 纯文本，不走 react-markdown
  className?: string;
}) {
  if (!text) return null;
  return (
    <div className={`text-pane${className ? ' ' + className : ''}`}>
      <pre
        className={`text-raw${sans ? ' sans' : ''}`}
        style={{ display: mode === 'raw' ? undefined : 'none' }}
      >{text}</pre>
      <div style={{ display: mode === 'markdown' ? undefined : 'none' }}>
        {compact ? (
          // Thinking 等紧凑文本：保留换行但不走 Markdown 解析，避免 <p> margin 累积
          <div className="text-raw sans" style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
        ) : (
          <MarkdownRenderer text={text} isStreaming={isStreaming} />
        )}
      </div>
    </div>
  );
}

// ─── System Prompt 独立视图（toggle 在文本框上方）───

function SystemPromptView({ text }: { text: string }) {
  const [mode, setMode] = useState<'raw' | 'markdown'>('markdown');
  return (
    <div>
      <div className="text-toggle-bar" style={{ marginBottom: '6px' }}>
        <button className={`text-toggle-btn${mode === 'raw' ? ' active' : ''}`} onClick={() => setMode('raw')}>原文</button>
        <button className={`text-toggle-btn${mode === 'markdown' ? ' active' : ''}`} onClick={() => setMode('markdown')}>渲染</button>
      </div>
      <TextPane text={text} mode={mode} sans />
    </div>
  );
}

// ─── Thinking Block（可折叠，用于 messages ContentBlock 和 Response 顶部）───
// marginBottom prop 用于 Response 顶部的 ThinkingSection 场景

function ThinkingBlock({ content, marginBottom }: { content: string; marginBottom?: number }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'raw' | 'markdown'>('markdown');
  const preview = content.slice(0, 80).replace(/\n/g, ' ');
  return (
    <div className="thinking-block content-block" style={marginBottom ? { marginBottom } : undefined}>
      <div className="thinking-block-header" onClick={() => setOpen(o => !o)}>
        <span className="thinking-label">
          <span className="thinking-arrow">{open ? '▼' : '▶'}</span>
          <span>Thinking</span>
        </span>
        {open ? (
          <div className="text-toggle-bar" style={{ marginTop: 0, marginLeft: '4px' }} onClick={e => e.stopPropagation()}>
            <button className={`text-toggle-btn${mode === 'raw' ? ' active' : ''}`} onClick={() => setMode('raw')}>原文</button>
            <button className={`text-toggle-btn${mode === 'markdown' ? ' active' : ''}`} onClick={() => setMode('markdown')}>渲染</button>
          </div>
        ) : (
          <span className="thinking-preview">{preview}…</span>
        )}
        <CopyButton getText={() => content} stopPropagation className="copy-btn" />
      </div>
      {open && <TextPane text={content} mode={mode} sans />}
    </div>
  );
}

function ThinkingSection({ content }: { content: string }) {
  return <ThinkingBlock content={content} marginBottom={8} />;
}

// ─── Tool Call Block ───

function ToolCallBlock({ toolCall }: { toolCall: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const argCount = typeof toolCall.arguments === 'object' ? Object.keys(toolCall.arguments || {}).length : 0;
  return (
    <div className="tool-block">
      <div className="tool-block-header" onClick={() => setOpen(o => !o)}>
        <span className={`tb-arrow${open ? ' open' : ''}`}>&#9654;</span>
        <span className="tb-name">{toolCall.name}</span>
        {!open && argCount > 0 && <span className="tb-desc">({argCount} args)</span>}
      </div>
      {open && (
        <div className="tool-block-body open">
          <JsonTree data={toolCall.arguments} />
          {toolCall.result !== undefined && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--orange)', marginBottom: '6px', textTransform: 'uppercase' }}>Result</div>
              <JsonTree data={toolCall.result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tools Definition ───

interface ToolDef {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
  name?: string;
  description?: string;
  parameters?: unknown;
  input_schema?: unknown;
  [key: string]: unknown;
}

function ToolsDefinition({ tools }: { tools: ToolDef[] }) {
  return (
    <div style={{ display: 'grid', gap: '4px' }}>
      {tools.map((tool, i) => <ToolDefBlock key={i} tool={tool} />)}
    </div>
  );
}

function ToolDefBlock({ tool }: { tool: ToolDef }) {
  const [open, setOpen] = useState(false);

  // OpenAI 格式：{ type: 'function', function: { name, description, parameters } }
  // Anthropic 格式：{ name, description, input_schema }
  const fnDef = tool.function || tool;
  const name = fnDef.name || tool.name || 'unknown';
  const description = (fnDef as ToolDef).description || tool.description || '';
  const schema = (fnDef as ToolDef).parameters || tool.input_schema || tool.parameters;
  const required: string[] = (schema as { required?: string[] })?.required || [];
  const props: Record<string, { type?: string; description?: string }> =
    (schema as { properties?: Record<string, { type?: string; description?: string }> })?.properties || {};

  return (
    <div className="tool-block">
      <div className="tool-block-header" onClick={() => setOpen(o => !o)}>
        <span className={`tb-arrow${open ? ' open' : ''}`}>&#9654;</span>
        <span className="tb-name">{name}</span>
        <span className="tb-desc">{description}</span>
      </div>
      {open && (
        <div className="tool-block-body open">
          {description && <div className="tb-full-desc">{description}</div>}
          {Object.keys(props).length > 0 ? (
            <>
              <div className="tb-params-title">Parameters</div>
              {Object.entries(props).map(([pname, param]) => (
                <div key={pname} className="tb-param">
                  <div className="tb-param-row1">
                    <span className="tb-pname">{pname}</span>
                    {param.type && <span className="tb-ptype">{param.type}</span>}
                    {required.includes(pname) && <span className="tb-prequired">required</span>}
                  </div>
                  {param.description && <div className="tb-pdesc">{param.description}</div>}
                </div>
              ))}
            </>
          ) : schema ? (
            <JsonTree data={schema} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Copy Button ───

function CopyButton({
  getText, className = 'copy-btn', stopPropagation = false,
}: {
  getText: () => string;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button className={`${className}${copied ? ' copied' : ''}`} onClick={handleCopy} data-tip="复制">
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );
}

// ─── JSON Tree ───

let _jtId = 0;

function JsonTree({ data }: { data: unknown }) {
  _jtId = 0;
  return <div className="json-view">{renderNode(data, 0)}</div>;
}

// Raw JSON 里默认收起的 key（chunks/headers/tools 内容多但不常查看）
const JSON_DEFAULT_COLLAPSED = new Set(['chunks', 'headers', 'tools']);

function renderNode(obj: unknown, depth: number, parentKey?: string): React.ReactNode {
  if (depth > 50) return <span className="json-punct">…</span>;
  if (obj === null) return <span className="jnull">null</span>;
  if (obj === undefined) return <span className="jnull">undefined</span>;
  if (typeof obj === 'boolean') return <span className="jb">{String(obj)}</span>;
  if (typeof obj === 'number') return <span className="jn">{obj}</span>;
  if (typeof obj === 'string') {
    const display = obj.length > 300 ? obj.slice(0, 300) + '…' : obj;
    return <span className="js">"{display}"</span>;
  }
  if (typeof obj !== 'object') return <span>{String(obj)}</span>;

  const isArray = Array.isArray(obj);
  const entries = isArray
    ? (obj as unknown[]).map((v, i) => [i, v] as [number, unknown])
    : Object.entries(obj as Record<string, unknown>);
  const len = entries.length;

  if (len === 0) return <span className="json-punct">{isArray ? '[]' : '{}'}</span>;

  if (len <= 3 && depth < 2 && entries.every(([, v]) => typeof v !== 'object' || v === null)) {
    const items = entries.map(([k, v], i) => (
      <span key={String(k)}>
        {!isArray && <><span className="jk">"{String(k)}"</span><span className="json-punct">: </span></>}
        {renderNode(v, depth + 1)}
        {i < len - 1 && <span className="json-punct">, </span>}
      </span>
    ));
    return (
      <>
        <span className="json-punct">{isArray ? '[' : '{'}</span>
        {items}
        <span className="json-punct">{isArray ? ']' : '}'}</span>
      </>
    );
  }

  const id = 'jt' + (_jtId++);
  const summary = `${len} ${isArray ? 'item' : 'key'}${len !== 1 ? 's' : ''}`;
  const collapsed = parentKey !== undefined && JSON_DEFAULT_COLLAPSED.has(parentKey);
  const children = entries.map(([k, v]) => (
    <div key={String(k)} className="jt-line">
      {!isArray && <><span className="jk">"{String(k)}"</span><span className="json-punct">: </span></>}
      {renderNode(v, depth + 1, String(k))}
    </div>
  ));

  return (
    <>
      <span className={`jt-toggle${collapsed ? '' : ' jt-open'}`} onClick={(e) => toggleJT(e, id)} style={{ cursor: 'pointer' }}>{collapsed ? '▶' : '▼'}</span>
      <span className="json-punct">{isArray ? '[' : '{'}</span>
      <span className={`jt-summary${collapsed ? ' jt-show' : ''}`} id={`${id}s`}>… {summary}</span>
      <div className={`jt-children${collapsed ? '' : ' jt-open'}`} id={id}>{children}</div>
      <div className={`jt-close${collapsed ? ' jt-hidden' : ''}`} id={`${id}c`}><span className="json-punct">{isArray ? ']' : '}'}</span></div>
    </>
  );
}

function toggleJT(e: React.MouseEvent, id: string) {
  e.stopPropagation();
  const node = document.getElementById(id);
  const summary = document.getElementById(id + 's');
  const closeLine = document.getElementById(id + 'c');
  const toggle = e.currentTarget as HTMLElement;
  if (!node) return;
  const isOpen = node.classList.contains('jt-open');
  if (isOpen) {
    node.classList.remove('jt-open');
    toggle.classList.remove('jt-open');
    toggle.textContent = '▶';
    summary?.classList.add('jt-show');
    closeLine?.classList.add('jt-hidden');
  } else {
    node.classList.add('jt-open');
    toggle.classList.add('jt-open');
    toggle.textContent = '▼';
    summary?.classList.remove('jt-show');
    closeLine?.classList.remove('jt-hidden');
  }
}

// ─── Helpers ───

function extractSystem(trace: TraceRecord): string | null {
  const body = trace.request.body;
  const parts: string[] = [];

  if (typeof body.system === 'string' && body.system.trim()) {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    const text = (body.system as Array<string | { type?: string; text?: string }>)
      .map(b => typeof b === 'string' ? b : b?.type === 'text' ? (b.text || '') : '')
      .filter(Boolean).join('\n\n');
    if (text.trim()) parts.push(text);
  }

  const msgs = (trace.request.body.messages || []) as ChatMessage[];
  for (const m of msgs) {
    if (m.role === 'system' || m.role === 'developer') {
      const text = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
        ? (m.content as ContentPart[]).map(b => b.text || '').filter(Boolean).join('\n\n')
        : '';
      if (text.trim()) parts.push(text);
    }
  }

  return parts.length ? parts.join('\n\n') : null;
}

function extractResponseContent(trace: TraceRecord): string | ContentPart[] | null {
  const body = trace.response.body as Record<string, unknown> | null;
  if (!body) return null;

  if (body.choices && Array.isArray(body.choices) && body.choices.length > 0) {
    const choice = body.choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content;
      const reasoningContent = message.reasoning_content as string | undefined;
      const parts: ContentPart[] = [];
      if (reasoningContent) parts.push({ type: 'thinking', thinking: reasoningContent });
      if (typeof content === 'string' && content.trim()) {
        parts.push({ type: 'text', text: content });
      } else if (Array.isArray(content)) {
        parts.push(...(content as ContentPart[]));
      } else if (content !== null && content !== undefined) {
        parts.push({ type: 'text', text: JSON.stringify(content) });
      }
      if (parts.length === 1 && parts[0].type === 'text') return parts[0].text || null;
      if (parts.length > 0) return parts;
    }
    return null;
  }

  if (body.content && Array.isArray(body.content)) {
    const blocks = body.content as ContentPart[];
    if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text || null;
    return blocks;
  }

  if (typeof body.text === 'string') return body.text;
  return null;
}

/** 从 response.body 提取 assistant tool_calls（OpenAI choices 和 Anthropic content tool_use 两种格式） */
function extractResponseToolCalls(trace: TraceRecord): ToolCallInMessage[] {
  const body = trace.response.body as Record<string, unknown> | null;
  if (!body) return [];

  // OpenAI: choices[0].message.tool_calls
  if (Array.isArray(body.choices) && body.choices.length > 0) {
    const message = (body.choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.tool_calls)) {
      return message.tool_calls as ToolCallInMessage[];
    }
  }

  // Anthropic: content[].type === 'tool_use' — 已经作为 ContentPart 在 responseContent 里渲染，无需重复
  return [];
}
