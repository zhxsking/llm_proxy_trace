#!/usr/bin/env node
// ============================================================
// LPT CLI Entry Point - Unified server (proxy + dashboard + WS)
// ============================================================

import { createApp } from './server/app.js';
import { loadConfig } from './server/config/loader.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 若当前目录没有 .env，从包内 .env.example 复制一份
 */
function ensureEnv(cwd: string): void {
  const envPath = path.resolve(cwd, '.env');
  if (fs.existsSync(envPath)) return;

  const examplePath = path.resolve(__dirname, '..', '.env.example');
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log(`📄 已生成配置文件：${envPath}`);
    console.log('   请编辑 .env 填入 API Key，修改后 Ctrl+C 重启生效\n');
  } else {
    console.log('⚠️  未找到 .env，将使用默认配置启动');
    console.log('   可手动创建 .env 填入 OPENAI_API_KEY 等变量\n');
  }
}

async function main() {
  console.log('🚀 LPT (LLM Proxy Trace) 启动中...');

  // Load configuration — pass explicit path so saveConfig writes back to the same file
  const configPath = path.resolve(process.cwd(), 'lpt.config.yaml');
  ensureEnv(process.cwd());
  const config = loadConfig(configPath);
  console.log(`📋 配置加载成功：端口 ${config.proxy.port}`);


  // Create application
  const { app, registry, collector, ws } = createApp(config, configPath);

  // Create HTTP server with Hono handler
  const { serve } = await import('@hono/node-server');
  const server = serve({
    fetch: app.fetch,
    port: config.proxy.port,
  });

  // Attach WebSocket to the same HTTP server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.attachToServer(server as any, '/ws');

  console.log(`\n🌐 服务运行中：http://localhost:${config.proxy.port}`);
  console.log(`🔌 WebSocket：ws://localhost:${config.proxy.port}/ws`);
  console.log(`📁 Trace 目录：${config.trace.dir}`);
  console.log('\n  代理路由：');
  console.log('    POST /v1/chat/completions  (OpenAI)');
  console.log('    POST /v1/completions       (OpenAI)');
  console.log('    GET  /v1/models');
  console.log('    POST /v1/messages          (Anthropic)');
  console.log('    POST /api/chat             (Ollama)');
  console.log('  管理 API：');
  console.log('    GET  /api/traces');
  console.log('    GET  /api/traces/:id');
  console.log('    GET  /api/providers');
  console.log('    PUT  /api/providers/:type');
  console.log('    GET  /api/stats');
  console.log('\n  ⌨️  Ctrl+C 停止\n');

  // Auto-open dashboard
  if (config.dashboard.autoOpen) {
    const url = `http://localhost:${config.proxy.port}`;
    setTimeout(async () => {
      try {
        const { exec } = await import('node:child_process');
        const cmd = process.platform === 'win32' ? `start ${url}` :
                   process.platform === 'darwin' ? `open ${url}` :
                   `xdg-open ${url}`;
        exec(cmd);
      } catch { /* ignore */ }
    }, 1500);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 正在关闭服务...');
    registry.stopRefreshTimers();
    ws.stop();
    server.close();
    console.log('👋 已退出');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
