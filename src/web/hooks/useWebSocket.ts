// ============================================================
// WebSocket Hook - 实时事件连接
// ============================================================

import { useEffect, useRef, useCallback, useState } from 'react';

export interface WSEvent {
  type: string;
  data: unknown;
}

interface UseWebSocketOptions {
  url: string;
  onEvent?: (event: WSEvent) => void;
  reconnectInterval?: number;
}

export function useWebSocket({ url, onEvent, reconnectInterval = 3000 }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  // Use a ref for onEvent so the connect closure never goes stale,
  // without triggering a reconnect every time the parent re-renders.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        console.log('[WS] Connected');
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[WS] Disconnected, reconnecting...');
        reconnectTimer.current = setTimeout(connect, reconnectInterval);
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as WSEvent;
          onEventRef.current?.(parsed);
        } catch {
          // Ignore non-JSON messages
        }
      };

      wsRef.current = ws;
    } catch {
      reconnectTimer.current = setTimeout(connect, reconnectInterval);
    }
  }, [url, reconnectInterval]); // onEvent intentionally excluded — handled via ref

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send };
}
