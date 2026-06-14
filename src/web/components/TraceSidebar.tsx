// ============================================================
// TraceSidebar - Enhanced with sort modes, model badges, position indicator
// F05, F06, F07, B06 implemented here
// ============================================================

import React, { useState } from 'react';
import { Clock, Loader, X, ChevronDown, Trash2 } from 'lucide-react';
import type { TraceRecord } from '../lib/api';
import { Tooltip } from './Tooltip';

type SortMode = 'time' | 'model' | 'status';

interface Props {
  traces: TraceRecord[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  onDeleteFile?: (fileName: string) => void;
}

export function TraceSidebar({ traces, activeId, onSelect, loading, onDeleteFile }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('time');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 gap-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        <Loader size={14} className="animate-spin" /> 加载中…
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        暂无请求
      </div>
    );
  }

  // Sort (F05)
  const sorted = [...traces].sort((a, b) => {
    if (sortMode === 'model') return (a.model || '').localeCompare(b.model || '');
    if (sortMode === 'status') {
      const priority = (s: string) => s === 'streaming' ? 0 : s === 'error' ? 1 : s === 'pending' ? 2 : 3;
      return priority(a.status) - priority(b.status);
    }
    return 0;
  });

  // F07: position indicator
  const activeIdx = sorted.findIndex(t => t.id === activeId);
  const fillPct = sorted.length > 1 && activeIdx >= 0
    ? Math.round((activeIdx / (sorted.length - 1)) * 100)
    : 0;

  // 按 sourceFile 分组（仅时间排序下）
  type Group = { key: string; label: string; fileName: string | null; items: { trace: TraceRecord; globalIdx: number }[] };
  const groups: Group[] = [];

  if (sortMode === 'time') {
    const seenFiles: string[] = [];
    for (const t of sorted) {
      if (t.sourceFile && !seenFiles.includes(t.sourceFile)) seenFiles.push(t.sourceFile);
    }
    const sessionItems = sorted
      .map((t, i) => ({ trace: t, globalIdx: i + 1 }))
      .filter(x => !x.trace.sourceFile);
    if (sessionItems.length > 0) {
      groups.push({ key: '__session__', label: '当前会话', fileName: null, items: sessionItems });
    }
    for (const file of seenFiles) {
      const items = sorted
        .map((t, i) => ({ trace: t, globalIdx: i + 1 }))
        .filter(x => x.trace.sourceFile === file);
      if (items.length > 0) {
        const match = file.match(/traces-(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})/);
        const label = match ? `${match[1]}  ${match[2].replace(/-/g, ':')}` : file.replace('.jsonl', '');
        groups.push({ key: file, label, fileName: file, items });
      }
    }
  } else {
    groups.push({ key: '__all__', label: '', fileName: null, items: sorted.map((t, i) => ({ trace: t, globalIdx: i + 1 })) });
  }

  const toggleCollapse = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Sort mode (F05) */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-shrink-0" style={{ borderColor: 'var(--border-light)' }}>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>排序</span>
        <div className="sidebar-sort-segment">
          {(['time', 'model', 'status'] as SortMode[]).map(m => (
            <Tooltip
              key={m}
              content={m === 'time' ? '按请求时间（最新在前）' : m === 'model' ? '按模型名称字母' : '按状态（接收中→错误→完成）'}
              placement="bottom"
              delay={400}
            >
              <button
                className={`sidebar-sort-btn${sortMode === m ? ' active' : ''}`}
                onClick={() => setSortMode(m)}
              >
                {m === 'time' ? '时间' : m === 'model' ? '模型' : '状态'}
              </button>
            </Tooltip>
          ))}
        </div>
        {activeIdx >= 0 && (
          <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {activeIdx + 1}/{sorted.length}
          </span>
        )}
      </div>

      {/* Progress bar (F07) */}
      {activeIdx >= 0 && (
        <div style={{ height: '2px', background: 'var(--border)' }}>
          <div style={{ width: `${fillPct}%`, height: '100%', background: 'var(--blue)', transition: 'width .2s' }} />
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        {groups.map(group => {
          const isCollapsed = collapsed.has(group.key);
          const showHeader = groups.length > 1;
          const isHistory = group.fileName !== null;

          return (
            <React.Fragment key={group.key}>
              {showHeader && (
                <div
                  className={`file-group-header${isHistory ? ' history' : ' session'}`}
                  onClick={() => toggleCollapse(group.key)}
                >
                  {/* 展开/收起箭头 */}
                  <ChevronDown
                    size={12}
                    className="file-group-chevron flex-shrink-0"
                    style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                  />
                  <span className="file-group-label">{group.label}</span>
                  <span className="file-group-count">{group.items.length}</span>
                  {(() => {
                    const prompt   = group.items.reduce((s, { trace }) => s + (trace.usage?.promptTokens    || 0), 0);
                    const compl    = group.items.reduce((s, { trace }) => s + (trace.usage?.completionTokens || 0), 0);
                    const reasoning= group.items.reduce((s, { trace }) => s + (trace.usage?.reasoningTokens  || 0), 0);
                    const cacheR   = group.items.reduce((s, { trace }) => s + (trace.usage?.cacheReadTokens  || 0), 0);
                    const cacheW   = group.items.reduce((s, { trace }) => s + (trace.usage?.cacheWriteTokens || 0), 0);
                    const cached   = group.items.reduce((s, { trace }) => s + (trace.usage?.cachedTokens     || 0), 0);
                    const total    = prompt + compl;
                    if (total === 0) return null;
                    const fmt    = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
                    const fmtFull = (n: number) => n.toLocaleString();
                    const tooltipContent = (
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '1px 10px', fontSize: '11px' }}>
                        <span style={{ color: 'var(--text-tertiary)' }}>输入</span>
                        <span style={{ color: 'var(--blue)', fontWeight: 600, textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtFull(prompt)}</span>
                        <span style={{ color: 'var(--text-tertiary)' }}>输出</span>
                        <span style={{ color: 'var(--green)', fontWeight: 600, textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtFull(compl)}</span>
                        {reasoning > 0 && <><span style={{ color: 'var(--text-tertiary)' }}>推理</span><span style={{ color: 'var(--indigo)', fontWeight: 600, textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtFull(reasoning)}</span></>}
                        {(cacheR + cached) > 0 && <><span style={{ color: 'var(--text-tertiary)' }}>缓存命中</span><span style={{ color: 'var(--cyan)', fontWeight: 600, textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtFull(cacheR + cached)}</span></>}
                        {cacheW > 0 && <><span style={{ color: 'var(--text-tertiary)' }}>缓存写入</span><span style={{ color: 'var(--cyan)', fontWeight: 600, textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtFull(cacheW)}</span></>}
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 600, borderTop: '1px solid var(--border-light)', paddingTop: '2px', marginTop: '1px' }}>合计</span>
                        <span style={{ color: 'var(--text)', fontWeight: 700, textAlign: 'right', fontFamily: 'var(--mono)', borderTop: '1px solid var(--border-light)', paddingTop: '2px', marginTop: '1px' }}>{fmtFull(total)}</span>
                      </div>
                    );
                    return (
                      <Tooltip content={tooltipContent} placement="bottom" delay={200}>
                        <span className="file-group-tokens" onClick={e => e.stopPropagation()}>
                          {fmt(total)}
                        </span>
                      </Tooltip>
                    );
                  })()}
                  {group.fileName && onDeleteFile && (
                    <Tooltip content={`删除：${group.fileName}`} placement="bottom">
                      <button
                        className="file-group-delete"
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteFile(group.fileName!);
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
              {!isCollapsed && group.items.map(({ trace, globalIdx }) => (
                <SidebarItem
                  key={trace.id}
                  trace={trace}
                  isActive={trace.id === activeId}
                  onClick={() => onSelect(trace.id)}
                  turnNumber={globalIdx}
                />
              ))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Model badge helpers (F06) ───

function getModelBadge(model: string): { bg: string; fg: string } {
  const l = (model || '').toLowerCase();
  if (l.includes('opus'))   return { bg: 'var(--purple-bg)', fg: 'var(--purple)' };
  if (l.includes('sonnet')) return { bg: 'var(--blue-bg)',   fg: 'var(--blue)' };
  if (l.includes('haiku'))  return { bg: 'var(--green-bg)',  fg: 'var(--green)' };
  if (l.includes('gpt-4'))  return { bg: 'var(--green-bg)',  fg: 'var(--green)' };
  if (l.includes('gpt-3'))  return { bg: 'var(--amber-bg)',  fg: 'var(--amber)' };
  if (l.includes('glm') || l.includes('zhipu')) return { bg: 'var(--blue-bg)', fg: 'var(--blue)' };
  if (l.includes('deepseek'))  return { bg: 'var(--blue-bg)',   fg: 'var(--blue)' };
  if (l.includes('qwen'))      return { bg: 'var(--purple-bg)', fg: 'var(--purple)' };
  if (l.includes('llama'))     return { bg: 'var(--orange-bg)', fg: 'var(--orange)' };
  if (l.includes('mistral'))   return { bg: 'var(--amber-bg)',  fg: 'var(--amber)' };
  return { bg: 'var(--bg-code)', fg: 'var(--text-tertiary)' };
}

function SidebarItem({
  trace, isActive, onClick, turnNumber,
}: {
  trace: TraceRecord;
  isActive: boolean;
  onClick: () => void;
  turnNumber: number;
}) {
  const time = new Date(trace.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const duration = trace.duration > 0
    ? trace.duration >= 1000 ? `${(trace.duration / 1000).toFixed(1)}s` : `${trace.duration}ms`
    : trace.status === 'streaming' ? '...' : '-';

  const promptTokens     = trace.usage?.promptTokens    || 0;
  const completionTokens = trace.usage?.completionTokens || 0;
  const totalTokens      = trace.usage?.totalTokens     || 0;
  const preview          = extractPreview(trace);
  const badge            = getModelBadge(trace.model);
  const modelLabel       = (trace.model || 'unknown').split('/').pop() || 'unknown';

  const isStreaming = trace.status === 'streaming';
  const isError     = trace.status === 'error';
  const isPending   = trace.status === 'pending';
  const statusColor = isError ? 'var(--red)' :
    isStreaming ? 'var(--blue)' :
    trace.status === 'completed' ? 'var(--green)' : 'var(--amber)';

  return (
    <div
      onClick={onClick}
      className="sidebar-item px-3 py-2 cursor-pointer border-b transition-colors"
      style={{
        background: isActive ? 'var(--bg-active)' : 'transparent',
        borderColor: 'var(--border-light)',
      }}
    >
      {/* Row 1: 编号 | 预览文本 | 时间 */}
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-mono flex-shrink-0 text-center"
          style={{ color: 'var(--text-tertiary)', fontSize: '11px', fontWeight: 700, minWidth: '20px' }}
        >
          #{turnNumber}
        </span>
        {preview
          ? <span className="text-xs truncate flex-1" style={{ color: 'var(--text)' }}>{preview}</span>
          : <span className="text-xs truncate flex-1" style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No content</span>
        }
        <span className="text-[10px] flex-shrink-0 font-mono" style={{ color: 'var(--text-tertiary)' }}>{time}</span>
      </div>

      {/* Row 2: 状态图标(与编号同列) + model badge + tokens + duration */}
      <div className="flex items-center gap-1.5 mt-0.5">
        {/* 状态图标：与编号同列，固定 minWidth 对齐 */}
        <div className="flex items-center justify-center flex-shrink-0" style={{ minWidth: '20px' }}>
          {isStreaming
            ? <Loader size={12} className="animate-spin" style={{ color: 'var(--blue)' }} />
            : isError
            ? <X size={14} strokeWidth={2.8} style={{ color: 'var(--red)' }} />
            : isPending
            ? <span className="rounded-full" style={{ width: '9px', height: '9px', background: 'var(--amber)', display: 'inline-block' }} />
            : <span className="rounded-full" style={{ width: '9px', height: '9px', background: statusColor, display: 'inline-block' }} />
          }
        </div>

        <Tooltip content={trace.model} placement="right" delay={500}>
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded-full truncate max-w-[90px]"
            style={{ background: badge.bg, color: badge.fg, lineHeight: '1.3' }}
          >
            {modelLabel}
          </span>
        </Tooltip>

        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0 font-mono" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
          {totalTokens > 0 && (
            <>
              <span style={{ color: 'var(--blue)', fontWeight: 600 }}>↑{promptTokens}</span>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>↓{completionTokens}</span>
            </>
          )}
          <span className="flex items-center gap-0.5">
            <Clock size={9} />{duration}
          </span>
        </div>
      </div>
    </div>
  );
}

function extractPreview(trace: TraceRecord): string {
  const messages = trace.request.body.messages;
  if (messages) {
    const userMsg = [...messages].reverse().find(m => m.role === 'user');
    if (userMsg) {
      const content = typeof userMsg.content === 'string' ? userMsg.content :
        Array.isArray(userMsg.content)
          ? userMsg.content.filter(b => typeof b === 'object' && (b as { type?: string }).type === 'text').map(b => (b as { text?: string }).text || '').join(' ')
          : '';
      return content.replace(/\s+/g, ' ').trim().slice(0, 100);
    }
  }
  if (trace.request.body.prompt) {
    return String(trace.request.body.prompt).replace(/\s+/g, ' ').trim().slice(0, 100);
  }
  return '';
}
