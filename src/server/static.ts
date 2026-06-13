// ============================================================
// Static file serving middleware for Hono (Node.js)
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { Context, Next } from 'hono';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serve static files from a directory, with SPA fallback to index.html
 */
export function serveStaticFiles(staticDir: string) {
  return async (c: Context, next: Next) => {
    const urlPath = c.req.path;

    // Skip API and proxy paths
    if (urlPath.startsWith('/api') || urlPath.startsWith('/v1') || urlPath.startsWith('/ws')) {
      return next();
    }

    // Try to serve the exact file
    const filePath = path.join(staticDir, urlPath);
    // Security: prevent path traversal — ensure resolved path stays within staticDir
    const resolvedStatic = path.resolve(staticDir);
    const resolvedFile = path.resolve(filePath);
    if (
      resolvedFile.startsWith(resolvedStatic + path.sep) &&
      fs.existsSync(resolvedFile) &&
      fs.statSync(resolvedFile).isFile()
    ) {
      const ext = path.extname(filePath);
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(resolvedFile);
      return new Response(content, {
        headers: { 'Content-Type': mimeType },
      });
    }

    // SPA fallback: serve index.html for any path that doesn't match a file
    const indexHtml = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      const content = fs.readFileSync(indexHtml);
      return new Response(content, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return next();
  };
}
