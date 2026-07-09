'use client';
import { WS_URL } from '@/lib/backend';
import { useEffect, useRef, useState, useCallback } from 'react';

export interface UploadedFile {
  name: string;
  kind: 'image' | 'text';
  contentPath: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
}

export interface JarvisSocketState {
  messages: ChatMessage[];
  streaming: boolean;
  connected: boolean;
  currentModel: string;
  send: (content: string, type?: 'chat_message' | 'voice_input', files?: UploadedFile[]) => void;
  sendRaw: (obj: object) => void;
  clearMessages: () => void;
  onRawMessage: (handler: (msg: Record<string, unknown>) => boolean) => () => void;
}

const MAX_RECONNECT_BACKOFF_MS = 30_000;
const BASE_RECONNECT_BACKOFF_MS = 500;

export function useJarvisSocket(): JarvisSocketState {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [currentModel, setCurrentModel] = useState('');
  const pendingModel = useRef('');
  const rawHandlers = useRef<Set<(msg: Record<string, unknown>) => boolean>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttempt.current = 0;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onclose = () => {
      setConnected(false);
      const backoff = Math.min(
        MAX_RECONNECT_BACKOFF_MS,
        BASE_RECONNECT_BACKOFF_MS * 2 ** reconnectAttempt.current
      );
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(connect, backoff);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch (e) {
        console.error('Invalid JSON message', e);
        return;
      }

      // Let raw handlers intercept action/server messages first
      for (const handler of rawHandlers.current) {
        if (handler(msg)) return;
      }

      if (msg.type === 'model_selected') {
        const model = String(msg.model || '');
        pendingModel.current = model;
        setCurrentModel(model);
        return;
      }

      if (msg.type === 'stream_chunk') {
        setStreaming(true);
        const content = String(msg.content || '');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + content }];
          }
          return [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', content, model: pendingModel.current },
          ];
        });
        return;
      }

      if (msg.type === 'stream_end') {
        setStreaming(false);
        return;
      }

      if (msg.type === 'error') {
        setStreaming(false);
        const message = String(msg.message || 'Unknown error');
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: `⚠️ ${message}` },
        ]);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback(
    (content: string, type: 'chat_message' | 'voice_input' = 'chat_message', files: UploadedFile[] = []) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const label = files.length
        ? `${content ? content + '  ' : ''}📎 ${files.map((f) => f.name).join(', ')}`
        : content;
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: label }]);
      wsRef.current.send(JSON.stringify({ type, content, files }));
    },
    []
  );

  const sendRaw = useCallback((obj: object) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(obj));
  }, []);

  const onRawMessage = useCallback((handler: (msg: Record<string, unknown>) => boolean) => {
    rawHandlers.current.add(handler);
    return () => rawHandlers.current.delete(handler);
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, streaming, connected, currentModel, send, sendRaw, clearMessages, onRawMessage };
}
