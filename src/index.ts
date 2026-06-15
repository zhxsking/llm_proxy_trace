#!/usr/bin/env node
// ============================================================
// LPT CLI Entry Point - Unified server (proxy + dashboard + WS)
// ============================================================

import { createApp } from './server/app.js';
import { loadConfig } from './server/config/loader.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 返回 AppData 目录：
 *   Windows : %APPDATA%\llmpt
 *   macOS   : ~/Library/Application Support/llmpt
 *   Linux   : ~/.config/llmpt
 */
function getAppDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'llmpt');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'llmpt');
  }
  return path.join(os.homedir(), '.config', 'llmpt');
}

/**
 * 解析 .env 路径：优先 cwd，其次 appdata
 * 若两处都不存在，则在 appdata 目录生成一份
 * 返回实际使用的路径
 */
function resolveEnvPath(cwd: string): string {
  const cwdEnv = path.join(cwd, '.env');
  if (fs.existsSync(cwdEnv)) return cwdEnv;

  const appDataDir = getAppDataDir();
  const appDataEnv = path.join(appDataDir, '.env');
  if (fs.existsSync(appDataEnv)) return appDataEnv;

  // 生成到 appdata
  fs.mkdirSync(appDataDir, { recursive: true });
  const examplePath = path.resolve(__dirname, '..', '.env.example');
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, appDataEnv);
    console.log(`📄 已生成配置文件：${appDataEnv}`);
    console.log('   请编辑该文件填入 API Key，修改后重启服务生效\n');
  } else {
    console.log(`⚠️  未找到 .env.example，将使用默认配置启动`);
    console.log(`   可手动创建 ${appDataEnv} 填入 OPENAI_API_KEY 等变量\n`);
  }
  return appDataEnv;
}

/**
 * 解析 lpt.config.yaml 路径：优先 cwd，其次 appdata
 */
function resolveConfigPath(cwd: string): string {
  const cwdCfg = path.join(cwd, 'lpt.config.yaml');
  if (fs.existsSync(cwdCfg)) return cwdCfg;

  const appDataDir = getAppDataDir();
  return path.join(appDataDir, 'lpt.config.yaml');
}

async function main() {
  console.log('🚀 LPT 启动中...');

  const cwd = process.cwd();
  const appDataDir = getAppDataDir();
  const envPath = resolveEnvPath(cwd);
  const configPath = resolveConfigPath(cwd);

  const config = loadConfig(configPath, envPath);

  // 若 trace.dir 仍是默认相对路径，改为 appdata/traces（用户自定义的绝对路径不受影响）
  if (config.trace.dir === './traces') {
    config.trace.dir = path.join(appDataDir, 'traces');
  }

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

  console.log(`✅ 服务已启动：http://localhost:${config.proxy.port}`);

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
    console.log('\n🛑 正在关闭...');
    registry.stopRefreshTimers();
    ws.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
