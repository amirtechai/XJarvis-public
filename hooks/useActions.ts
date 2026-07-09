'use client';
import { useCallback, useRef, useState } from 'react';

export interface ActionResult {
  action: string;
  payload: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  serverName?: string;
}

export interface PendingConfirm {
  action: string;
  payload: string;
}

interface UseActionsOptions {
  send: (raw: object) => void;
}

export function useActions({ send }: UseActionsOptions) {
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    if (msg.type === 'action_result') {
      setLastResult(msg as unknown as ActionResult);
      setActionError(null);
      return true;
    }
    if (msg.type === 'action_confirm') {
      setPendingConfirm({ action: msg.action as string, payload: msg.payload as string });
      return true;
    }
    if (msg.type === 'action_error') {
      setActionError(msg.message as string);
      return true;
    }
    return false;
  }, []);

  const executeShell = useCallback((cmd: string) => {
    setActionError(null);
    send({ type: 'action', action: 'shell', payload: cmd });
  }, [send]);

  const executeRemote = useCallback((serverName: string, cmd: string) => {
    setActionError(null);
    send({ type: 'remote_action', serverName, payload: cmd });
  }, [send]);

  const confirmAction = useCallback(() => {
    if (!pendingConfirm) return;
    send({ type: 'action', action: 'shell_confirmed', payload: pendingConfirm.payload });
    setPendingConfirm(null);
  }, [pendingConfirm, send]);

  const cancelConfirm = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  const openApp = useCallback((appName: string) => {
    send({ type: 'action', action: 'open_app', payload: appName });
  }, [send]);

  const webSearch = useCallback((query: string) => {
    send({ type: 'action', action: 'web_search', payload: query });
  }, [send]);

  const readFile = useCallback((filePath: string) => {
    send({ type: 'action', action: 'file_read', payload: filePath });
  }, [send]);

  return {
    lastResult,
    pendingConfirm,
    actionError,
    handleMessage,
    executeShell,
    executeRemote,
    openApp,
    webSearch,
    readFile,
    confirmAction,
    cancelConfirm,
  };
}
