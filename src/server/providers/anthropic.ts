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

  getUpstreamHeaders(incomingHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.config.apiKey) {
      // Configured key takes priority
      headers['x-api-key'] = this.config.apiKey;
    } else if (incomingHeaders) {
      // Pass-through auth from the incoming request
      if (incomingHeaders['x-api-key']) headers['x-api-key'] = incomingHeaders['x-api-key'];
      if (incomingHeaders['authorization']) headers['authorization'] = incomingHeaders['authorization'];
    }
    // Always pass through anthropic-specific headers from the client
    if (incomingHeaders) {
      for (const [k, v] of Object.entries(incomingHeaders)) {
        const kl = k.toLowerCase();
        if (kl.startsWith('anthropic-') && kl !== 'anthropic-version') headers[k] = v;
      }
    }
    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  matchesPath(path: string): boolean {
    return path.includes('/messages');
  }
}
