import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { isSameOrigin } from './connection';
import { MOBILE_ADAPTER_SCRIPT } from './generated/mobile-adapter';
import type { HarnessHandle, HarnessMessage, HarnessViewProps } from './HarnessView.types';
import { logEvent } from './diagnostics';

export default memo(forwardRef<HarnessHandle, HarnessViewProps>(function HarnessView(
  { url, computerName, onMessage, onError }, ref,
) {
  const webview = useRef<WebView<object>>(null);
  const source = useMemo(() => ({ uri: url }), [url]);
  const sequence = useRef(0);
  const script = MOBILE_ADAPTER_SCRIPT;
  const command = useCallback((method: string, ...args: unknown[]) => {
    const id = ++sequence.current;
    logEvent('bridge.command', { id, method });
    webview.current?.injectJavaScript(
      `(()=>{const d=window.__DSBOT_DIAGNOSTICS__;const s=performance.now();d?.record('bridge.command-received',${JSON.stringify({ id, method })});try{window.__HARNESS_MOBILE__?.[${JSON.stringify(method)}](...${JSON.stringify(args)});}finally{d?.record('bridge.command-complete',{id:${id},method:${JSON.stringify(method)},durationMs:performance.now()-s});}})();true;`,
    );
  }, []);
  useEffect(() => { command('setComputerName', computerName); }, [command, computerName]);
  useImperativeHandle(ref, () => ({
    toggleSidebar: () => command('toggleSidebar'),
    closeSidebar: () => command('closeSidebar'),
    toggleTools: () => command('toggleTools'),
    closeTools: () => command('closeTools'),
    selectConversationView: (id) => command('selectConversationView', id),
    updateSpeechInput: (update) => command('updateSpeechInput', update),
    newSession: () => command('newSession'),
    openSettings: () => command('openSettings'),
    selectSettingsCategory: (index) => command('selectSettingsCategory', index),
    closeSettings: () => command('closeSettings'),
    back: () => command('back'),
    reload: () => { logEvent('webview.reload'); webview.current?.reload(); },
  }), [command]);
  return (
    <WebView<object>
      ref={webview}
      source={source}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      injectedJavaScriptBeforeContentLoaded={script}
      injectedJavaScript={script}
      onLayout={(event) => logEvent('layout.webview', event.nativeEvent.layout, 'debug')}
      onMessage={(event) => {
        try {
          const message = JSON.parse(event.nativeEvent.data) as HarnessMessage;
          if (message?.type === 'ready') command('setComputerName', computerName);
          if (message && typeof message === 'object') onMessage(message);
        } catch { /* Ignore messages from unrelated page widgets. */ }
      }}
      onLoadStart={() => { logEvent('webview.load-start'); onMessage({ type: 'page-reset' }); }}
      onLoadEnd={() => logEvent('webview.load-end')}
      onError={(event) => {
        logEvent('webview.error', { code: event.nativeEvent.code, description: event.nativeEvent.description }, 'error');
        onError('无法连接电脑。请确认 Harness 正在运行，手机和电脑网络可达。');
      }}
      onHttpError={(event) => {
        if (new URL(event.nativeEvent.url).pathname !== new URL(url).pathname) return;
        const status = event.nativeEvent.statusCode;
        logEvent('webview.http-error', { status }, 'error');
        onError(status === 401 || status === 403
          ? '访问链接已失效或没有权限，请重新粘贴电脑显示的完整连接链接。'
          : `Harness 返回了 HTTP ${status}，请检查电脑端服务。`);
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === 'about:blank' || isSameOrigin(request.url, url)) return true;
        if (/^https?:/.test(request.url)) void Linking.openURL(request.url);
        return false;
      }}
      onOpenWindow={(event) => {
        const target = event.nativeEvent.targetUrl;
        if (/^https?:/.test(target) && !isSameOrigin(target, url)) void Linking.openURL(target);
      }}
      onContentProcessDidTerminate={() => {
        logEvent('webview.content-process-terminated', undefined, 'error');
        onMessage({ type: 'page-reset' });
        webview.current?.reload();
      }}
      onRenderProcessGone={() => {
        logEvent('webview.render-process-gone', undefined, 'error');
        onMessage({ type: 'page-reset' });
        webview.current?.reload();
      }}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustsScrollIndicatorInsets={false}
      keyboardDisplayRequiresUserAction
      hideKeyboardAccessoryView
      removeIosKeyboardObserver
      allowsBackForwardNavigationGestures={false}
      allowsLinkPreview={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows
      bounces={false}
      overScrollMode="never"
      textZoom={100}
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      mixedContentMode="never"
      webviewDebuggingEnabled={__DEV__}
    />
  );
}));
