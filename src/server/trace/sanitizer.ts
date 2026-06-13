// ============================================================
// Trace Sanitizer - 敏感信息脱敏
// ============================================================

const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
];

/**
 * Sanitize headers - mask sensitive values
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.includes(lowerKey)) {
      if (lowerKey === 'authorization') {
        // Mask: Bearer sk-1234...5678
        sanitized[key] = maskAuthHeader(value);
      } else {
        sanitized[key] = '***REDACTED***';
      }
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function maskAuthHeader(value: string): string {
  if (value.startsWith('Bearer ')) {
    const token = value.slice(7);
    return `Bearer ${maskKey(token)}`;
  }
  return '***REDACTED***';
}

function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
