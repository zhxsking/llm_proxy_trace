// ============================================================
// App Root - Enhanced with dark mode, filter chips, resizable sidebar
// F02, F03, F04, F13 implemented here
// ============================================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Activity, Search, Settings, Trash2, X, Moon, Sun, ChevronDown, RotateCcw } from 'lucide-react';
import { api, type TraceRecord, type StatsInfo } from './lib/api';
import { useWebSocket, type WSEvent } from './hooks/useWebSocket';
import { TraceSidebar } from './components/TraceSidebar';
import { TraceDetail } from './components/TraceDetail';
import { SettingsPanel } from './components/SettingsPanel';
import { Tooltip } from './components/Tooltip';
import { ConfirmDialog } from './components/ConfirmDialog';

type StatusFilter = 'all' | 'error';

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

// ─── Theme helpers (F02) ───

function getInitialTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('lpt-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('lpt-theme', theme); } catch {}
}

export default function App() {
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [stats, setStats] = useState<StatsInfo | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false, title: '', message: '', onConfirm: () => {} });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, title, message, onConfirm });
  };
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false }));
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const [clearMenuOpen, setClearMenuOpen] = useState(false);
  const clearMenuRef = useRef<HTMLDivElement>(null);
  const [reloading, setReloading] = useState(false);

  // Apply theme on mount and change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Close clear menu on outside click
  useEffect(() => {
    if (!clearMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (clearMenuRef.current && !clearMenuRef.current.contains(e.target as Node)) {
        setClearMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [clearMenuOpen]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

  const activeTrace = traces.find(t => t.id === activeId) || null;

  const fetchData = useCallback(async () => {
    try {
      const [traceResult, statsResult] = await Promise.all([
        api.getTraces({ keyword: searchQuery || undefined, limit: 200 }),
        api.getStats(),
      ]);
      setTraces(traceResult.traces);
      setStats(statsResult);
    } catch {} finally { setLoading(false); }
  }, [searchQuery]);

  const handleWSEvent = useCallback((event: WSEvent) => {
    if (event.type === 'trace:new') {
      const newTrace = event.data as TraceRecord;
      // When a keyword filter is active, don't inject new traces that may not match —
      // the full list will be refreshed on the next fetchData call.
      if (!searchQuery) {
        setTraces(prev => [newTrace, ...prev]);
      }
      setStats(prev => prev ? { ...prev, totalCalls: prev.totalCalls + 1 } : prev);
    } else if (event.type === 'trace:update' || event.type === 'trace:complete') {
      const update = event.data as Partial<TraceRecord> & { id: string };
      setTraces(prev => prev.map(t => t.id === update.id ? { ...t, ...update } : t));
      if (event.type === 'trace:complete') {
        api.getStats().then(setStats).catch(() => {});
      }
    }
  }, [searchQuery]);

  const { connected } = useWebSocket({
    url: `ws://${window.location.host}/ws`,
    onEvent: handleWSEvent,
  });

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Resize sidebar (F13) ───
  const startResize = (e: React.MouseEvent) => {
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = sidebarWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - resizeStartX.current;
      const newW = Math.max(240, Math.min(600, resizeStartW.current + delta));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      isResizing.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ─── Compute stats for header (F04) ───
  const totalTokens = stats?.totalTokens ?? 0;
  const totalCalls = stats?.totalCalls ?? 0;
  const avgDuration = stats?.avgDuration ?? 0;
  const inputTokens = traces.reduce((sum, t) => sum + (t.usage?.promptTokens || 0), 0);
  const outputTokens = traces.reduce((sum, t) => sum + (t.usage?.completionTokens || 0), 0);

  // ─── Filtered traces for sidebar (F03) ───
  const filteredTraces = statusFilter === 'all'
    ? traces
    : traces.filter(t => t.status === statusFilter);

  // ─── Model filter chips (F03) ───
  const modelCounts: Record<string, number> = {};
  for (const t of traces) {
    if (t.model) modelCounts[t.model] = (modelCounts[t.model] || 0) + 1;
  }
  const topModels = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const displayedTraces = modelFilter
    ? filteredTraces.filter(t => t.model === modelFilter)
    : filteredTraces;

  const errorCount = traces.filter(t => t.status === 'error').length;

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* ─── Header ─── */}
      <header
        className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', height: '52px', zIndex: 10 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Activity size={18} style={{ color: 'var(--blue)' }} />
          <span className="text-sm font-semibold tracking-tight">LPT</span>
        </div>
        <div className="w-px h-5 flex-shrink-0" style={{ background: 'var(--border)' }} />

        {/* Stats (F04) */}
        <div className="flex items-center gap-3 text-[11px] flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
          <span>请求 <b className="font-mono" style={{ color: 'var(--text-secondary)' }}>{totalCalls}</b></span>
          <span>Tokens <b className="font-mono" style={{ color: 'var(--text-secondary)' }}>{totalTokens.toLocaleString()}</b></span>
          {inputTokens > 0 && (
            <span className="flex items-center gap-0.5 font-mono" style={{ color: 'var(--blue)' }}>
              ↑<b>{inputTokens.toLocaleString()}</b>
            </span>
          )}
          {outputTokens > 0 && (
            <span className="flex items-center gap-0.5 font-mono" style={{ color: 'var(--green)' }}>
              ↓<b>{outputTokens.toLocaleString()}</b>
            </span>
          )}
          {avgDuration > 0 && <span>均 {avgDuration}ms</span>}
        </div>

        {/* Model filter chips (F03) */}
        {topModels.length > 0 && (
          <>
            <div className="w-px h-5 flex-shrink-0" style={{ background: 'var(--border)' }} />
            <div className="flex items-center gap-1.5 overflow-hidden flex-1">
              {topModels.map(([model, count]) => (
                <button
                  key={model}
                  onClick={() => setModelFilter(f => f === model ? null : model)}
                  className={`filter-chip${modelFilter === model ? ' active' : ''}`}
                >
                  {model.split('/').pop() || model}
                  <span className="chip-count">{count}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {/* Live indicator */}
          <span className="text-[11px] flex items-center gap-1" style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? 'var(--green)' : 'var(--red)' }} />
            {connected ? '实时' : '离线'}
          </span>

          <Tooltip content="从磁盘加载历史记录">
            <button
              onClick={async () => {
                setReloading(true);
                await api.reloadTraces().catch(() => {});
                await fetchData();
                setReloading(false);
              }}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors"
              style={{ borderColor: 'var(--border)', color: reloading ? 'var(--blue)' : 'var(--text-tertiary)' }}
              disabled={reloading}
            >
              <RotateCcw size={12} style={{ animation: reloading ? 'spin 1s linear infinite' : 'none' }} />
              加载记录
            </button>
          </Tooltip>

          {/* 清空 split button */}
          <div ref={clearMenuRef} className="clear-split-btn" style={{ position: 'relative' }}>
            <Tooltip content="清空当前会话">
              <button
                onClick={() => { api.deleteTraces(false).then(() => { setTraces([]); fetchData(); }); setClearMenuOpen(false); }}
                className="clear-split-main"
              >
                <Trash2 size={12} /> 清空
              </button>
            </Tooltip>
            <button
              onClick={() => setClearMenuOpen(o => !o)}
              className="clear-split-arrow"
              aria-label="更多清空选项"
            >
              <ChevronDown size={11} />
            </button>
            {clearMenuOpen && (
              <div className="clear-dropdown">
                <div className="clear-dropdown-label">选择清空方式</div>
                <button
                  className="clear-dropdown-item"
                  onClick={() => { api.deleteTraces(false).then(() => { setTraces([]); fetchData(); }); setClearMenuOpen(false); }}
                >
                  <Trash2 size={12} />
                  <div>
                    <div className="clear-dropdown-item-title">清空当前会话</div>
                    <div className="clear-dropdown-item-desc">仅清内存，文件保留，重启可恢复</div>
                  </div>
                </button>
                <button
                  className="clear-dropdown-item danger"
                  onClick={() => {
                    setClearMenuOpen(false);
                    showConfirm(
                      '永久删除所有文件',
                      '将永久删除所有 Trace 文件，无法恢复，确认吗？',
                      () => { api.deleteTraces(true).then(() => { setTraces([]); fetchData(); }); }
                    );
                  }}
                >
                  <Trash2 size={12} />
                  <div>
                    <div className="clear-dropdown-item-title">永久删除所有文件</div>
                    <div className="clear-dropdown-item-desc">删除磁盘 JSONL，重启不恢复</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Theme toggle (F02) */}
          <Tooltip content={theme === 'dark' ? '浅色模式' : '深色模式'}>
            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-7 h-7 rounded border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </Tooltip>

          <Tooltip content="Provider 与代理设置">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors"
              style={{
                borderColor: showSettings ? 'var(--blue)' : 'var(--border)',
                color: showSettings ? 'var(--blue)' : 'var(--text-tertiary)',
                background: showSettings ? 'var(--blue-bg)' : 'transparent',
              }}
            >
              <Settings size={12} /> 设置
            </button>
          </Tooltip>
        </div>
      </header>

      {/* ─── Main area ─── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Settings overlay */}
        {showSettings && (
          <div
            className="absolute inset-0 z-20 flex"
            style={{ background: 'rgba(0,0,0,0.15)' }}
            onClick={() => setShowSettings(false)}
          >
            <div
              className="ml-auto h-full overflow-auto"
              style={{ width: '420px', background: 'var(--bg-card)', borderLeft: '1px solid var(--border)' }}
              onClick={e => e.stopPropagation()}
            >
              <SettingsPanel onClose={() => setShowSettings(false)} />
            </div>
          </div>
        )}

        {/* Sidebar */}
        <div
          className="flex flex-col flex-shrink-0"
          style={{ width: `${sidebarWidth}px`, borderRight: '1px solid var(--border)', background: 'var(--bg-card)' }}
        >
          {/* Search bar + 状态筛选 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            <Search size={13} style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              placeholder="搜索消息、模型…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 text-xs bg-transparent outline-none"
              style={{ color: 'var(--text)' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ color: 'var(--text-tertiary)' }}>
                <X size={11} />
              </button>
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              {(['all', 'error'] as StatusFilter[]).map(s => (
                <Tooltip
                  key={s}
                  content={s === 'all' ? '显示全部请求' : '只看报错的请求'}
                  placement="bottom"
                  delay={400}
                >
                  <button
                    onClick={() => setStatusFilter(s)}
                    className={`filter-chip${statusFilter === s ? ' active' : ''}`}
                    style={{ fontSize: '10px', padding: '2px 7px' }}
                  >
                    {s === 'all' ? `全部 ${traces.length}` : `✕ ${errorCount}`}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* Trace list */}
          <TraceSidebar
            traces={displayedTraces}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
            }}
            loading={loading}
            onDeleteFile={(fileName) => {
              showConfirm(
                '删除记录文件',
                `删除 ${fileName}？此操作不可恢复。`,
                async () => {
                  await api.deleteTraceFile(fileName).catch(() => {});
                  setTraces(prev => prev.filter(t => t.sourceFile !== fileName));
                  if (activeId && traces.find(t => t.id === activeId)?.sourceFile === fileName) {
                    setActiveId(null);
                  }
                }
              );
            }}
          />
        </div>

        {/* Resize handle (F13) */}
        <div
          className="resize-handle"
          onMouseDown={startResize}
          style={{ background: 'var(--border-light)' }}
        />

        {/* Detail panel */}
        <div className="flex-1 overflow-auto detail-scroll" style={{ background: 'var(--bg)' }}>
          {activeTrace ? (
            <TraceDetail key={activeTrace.id} trace={activeTrace} />
          ) : (
            <EmptyState hasTraces={traces.length > 0} />
          )}
        </div>
      </div>

      {/* ─── ConfirmDialog ─── */}
      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmText="确认删除"
        danger
        onConfirm={() => { closeConfirm(); confirmState.onConfirm(); }}
        onCancel={closeConfirm}
      />
    </div>
  );
}

// ─── Empty State ───

function EmptyState({ hasTraces }: { hasTraces: boolean }) {
  const port = window.location.port;
  const base = port ? `http://localhost:${port}` : window.location.origin;

  if (hasTraces) {
    return (
      <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-tertiary)' }}>
        选择左侧一条请求查看详情
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5" style={{ padding: '40px' }}>
      <Activity size={28} style={{ color: 'var(--border)' }} />

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
          等待第一条请求…
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
          设置以下环境变量，所有兼容 OpenAI 接口的工具都会被自动拦截
        </div>
      </div>

      <div style={{
        background: 'var(--bg-code)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '14px 18px',
        fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: 2,
        minWidth: '340px',
      }}>
        <div>
          <span style={{ color: 'var(--amber)' }}>export </span>
          <span style={{ color: 'var(--blue)' }}>OPENAI_BASE_URL</span>
          <span style={{ color: 'var(--text-tertiary)' }}>=</span>
          <span style={{ color: 'var(--green)' }}>"{base}/v1"</span>
        </div>
        <div>
          <span style={{ color: 'var(--amber)' }}>export </span>
          <span style={{ color: 'var(--blue)' }}>OPENAI_API_KEY</span>
          <span style={{ color: 'var(--text-tertiary)' }}>=</span>
          <span style={{ color: 'var(--green)' }}>"any-key"</span>
          <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: '11px' }}>{'  # 代理不验证 key'}</span>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.7, textAlign: 'center', maxWidth: '320px' }}>
        上游 API 地址在 <span style={{ color: 'var(--blue)' }}>设置</span> 中配置。
        记录内容包括流式输出、工具调用与思考过程。
      </div>
    </div>
  );
}
