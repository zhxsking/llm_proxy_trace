// ============================================================
// Config Schema & Loader
// ============================================================

import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, ProviderConfig, ProvidersConfig } from '../types.js';
import { decrypt, encrypt } from './crypto.js';

/**
 * 极简 .env 解析：KEY=VALUE，忽略注释和空行，不处理引号转义
 */
function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

/**
 * 用环境变量覆盖 providers 中的 baseUrl / apiKey
 * 规则：OPENAI_BASE_URL / OPENAI_API_KEY / ANTHROPIC_* / OLLAMA_*
 */
function applyEnvToProviders(providers: ProvidersConfig): void {
  const map: Record<string, { baseUrl: string; apiKey: string }> = {
    openai:    { baseUrl: 'OPENAI_BASE_URL',    apiKey: 'OPENAI_API_KEY' },
    anthropic: { baseUrl: 'ANTHROPIC_BASE_URL', apiKey: 'ANTHROPIC_API_KEY' },
    ollama:    { baseUrl: 'OLLAMA_BASE_URL',    apiKey: 'OLLAMA_API_KEY' },
  };
  for (const [type, vars] of Object.entries(map)) {
    const baseUrl = process.env[vars.baseUrl];
    const apiKey  = process.env[vars.apiKey];
    if (!baseUrl && !apiKey) continue;
    // 若 yaml 里该 provider 完全没有配置，自动创建
    if (!(providers as Record<string, unknown>)[type]) {
      (providers as Record<string, unknown>)[type] = { baseUrl: '' };
    }
    const p = (providers as Record<string, ProviderConfig>)[type]!;
    if (baseUrl) p.baseUrl = baseUrl;
    if (apiKey)  p.apiKey  = apiKey;
  }
}

const DEFAULT_CONFIG: AppConfig = {
  proxy: {
    port: 19900,
    logLevel: 'info',
  },
  providers: {},
  trace: {
    dir: './traces',
    maxFileSize: 50 * 1024 * 1024,
    maxAge: 7 * 24 * 3600,
    maxInMemory: 1000,
  },
  dashboard: {
    autoOpen: true,
  },
};

/**
 * Load config from YAML file, falling back to defaults
 */
export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath || path.resolve(process.cwd(), 'lpt.config.yaml');

  // 从项目根目录加载 .env（仅设置尚未存在的环境变量）
  const envPath = path.resolve(process.cwd(), '.env');
  loadDotEnv(envPath);

  if (!fs.existsSync(resolvedPath)) {
    const config = { ...DEFAULT_CONFIG, providers: {} };
    applyEnvToProviders(config.providers);
    return config;
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = yaml.load(raw) as Record<string, unknown>;

  const config: AppConfig = {
    proxy: { ...DEFAULT_CONFIG.proxy, ...(parsed.proxy as object | undefined) },
    providers: normalizeProviders(parsed.providers as Record<string, unknown> | undefined),
    trace: { ...DEFAULT_CONFIG.trace, ...(parsed.trace as object | undefined) },
    dashboard: { ...DEFAULT_CONFIG.dashboard, ...(parsed.dashboard as object | undefined) },
  };

  // Decrypt API keys
  for (const p of Object.values(config.providers) as (ProviderConfig | undefined)[]) {
    if (p?.apiKey?.startsWith('enc:')) {
      try { p.apiKey = decrypt(p.apiKey.slice(4)); } catch { /* keep as-is */ }
    }
  }

  // 环境变量优先级最高，覆盖 yaml 中的值
  applyEnvToProviders(config.providers);

  return config;
}

/**
 * Save config back to YAML file (encrypts API keys)
 */
export function saveConfig(config: AppConfig, configPath?: string): void {
  const resolvedPath = configPath || path.resolve(process.cwd(), 'lpt.config.yaml');

  // Encrypt API keys before saving
  const encryptedProviders: Record<string, unknown> = {};
  for (const [type, p] of Object.entries(config.providers)) {
    if (!p) continue;
    encryptedProviders[type] = p.apiKey
      ? { ...p, apiKey: 'enc:' + encrypt(p.apiKey) }
      : p;
  }

  const saveable = { ...config, providers: encryptedProviders };
  const content = yaml.dump(saveable, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(resolvedPath, content, 'utf-8');
}

function normalizeProvider(p: Record<string, unknown>): ProviderConfig {
  return {
    baseUrl: (p.baseUrl as string) || '',
    apiKey: p.apiKey as string | undefined,
    headers: p.headers as Record<string, string> | undefined,
  };
}

function normalizeProviders(raw: Record<string, unknown> | undefined): ProvidersConfig {
  if (!raw) return {};
  const result: ProvidersConfig = {};
  if (raw.openai && typeof raw.openai === 'object') result.openai = normalizeProvider(raw.openai as Record<string, unknown>);
  if (raw.anthropic && typeof raw.anthropic === 'object') result.anthropic = normalizeProvider(raw.anthropic as Record<string, unknown>);
  if (raw.ollama && typeof raw.ollama === 'object') result.ollama = normalizeProvider(raw.ollama as Record<string, unknown>);
  return result;
}

export { DEFAULT_CONFIG };
