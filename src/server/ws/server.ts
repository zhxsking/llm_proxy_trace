// ============================================================
// WebSocket Manager - Integrated with HTTP server
// C01: Merged duplicate connection handler into shared helper
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import type { WSEvent } from '../types.js';

const MAX_PENDING_EVENTS = 100; // B04: cap the pending broadcast buffer

export class WSServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private pendingBroadcasts: WSEvent[] = [];

  /** Attach WebSocket server to an existing HTTP server */
  attachToServer(server: import('node:http').Server, path: string = '/ws'): void {
    this.wss = new WebSocketServer({ server, path });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    console.log(`[WS] WebSocket 已挂载，路径: ${path}`);
  }

  /** C01: Shared connection handler */
  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    console.log(`[WS] 客户端已连接（当前连接数: ${this.clients.size}）`);

    // Send initial status
    this.sendTo(ws, { type: 'status', data: { proxy: true, connections: this.clients.size } });

    // Flush any buffered events to this new client
    for (const event of this.pendingBroadcasts) {
      this.sendTo(ws, event);
    }

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[WS] 客户端已断开（当前连接数: ${this.clients.size}）`);
    });

    ws.on('error', (err) => {
      console.error('[WS] 客户端错误:', err.message);
      this.clients.delete(ws);
    });
  }

  /** Broadcast an event to all connected clients */
  broadcast(event: WSEvent): void {
    if (this.clients.size === 0) {
      // B04: Cap the pending broadcast buffer
      if (this.pendingBroadcasts.length >= MAX_PENDING_EVENTS) {
        this.pendingBroadcasts.shift(); // drop oldest
      }
      this.pendingBroadcasts.push(event);
      return;
    }
    this.broadcastDirect(event);
  }

  private broadcastDirect(event: WSEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Send an event to a specific client */
  private sendTo(ws: WebSocket, event: WSEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /** Stop the WebSocket server */
  stop(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    }
  }

  /** Get number of connected clients */
  get connectionCount(): number {
    return this.clients.size;
  }
}
