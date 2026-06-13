import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从 lpt.config.yaml 读取端口，改端口只需修改配置文件即可生效
function readConfigPort(): number {
  try {
    const cfgPath = path.resolve(__dirname, '../../lpt.config.yaml');
    const raw = yaml.load(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    return (raw?.proxy as Record<string, unknown>)?.port as number ?? 19900;
  } catch {
    return 19900;
  }
}
const DEV_BACKEND_PORT = readConfigPort();

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  css: {
    postcss: {
      plugins: [
        tailwindcss(path.resolve(__dirname, 'tailwind.config.cjs')),
        autoprefixer(),
      ],
    },
  },
  server: {
    host: '127.0.0.1',
    port: DEV_BACKEND_PORT,
    proxy: {
      '/api': `http://localhost:${DEV_BACKEND_PORT}`,
      '/v1': `http://localhost:${DEV_BACKEND_PORT}`,
      '/ws': {
        target: `ws://localhost:${DEV_BACKEND_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('react') || id.includes('react-dom')) return 'react-vendor';
          if (id.includes('react-markdown') || id.includes('remark-gfm') ||
              id.includes('highlight.js') || id.includes('dompurify')) return 'markdown';
        },
      },
    },
  },
});
