'use client';
import { useCallback, useEffect } from 'react';
import { useJarvis } from '../providers/JarvisProvider';
import { useVoice } from '../hooks/useVoice';
import { useActions } from '../hooks/useActions';
import { StatusBar } from './StatusBar';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { ActionPanel } from './ActionPanel';
import { VoiceIndicator } from './VoiceIndicator';
import { ActionConfirmDialog } from './ActionConfirmDialog';
import { ActionResultToast } from './ActionResultToast';
import { ToolCallStream } from './ToolCallStream';

export function Chat() {
  const { messages, streaming, connected, currentModel, send, sendRaw, onRawMessage } = useJarvis();

  const { handleMessage, lastResult, pendingConfirm, actionError, executeShell, openApp, webSearch, confirmAction, cancelConfirm } =
    useActions({ send: sendRaw });

  // Register action message handler
  useEffect(() => {
    return onRawMessage(handleMessage);
  }, [onRawMessage, handleMessage]);

  const handleTranscript = useCallback(
    (text: string) => send(text, 'voice_input'),
    [send]
  );

  const { state: voiceState, startListening, stopListening } =
    useVoice({ onTranscript: handleTranscript });

  // Backend tts_bridge handles all TTS playback (ElevenLabs → afplay).
  // Browser-side speechSynthesis caused duplicate/overlapping speech.

  const handleVoiceToggle = useCallback(() => {
    if (voiceState === 'idle') startListening();
    else stopListening();
  }, [voiceState, startListening, stopListening]);

  const handleAction = useCallback((prefix: string) => {
    // Quick-action buttons: if prefix is a recognized action key, execute directly
    if (prefix === '__web_search__') {
      const q = window.prompt('Arama sorgusu:');
      if (q) webSearch(q);
      return;
    }
    if (prefix === '__open_app__') {
      const app = window.prompt('Uygulama adı:');
      if (app) openApp(app);
      return;
    }
    if (prefix === '__shell__') {
      const cmd = window.prompt('Shell komutu:');
      if (cmd) executeShell(cmd);
      return;
    }
    send(prefix);
  }, [send, webSearch, openApp, executeShell]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      background: 'var(--bg-base)',
    }}>
      <StatusBar connected={connected} model={currentModel} voiceState={voiceState} />

      <MessageList messages={messages} streaming={streaming} />

      <ToolCallStream />

      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <VoiceIndicator state={voiceState} />
      </div>

      <ActionPanel onAction={handleAction} />

      <ChatInput
        onSend={send}
        onVoiceToggle={handleVoiceToggle}
        disabled={streaming || !connected}
        voiceActive={voiceState !== 'idle'}
      />

      {pendingConfirm && (
        <ActionConfirmDialog
          payload={pendingConfirm.payload}
          onConfirm={confirmAction}
          onCancel={cancelConfirm}
        />
      )}

      <ActionResultToast result={lastResult} error={actionError} />
    </div>
  );
}
