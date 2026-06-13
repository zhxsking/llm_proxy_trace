// ============================================================
// Provider Registry - 以 type 为 key 管理提供商实例
// ============================================================

import type { ProvidersConfig, ProviderType } from '../types.js';
import type { Provider } from './base.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';

export class ProviderRegistry {
  private providers: Map<ProviderType, Provider> = new Map();

  /** Register providers from config object */
  registerAll(config: ProvidersConfig): void {
    if (config.openai) this.providers.set('openai', new OpenAIProvider(config.openai));
    if (config.anthropic) this.providers.set('anthropic', new AnthropicProvider(config.anthropic));
    if (config.ollama) this.providers.set('ollama', new OllamaProvider(config.ollama));
  }

  /** Get a provider by type */
  get(type: ProviderType): Provider | undefined {
    return this.providers.get(type);
  }

  /** Get all registered providers */
  getAll(): Provider[] {
    return Array.from(this.providers.values());
  }

  /** Get all registered type names (for logging) */
  getTypes(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Resolve provider for a request path.
   * 1. Anthropic path match (/messages)
   * 2. Ollama path match (/api/*)
   * 3. Fallback to openai
   */
  resolveProvider(requestPath: string): Provider | undefined {
    // Path-specific matching first (Anthropic, Ollama have distinct paths)
    for (const provider of this.providers.values()) {
      if (provider.type !== 'openai' && provider.matchesPath(requestPath)) {
        return provider;
      }
    }
    // Fallback: openai (handles /v1/* and anything else)
    return this.providers.get('openai') ?? this.providers.values().next().value;
  }

  // 保留空实现，兼容 index.ts 调用
  startRefreshTimers(): void {}
  stopRefreshTimers(): void {}
}
