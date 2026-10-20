import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { isSameOrigin } from './connection';
import type { HarnessHandle, HarnessMessage, HarnessViewProps } from './HarnessView.types';

export default forwardRef<HarnessHandle, HarnessViewProps>(function HarnessView(
  { url, computerName, onMessage }, ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const command = (action: string, payload: Record<string, unknown> = {}) => frame.current?.contentWindow?.postMessage(
    { source: 'harness-mobile-shell', action, ...payload }, new URL(url).origin,
  );
  useImperativeHandle(ref, () => ({
    toggleSidebar: () => command('toggleSidebar'),
    closeSidebar: () => command('closeSidebar'),
    toggleTools: () => command('toggleTools'),
    closeTools: () => command('closeTools'),
    selectConversationView: (id) => command('selectConversationView', { id }),
    updateSpeechInput: (update) => command('updateSpeechInput', { update }),
    newSession: () => command('newSession'),
    openSettings: () => command('openSettings'),
    selectSettingsCategory: (index) => command('selectSettingsCategory', { index }),
    closeSettings: () => command('closeSettings'),
    back: () => command('back'),
    reload: () => { if (frame.current) frame.current.src = url; },
  }));
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && isSameOrigin(event.origin, url)
        && event.data?.source === 'harness-mobile-page') {
        if (event.data.type === 'ready') frame.current?.contentWindow?.postMessage({
          source: 'harness-mobile-shell', action: 'setComputerName', name: computerName,
        }, new URL(url).origin);
        onMessage(event.data as HarnessMessage);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [url, computerName, onMessage]);
  return (
    <iframe
      ref={frame}
      src={url}
      title="DeepSeek Harness"
      onLoad={() => command('connect')}
      allow="clipboard-read; clipboard-write; camera; microphone"
      referrerPolicy="origin"
      style={{ width: '100%', height: '100%', border: 0, display: 'block', flex: 1 }}
    />
  );
});
