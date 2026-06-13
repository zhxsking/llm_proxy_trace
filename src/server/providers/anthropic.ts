// ============================================================
// Anthropic Provider Adapter
// ============================================================

import { Provider } from './base.js';
import type { ProviderConfig } from '../types.js';

export class AnthropicProvider extends Provider {
  constructor(config: ProviderConfig) {
    super('anthropic', config);
  }

  getUpstreamUrl(requestPath: string): string {
    const cleanPath = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}/${cleanPath}`;
  }

  getUpstreamHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;
    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  matchesPath(path: string): boolean {
    return path.includes('/messages');
  }
}
