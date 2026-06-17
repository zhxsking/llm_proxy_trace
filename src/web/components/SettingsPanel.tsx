// ============================================================
// SettingsPanel - 代理信息 & 当前 Provider 状态展示（只读）
// providers 配置请修改 .env 文件后重启服务
// ============================================================

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, type ProviderInfo } from '../lib/api';

declare const __APP_VERSION__: string;

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [proxyPort, setProxyPort] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      api.getProviders().then(setProviders).catch(() => {}),
      api.getConfig().then(cfg => setProxyPort((cfg as { proxy?: { port?: number } }).proxy?.port ?? null)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const port = proxyPort ?? (window.location.port ? Number(window.location.port) : undefined);

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">设置</h2>
        <button onClick={onClose} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>
      </div>

      {/* 代理端口 */}
      <div className="rounded-lg p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-medium mb-2">代理服务器</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <span style={{ color: 'var(--text-tertiary)' }}>监听端口</span>
          <span className="font-mono" style={{ color: 'var(--blue)' }}>{port}</span>
          <span style={{ color: 'var(--text-tertiary)' }}>OpenAI Base URL</span>
          <span className="font-mono" style={{ color: 'var(--blue)' }}>http://localhost:{port}/v1</span>
          <span style={{ color: 'var(--text-tertiary)' }}>Anthropic Base URL</span>
          <span className="font-mono" style={{ color: 'var(--blue)' }}>http://localhost:{port}</span>
        </div>
      </div>

      {/* 已配置的 providers（只读，修改请编辑 .env） */}
      <div className="rounded-lg p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <h3 className="text-sm font-medium mb-1">上游服务商</h3>
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
          修改请编辑项目根目录的 <code className="font-mono px-1 py-0.5 rounded" style={{ background: 'var(--bg-code)' }}>.env</code> 文件后重启服务
        </p>
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>
        ) : providers.length === 0 ? (
          <div className="text-sm italic" style={{ color: 'var(--text-tertiary)' }}>
            未检测到已配置的 Provider。请在 <code className="font-mono">.env</code> 中设置 <code className="font-mono">OPENAI_API_KEY</code> 等变量。
          </div>
        ) : (
          <div className="space-y-1.5">
            {providers.map(p => (
              <div key={p.type} className="flex items-center gap-3 px-3 py-2 rounded" style={{ border: '1px solid var(--border)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--green)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium capitalize">{p.type}</div>
                  <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-tertiary)' }}>{p.baseUrl}</div>
                </div>
                {p.apiKey && (
                  <span className="text-[11px] font-mono flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>{p.apiKey}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 版本信息 */}
      <div className="flex items-center justify-end gap-3 pt-1" style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
        <span>LPT v{__APP_VERSION__}</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <a
          href="https://github.com/zhxsking/llm_proxy_trace"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
        >
          GitHub ↗
        </a>
      </div>
    </div>
  );
}
