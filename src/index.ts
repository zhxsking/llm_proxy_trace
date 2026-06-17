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
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

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
  const args = process.argv.slice(2);

  // ── 子命令：llmpt claude [...claude args] ──
  // 先启动 LPT 服务，等端口就绪后再启动 claude
  const isClaudeSubcommand = args[0] === 'claude';
  const claudeArgs = isClaudeSubcommand ? args.slice(1) : [];

  // ── 启动 LPT 服务 ──
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

  // 检查端口是否被占用（同时探测 IPv4/IPv6）
  await Promise.all(['0.0.0.0', '::'].map(host =>
    new Promise<void>((resolve, reject) => {
      const tester = createServer();
      tester.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ 端口 ${config.proxy.port} 已被占用`);
          console.error(`   请关闭占用该端口的程序后重试`);
          console.error(`   查找占用进程（Windows）：netstat -ano | findstr :${config.proxy.port}`);
          console.error(`   查找占用进程（macOS/Linux）：lsof -i :${config.proxy.port}`);
          process.exit(1);
        }
        reject(err);
      });
      tester.once('listening', () => { tester.close(); resolve(); });
      tester.listen(config.proxy.port, host);
    })
  ));

  // Create application
  const { app, registry, collector, ws } = createApp(config, configPath);

  // Create HTTP server with Hono handler
  const { serve } = await import('@hono/node-server');
  const server = serve({
    fetch: app.fetch,
    port: config.proxy.port,
  });

  // ── Claude 模式：静默所有后续 console.log，避免污染 claude TUI ──
  // 必须在 attachToServer 之前（ws 挂载日志会通过 console.log 输出）
  if (isClaudeSubcommand) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    console.log = () => {};
  }

  // Attach WebSocket to the same HTTP server
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.attachToServer(server as any, '/ws');

  console.log(`✅ 服务已启动：http://localhost:${config.proxy.port}`);
  console.log(`📝 配置文件：${envPath}`);
  console.log(`   修改后重启服务生效`);

  // ── 子命令模式：启动 claude，claude 退出后关闭 LPT ──
  if (isClaudeSubcommand) {
    // claude 模式必须有 anthropic provider，否则所有请求会被 LPT 拦截后返回 400
    if (!config.providers.anthropic?.apiKey) {
      process.stdout.write(`⚠️  警告：未配置 Anthropic API Key，claude 的网络请求将无法转发！\n`);
      process.stdout.write(`   请在 ${envPath} 中设置 ANTHROPIC_API_KEY=sk-ant-xxx\n\n`);
    }
    // 打印状态行（console.log 已被静默，直接写 stdout）
    process.stdout.write(`✅ LPT 代理已就绪：http://localhost:${config.proxy.port}\n`);
    process.stdout.write(`🔍 启动 claude ${claudeArgs.join(' ') || '(interactive)'}\n\n`);

    // 自动打开 Dashboard
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
      }, 1000);
    }

    // 写临时文件注入 ANTHROPIC_BASE_URL（claude 退出后删除）
    const hasSettings = claudeArgs.some(a => a === '--settings' || a.startsWith('--settings='));
    let settingsFile: string | null = null;
    let finalArgs = claudeArgs;
    if (!hasSettings) {
      settingsFile = path.join(os.tmpdir(), `lpt-claude-${process.pid}.json`);
      fs.writeFileSync(settingsFile, JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://localhost:${config.proxy.port}` } }));
      finalArgs = ['--settings', settingsFile, ...claudeArgs];
    }

    const child = spawn('claude', finalArgs, { stdio: 'inherit', windowsVerbatimArguments: false });

    const cleanup = () => {
      if (settingsFile) { try { fs.unlinkSync(settingsFile); } catch { /* ignore */ } }
      registry.stopRefreshTimers(); ws.stop(); server.close();
    };

    child.on('error', (err) => {
      console.error('❌ 启动 claude 失败：', err.message);
      console.error('   请确保已安装 Claude Code：https://claude.ai/code');
      cleanup(); process.exit(1);
    });
    child.on('exit', (code) => { cleanup(); process.exit(code ?? 0); });
    return;
  }

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
