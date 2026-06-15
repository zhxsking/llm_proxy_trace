// ============================================================
// Provider Base - 提供商适配器基类
// ============================================================

import type { ProviderConfig } from '../types.js';

export abstract class Provider {
  readonly type: string;
  readonly config: ProviderConfig;

  constructor(type: string, config: ProviderConfig) {
    this.type = type;
    this.config = config;
  }

  /** Build the upstream URL for a given request path */
  abstract getUpstreamUrl(requestPath: string): string;

  /** Build headers to send to the upstream provider.
   * @param incomingHeaders  Original request headers — used to pass-through auth when provider has no apiKey configured.
   */
  abstract getUpstreamHeaders(incomingHeaders?: Record<string, string>): Record<string, string>;

  /** Check if this provider handles the given request path */
  abstract matchesPath(path: string): boolean;

  get baseUrl(): string {
    return this.config.baseUrl;
  }
}
