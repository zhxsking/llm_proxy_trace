// ============================================================
// OpenAI Provider Adapter
// ============================================================

import { Provider } from './base.js';
import type { ProviderConfig } from '../types.js';

export class OpenAIProvider extends Provider {
  constructor(config: ProviderConfig) {
    super('openai', config);
  }

  getUpstreamUrl(requestPath: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const cleanPath = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;
    // If baseUrl already ends with /v1, don't add it again
    if (base.endsWith('/v1') || cleanPath.startsWith('v1/')) {
      return `${base}/${cleanPath}`;
    }
    return `${base}/v1/${cleanPath}`;
  }

  getUpstreamHeaders(incomingHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    } else if (incomingHeaders?.['authorization']) {
      headers['Authorization'] = incomingHeaders['authorization'];
    }
    if (this.config.headers) Object.assign(headers, this.config.headers);
    return headers;
  }

  matchesPath(path: string): boolean {
    return path.startsWith('/v1/') || path.startsWith('v1/') ||
           path.startsWith('/chat/') || path.startsWith('/completions') ||
           path === '/models';
  }
}
