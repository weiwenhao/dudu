import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView,
  Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenSafeArea } from './src/ScreenSafeArea';
import HarnessView from './src/HarnessView';
import type { ConversationView, HarnessHandle, HarnessMessage, SpeechOverlayPhase } from './src/HarnessView.types';
import { type Connection, displayAddress, isLoopback, parseAppConnection, parseConnection } from './src/connection';
import { connections } from './src/storage';
import { activeComputer, type ConnectionLibrary, type SavedComputer } from './src/connection-store';
import { ComputerPicker } from './src/ComputerPicker';
import { Fish, Icon, settingsIcon, type IconName } from './src/Icons';
import { useSpeechInput } from './src/useSpeechInput';
import { SpeechSafeArea } from './src/SpeechSafeArea';
import { logEvent, logWebDiagnostics } from './src/diagnostics';
import { LoggedPressable as Pressable } from './src/LoggedPressable';

const BLUE = '#4d6bfe';
const INK = '#17181b';

function ConnectScreen({ previous, error: externalError, onConnect, onCancel }: {
  previous: Connection | null;
  error?: string;
  onConnect(connection: Connection): Promise<void>;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState(previous?.url ?? '');
  const [name, setName] = useState(previous?.name ?? '');
  const [error, setError] = useState(externalError ?? '');
  const [saving, setSaving] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [manualEntry, setManualEntry] = useState(() => Platform.OS === 'web' || !!previous?.url);
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  useEffect(() => { setError(externalError ?? ''); }, [externalError]);
  const connect = async (value = url) => {
    if (saving) return;
    try {
      logEvent('pairing.connect');
      const connection = parseConnection(value, name);
      setSaving(true);
      setError('');
      await onConnect(connection);
      setScanner(false);
    } catch (cause) {
      logEvent('pairing.error', { error: cause }, 'error');
      setError(cause instanceof Error ? cause.message : '连接失败，请重试。');
      scanned.current = false;
    } finally {
      setSaving(false);
    }
  };
  const scan = async () => {
    logEvent('pairing.scan');
    if (permission?.granted || (await requestPermission()).granted) {
      scanned.current = false;
      setScanner(true);
    } else {
      setError('请在系统设置中允许相机权限，也可以直接粘贴访问链接。');
    }
  };
  return (
    <ScreenSafeArea style={styles.connectPage} edges={onCancel ? ['bottom'] : ['top', 'bottom', 'left', 'right']}>
      <StatusBar style="dark" />
      {onCancel && <View style={styles.sheetHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回电脑列表" onPress={onCancel} style={styles.backButton}>
          <Icon name="back" />
        </Pressable>
        <Text style={styles.sheetTitle}>添加电脑</Text>
      </View>}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.connectContent, onCancel && { paddingTop: 24 }]} keyboardShouldPersistTaps="handled">
          {!onCancel && <View style={styles.intro}>
            <Fish size={48} />
            <Text style={styles.headline}>连接电脑上的 DSH</Text>
          </View>}
          {!manualEntry ? <>
            <View style={styles.pairingCard}>
              <Text style={styles.pairingTitle}>电脑端</Text>
              <Text style={styles.pairingDetail}>在 DSH 中打开 dsbot 配对插件并显示二维码。手机扫码自动连接，无需查 IP。</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="扫描电脑二维码" disabled={saving} onPress={() => void scan()}
              style={({ pressed }) => [styles.primary, styles.scanPrimary, pressed && styles.pressed, saving && { opacity: .6 }]}>
              <Icon name="qr" color="white" size={20} />
              <Text style={styles.primaryText}>扫描电脑二维码</Text>
            </Pressable>
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel="使用配对链接手动连接" onPress={() => setManualEntry(true)} style={styles.manualLink}>
              <Text style={styles.scanText}>使用配对链接手动连接</Text>
            </Pressable>
          </> : <>
            <Text style={styles.groupLabel}>手动连接</Text>
            <View style={styles.form}>
              <Text style={styles.label}>电脑配对链接</Text>
              <TextInput
                accessibilityLabel="电脑配对链接"
                style={[styles.input, error ? styles.inputError : null]}
                value={url} onChangeText={(text) => { setUrl(text); setError(''); }}
                placeholder="粘贴电脑端提供的完整链接"
                placeholderTextColor="#9398a5"
                autoCapitalize="none" autoCorrect={false} keyboardType="url"
                textContentType="URL" returnKeyType="go" onSubmitEditing={() => void connect()}
                editable={!saving}
                onFocus={() => logEvent('pairing.input-focus')}
                onBlur={() => logEvent('pairing.input-blur')}
              />
              {!!url && isLoopback(url) && <Text style={styles.notice}>
                真机上的 localhost 指手机自身。请使用电脑提供的配对链接。
              </Text>}
              <Text style={[styles.label, { marginTop: 20 }]}>电脑名称 <Text style={styles.optional}>可选</Text></Text>
              <TextInput accessibilityLabel="电脑名称" style={styles.input}
                value={name} onChangeText={setName} placeholder="电脑名称"
                placeholderTextColor="#9398a5" returnKeyType="done" editable={!saving} />
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={onCancel ? '保存并连接' : '连接电脑'} disabled={saving} onPress={() => void connect()}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed, saving && { opacity: .6 }]}>
              {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>{onCancel ? '保存并连接' : '连接电脑'}</Text>}
            </Pressable>
            {Platform.OS !== 'web' && <Pressable accessibilityRole="button" accessibilityLabel="返回扫码连接" onPress={() => setManualEntry(false)} style={styles.manualLink}>
              <Text style={styles.scanText}>返回扫码连接</Text>
            </Pressable>}
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={scanner} animationType="slide" onRequestClose={() => setScanner(false)}>
        <SafeAreaProvider>
          <ScreenSafeArea style={{ flex: 1, backgroundColor: '#10131b' }}>
            <View style={styles.scannerHeader}>
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '600' }}>扫描连接二维码</Text>
              <Pressable onPress={() => setScanner(false)} accessibilityLabel="关闭扫描" hitSlop={16}>
                <Text style={{ color: 'white', fontSize: 30 }}>×</Text>
              </Pressable>
            </View>
            {scanner && permission?.granted && <CameraView style={styles.flex} barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (scanned.current) return;
                scanned.current = true;
                setUrl(data);
                setScanner(false);
                void connect(data);
              }} />}
          </ScreenSafeArea>
        </SafeAreaProvider>
      </Modal>
    </ScreenSafeArea>
  );
}

function SettingsRow({ icon, title, value, onPress, last, dark = false }: {
  icon: IconName; title: string; value?: string; onPress(): void; last?: boolean; dark?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={() => {
    logEvent('settings.row-press', { category: title });
    onPress();
  }} style={({ pressed }) => [styles.settingsRow, pressed && { opacity: .6 }]}>
    <Icon name={icon} color={dark ? '#f2f2f4' : INK} size={22} />
    <View style={[styles.settingsRowContent, last && { borderBottomWidth: 0 }, dark && { borderBottomColor: '#303137' }]}>
      <Text style={[styles.settingsRowTitle, dark && { color: '#f2f2f4' }]}>{title}</Text>
      {!!value && <Text numberOfLines={1} style={styles.settingsValue}>{value}</Text>}
      <Icon name="chevron" color="#b5b7bc" size={15} />
    </View>
  </Pressable>;
}

function HarnessApp() {
  const insets = useSafeAreaInsets();
  const [library, setLibrary] = useState<ConnectionLibrary>({ computers: [], activeId: null });
  const connection = activeComputer(library);
  const connectionUrl = connection?.url;
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [pairingError, setPairingError] = useState('');
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [booting, setBooting] = useState(true);
  const [sheet, setSheet] = useState<'settings' | 'computers' | 'pair' | null>(null);
  const settings = sheet !== null;
  const [pickerFromSettings, setPickerFromSettings] = useState(false);
  const [computerBusy, setComputerBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('DeepSeek Harness');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [settingsCategories, setSettingsCategories] = useState<{ index: number; label: string }[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsAvailable, setToolsAvailable] = useState(false);
  const [conversationViews, setConversationViews] = useState<ConversationView[]>([]);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [speechOverlayPhase, setSpeechOverlayPhase] = useState<SpeechOverlayPhase>('hidden');
  const drawer = useRef(false);
  const canWebGoBack = useRef(false);
  const harness = useRef<HarnessHandle>(null);
  const generation = useRef(0);
  const changingComputer = useRef(false);
  const speech = useSpeechInput((update) => harness.current?.updateSpeechInput(update));
  const dark = theme === 'dark';
  const resetWorkspace = () => {
    generation.current++;
    speech.cancel();
    setSpeechOverlayPhase('hidden');
    setPendingConnection(null);
    setPairingError('');
    setConnectionGeneration(generation.current);
    setTitle('DeepSeek Harness');
    setTheme('light');
    drawer.current = false;
    setToolsOpen(false);
    setToolsAvailable(false);
    setConversationViews([]);
    setViewMenuOpen(false);
    canWebGoBack.current = false;
    setSheet(null);
    setPickerFromSettings(false);
    setSettingsCategories([]);
    setReady(false);
    setError('');
  };
  const connect = async (value: Connection) => {
    if (changingComputer.current) throw new Error('正在切换电脑，请稍后重试。');
    changingComputer.current = true;
    try {
      logEvent('connection.pair');
      const next = await connections.pair(value);
      resetWorkspace();
      setLibrary(next);
    } finally { changingComputer.current = false; }
  };
  const selectComputer = async (computer: SavedComputer) => {
    if (changingComputer.current) return;
    if (computer.id === library.activeId) { setSheet(null); return; }
    changingComputer.current = true;
    setComputerBusy(true);
    speech.cancel();
    try {
      logEvent('connection.switch', { computerId: computer.id });
      const next = await connections.select(computer.id);
      resetWorkspace();
      setLibrary(next);
    } catch { Alert.alert('无法切换电脑', '保存连接失败，请重试。'); }
    finally { changingComputer.current = false; setComputerBusy(false); }
  };
  const removeComputer = (computer: SavedComputer) => Alert.alert(
    `移除${computer.name}？`, '仅删除这台手机保存的配对。',
    [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: async () => {
        if (changingComputer.current) return;
        changingComputer.current = true;
        setComputerBusy(true);
        try {
          logEvent('connection.remove', { computerId: computer.id });
          const next = await connections.remove(computer.id);
          if (computer.id === library.activeId) resetWorkspace();
          setLibrary(next);
        } catch { Alert.alert('无法移除电脑', '请稍后重试。'); }
        finally { changingComputer.current = false; setComputerBusy(false); }
      } },
    ],
  );
  useEffect(() => {
    let active = true;
    void Promise.all([connections.load(), Linking.getInitialURL()]).then(([stored, initialUrl]) => {
      if (!active) return;
      setLibrary(stored);
      try {
        const incoming = parseAppConnection(initialUrl);
        if (incoming) {
          setPickerFromSettings(false);
          setPendingConnection(incoming);
          setSheet('pair');
        }
      } catch (cause) { setPairingError(cause instanceof Error ? cause.message : '连接链接无效。'); }
      setBooting(false);
    }).catch((cause) => {
      if (!active) return;
      logEvent('connection.load-error', { error: cause }, 'error');
      setPairingError('无法读取已保存的电脑，请重新打开 dsbot 后重试。');
      setBooting(false);
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      try {
        const incoming = parseAppConnection(url);
        if (!incoming) return;
        setPickerFromSettings(false);
        setPendingConnection(incoming);
        setPairingError('');
        setSheet('pair');
      } catch (cause) { setPairingError(cause instanceof Error ? cause.message : '连接链接无效。'); }
    });
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!connection) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewMenuOpen) { setViewMenuOpen(false); return true; }
      if (drawer.current) { harness.current?.closeSidebar(); return true; }
      if (sheet) {
        if (sheet === 'pair') {
          setPendingConnection(null);
          setPairingError('');
          setSheet('computers');
        } else if (sheet === 'computers' && pickerFromSettings) {
          setSheet('settings');
        } else {
          harness.current?.closeSettings();
          setSheet(null);
        }
        return true;
      }
      if (canWebGoBack.current) { harness.current?.back(); return true; }
      return false;
    });
    return () => back.remove();
  }, [connection, sheet, pickerFromSettings, viewMenuOpen]);
  useEffect(() => {
    if (!connectionUrl || ready || error) return;
    const timer = setTimeout(() => {
      logEvent('connection.timeout', { timeoutMs: 25_000 }, 'error');
      setError('连接时间较长。请检查电脑上的地址、访问凭据和网络，然后重试。');
    }, 25_000);
    return () => clearTimeout(timer);
  }, [connectionUrl, connectionGeneration, ready, error]);
  const openComputerPicker = useCallback(() => {
    speech.cancel();
    setViewMenuOpen(false);
    harness.current?.closeSidebar();
    setPickerFromSettings(false);
    setSheet('computers');
  }, [speech]);
  const onMessage = useCallback((message: HarnessMessage) => {
    if (message.type === 'diagnostics') {
      logWebDiagnostics(message.entries, message.dropped);
      return;
    }
    logEvent('bridge.message', {
      type: message.type,
      ...('open' in message ? { open: message.open } : {}),
      ...('version' in message ? { version: message.version } : {}),
      ...('available' in message ? { available: message.available } : {}),
      ...('phase' in message ? { phase: message.phase } : {}),
    }, 'debug');
    if (message.type === 'page-reset') {
      speech.cancel();
      setSpeechOverlayPhase('hidden');
      setReady(false);
      setToolsOpen(false);
      setToolsAvailable(false);
      setConversationViews([]);
      setViewMenuOpen(false);
      drawer.current = false;
      canWebGoBack.current = false;
    }
    else if (message.type === 'ready') { setReady(true); setError(''); }
    else if (message.type === 'drawer') {
      drawer.current = message.open;
      if (message.open) { setViewMenuOpen(false); speech.cancel(); }
    }
    else if (message.type === 'tools') {
      setToolsOpen(message.open);
      if (message.open) { setViewMenuOpen(false); speech.cancel(); }
    }
    else if (message.type === 'tools-available') setToolsAvailable(message.available);
    else if (message.type === 'back-state') canWebGoBack.current = message.canGoBack;
    else if (message.type === 'theme') setTheme(message.theme);
    else if (message.type === 'title' && typeof message.title === 'string') {
      setTitle(message.title);
      setViewMenuOpen(false);
    }
    else if (message.type === 'conversation-views') {
      setConversationViews(message.views);
      if (!message.views.length) setViewMenuOpen(false);
    }
    else if (message.type === 'speech-start') void speech.start(message.id);
    else if (message.type === 'speech-stop') speech.stop(message.id);
    else if (message.type === 'speech-cancel') speech.cancel(message.id);
    else if (message.type === 'speech-overlay') setSpeechOverlayPhase(message.phase);
    else if (message.type === 'settings-categories') setSettingsCategories(message.categories);
    else if (message.type === 'computer-picker') openComputerPicker();
    else if (message.type === 'app-settings') {
      speech.cancel();
      setViewMenuOpen(false);
      setSettingsCategories([]);
      setSheet('settings');
      harness.current?.openSettings();
    }
    else if (message.type === 'external-link' && /^https?:/.test(message.url)) void Linking.openURL(message.url);
  }, [speech, openComputerPicker]);
  const onPageMessage = useMemo(() => {
    const expected = connectionGeneration;
    return (message: HarnessMessage) => { if (generation.current === expected) onMessage(message); };
  }, [connectionGeneration, onMessage]);
  const onPageError = useMemo(() => {
    const expected = connectionGeneration;
    return (message: string) => { if (generation.current === expected) setError(message); };
  }, [connectionGeneration]);
  const reload = () => {
    logEvent('connection.reload');
    speech.cancel();
    setSpeechOverlayPhase('hidden');
    setViewMenuOpen(false);
    setConversationViews([]);
    setReady(false);
    setError('');
    canWebGoBack.current = false;
    harness.current?.reload();
  };
  if (booting) return <ScreenSafeArea style={styles.boot}><ActivityIndicator color={BLUE} /></ScreenSafeArea>;
  if (!connection) return <ConnectScreen key={pendingConnection?.url ?? 'new'}
    previous={pendingConnection} error={pairingError} onConnect={connect} />;
  const cancelEditingConnection = () => { setPendingConnection(null); setPairingError(''); setSheet('computers'); };
  return (
    <ScreenSafeArea style={[styles.shell, Platform.OS === 'web' && styles.webPreview, dark && { backgroundColor: '#18191d' }]} edges={['top', 'left', 'right', 'bottom']}
      onTouchStart={(event) => logEvent('ui.native-touch', {
        target: event.nativeEvent.target, x: Math.round(event.nativeEvent.pageX), y: Math.round(event.nativeEvent.pageY),
      }, 'debug')}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={[styles.toolbar, dark && { backgroundColor: '#18191d' }]}>
        <Pressable onPress={() => { logEvent('ui.sidebar-press'); setViewMenuOpen(false); harness.current?.toggleSidebar(); }} accessibilityRole="button"
          accessibilityLabel="打开会话列表" style={({ pressed }) => [styles.toolbarIconButton, pressed && { opacity: .55 }]}>
          <Icon name="menu" color={dark ? '#f2f3f7' : INK} />
        </Pressable>
        <Pressable disabled={conversationViews.length < 2} onPress={() => {
          logEvent('ui.view-menu-press', { open: !viewMenuOpen });
          speech.cancel();
          if (drawer.current) harness.current?.closeSidebar();
          if (toolsOpen) harness.current?.closeTools();
          setViewMenuOpen((open) => !open);
        }} accessibilityRole="button"
          accessibilityLabel={`切换视图，当前${conversationViews.find((view) => view.selected)?.label ?? '对话'}`}
          accessibilityState={{ expanded: viewMenuOpen, disabled: conversationViews.length < 2 }}
          style={({ pressed }) => [styles.toolbarTitle, pressed && { opacity: .55 }]}>
          <Text numberOfLines={1} style={[styles.toolbarName, dark && { color: '#f2f3f7' }]}>{title === 'DeepSeek Harness' ? 'dsbot' : title}</Text>
          {conversationViews.length > 1 && <View style={viewMenuOpen && { transform: [{ rotate: '180deg' }] }}>
            <Icon name="down" size={14} color={dark ? '#92949d' : '#8c8f98'} />
          </View>}
        </Pressable>
        {toolsAvailable ? <Pressable onPress={() => { logEvent('ui.tools-press', { open: !toolsOpen }); setViewMenuOpen(false); harness.current?.toggleTools(); }} accessibilityRole="button"
          accessibilityLabel={toolsOpen ? '收起工作面板' : '打开工作面板'} accessibilityState={{ expanded: toolsOpen }}
          style={({ pressed }) => [styles.toolbarIconButton, pressed && { opacity: .55 }]}>
          <Icon name="panel" color={toolsOpen ? BLUE : dark ? '#f2f3f7' : INK} />
        </Pressable> : <View style={styles.toolbarIconButton} />}
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        onLayout={(event) => logEvent('layout.keyboard-container', event.nativeEvent.layout, 'debug')}>
        <HarnessView key={`${connectionGeneration}:${connection.url}`} ref={harness} url={connection.url}
          computerName={connection.name} onMessage={onPageMessage} onError={onPageError} />
        {!ready && !error && <View style={[styles.loading, dark && { backgroundColor: '#18191d' }]}>
          <ActivityIndicator size="large" color={BLUE} />
          <Text style={[styles.loadingTitle, dark && { color: 'white' }]}>正在打开工作空间</Text>
          <Text style={styles.loadingDetail}>{displayAddress(connection.url)}</Text>
        </View>}
        {!!error && <View style={[styles.loading, dark && { backgroundColor: '#18191d' }]}>
          <View style={styles.errorBadge}><Text style={{ fontSize: 28, color: BLUE }}>↗</Text></View>
          <Text style={[styles.loadingTitle, dark && { color: 'white' }]}>暂时无法连接</Text>
          <Text style={styles.errorDescription}>{error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="重新连接" style={[styles.primary, { width: 220, marginTop: 24 }]} onPress={reload}>
            <Text style={styles.primaryText}>重新连接</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="切换电脑" style={styles.scanButton} onPress={openComputerPicker}><Text style={styles.scanText}>切换电脑</Text></Pressable>
        </View>}
        {viewMenuOpen && <View style={styles.viewMenuLayer}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button"
            accessibilityLabel="关闭视图菜单" onPress={() => setViewMenuOpen(false)} />
          <View accessibilityRole="menu" style={[styles.viewMenu, dark && styles.darkViewMenu]}>
            {conversationViews.map((view) => <Pressable key={view.id} disabled={view.disabled}
              accessibilityRole="menuitem" accessibilityLabel={view.label} accessibilityState={{ selected: view.selected, disabled: view.disabled }}
              onPress={() => {
                setViewMenuOpen(false);
                harness.current?.selectConversationView(view.id);
              }} style={({ pressed }) => [styles.viewMenuItem,
                pressed && { backgroundColor: dark ? '#303137' : '#f4f5f8' },
                view.disabled && { opacity: .4 }]}>
              <Text style={[styles.viewMenuLabel, dark && { color: '#f2f3f7' }, view.selected && { color: BLUE }]}>{view.label}</Text>
              {view.selected && <Icon name="check" size={17} color={BLUE} />}
            </Pressable>)}
          </View>
        </View>}
      </KeyboardAvoidingView>
      {speechOverlayPhase !== 'hidden' && !settings && ready && !error && <View
        pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.speechSafeArea, {
          height: insets.bottom,
        }]}><SpeechSafeArea height={insets.bottom} cancel={speechOverlayPhase === 'cancel'} /></View>}
      <Modal visible={settings} animationType="slide" transparent statusBarTranslucent onRequestClose={() => {
        if (sheet === 'pair') cancelEditingConnection();
        else if (sheet === 'computers' && pickerFromSettings) setSheet('settings');
        else { harness.current?.closeSettings(); setSheet(null); }
      }}>
        <SafeAreaProvider>
          <ScreenSafeArea style={styles.modalBackdrop} edges={['top']}>
            <View style={[styles.settingsSheet, Platform.OS === 'web' && styles.webPreview, sheet !== 'pair' && dark && { backgroundColor: '#141519' }]}>
              {sheet === 'pair' ?
                <ConnectScreen key={pendingConnection?.url ?? 'add'} previous={pendingConnection}
                  error={pairingError} onConnect={connect} onCancel={cancelEditingConnection} />
                : sheet === 'computers' ? <ComputerPicker library={library} dark={dark} busy={computerBusy}
                  connected={ready && !error} fromSettings={pickerFromSettings}
                  onClose={() => {
                    if (pickerFromSettings) setSheet('settings');
                    else { harness.current?.closeSettings(); setSheet(null); }
                  }}
                  onAdd={() => { setPendingConnection(null); setPairingError(''); setSheet('pair'); }}
                  onSelect={(computer) => { harness.current?.closeSettings(); void selectComputer(computer); }}
                  onRemove={removeComputer} />
                : <>
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, dark && { color: '#f2f2f4' }]}>设置</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="关闭设置" style={[styles.closeSheet, dark && styles.darkButton]} onPress={() => {
                    harness.current?.closeSettings();
                    setSheet(null);
                  }}>
                    <Icon name="close" color={dark ? '#f2f2f4' : INK} />
                  </Pressable>
                </View>
                <ScrollView contentContainerStyle={styles.settingsContent}>
                  <Text style={styles.groupLabel}>电脑</Text>
                  <View style={[styles.settingsGroup, dark && { backgroundColor: '#1c1d21' }]}>
                    <SettingsRow icon="computer" title="电脑连接" value={connection.name} last dark={dark}
                      onPress={() => { setPickerFromSettings(true); setSheet('computers'); }} />
                  </View>
                  <View style={styles.deviceInfo}>
                    <View style={[styles.dot, { backgroundColor: error ? '#dd7568' : ready ? '#6a9d84' : '#d7ac59' }]} />
                    <Text style={styles.deviceInfoText}>{ready ? '已连接' : error ? '连接已断开' : '正在连接'} · {displayAddress(connection.url)}</Text>
                  </View>
                  <Text style={[styles.groupLabel, styles.nextGroup]}>应用</Text>
                  <View style={[styles.settingsGroup, dark && { backgroundColor: '#1c1d21' }]}>
                    {settingsCategories.map((category) => <SettingsRow key={category.index} icon={settingsIcon(category.label)} title={category.label} dark={dark}
                      onPress={() => { harness.current?.selectSettingsCategory(category.index); setSheet(null); }} />)}
                    <SettingsRow icon="refresh" title="重新连接" last dark={dark} onPress={() => {
                      harness.current?.closeSettings();
                      setSheet(null);
                      reload();
                    }} />
                  </View>
                </ScrollView>
              </>}
            </View>
          </ScreenSafeArea>
        </SafeAreaProvider>
      </Modal>
    </ScreenSafeArea>
  );
}

export default function App() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><HarnessApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  boot: { flex: 1, backgroundColor: '#ffffff', justifyContent: 'center' },
  connectPage: { flex: 1, backgroundColor: '#f7f7f8' },
  connectContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 24, paddingBottom: 24, width: '100%', maxWidth: 500, alignSelf: 'center' },
  intro: { paddingTop: 42, paddingBottom: 24, alignItems: 'center' },
  headline: { color: INK, fontSize: 23, fontWeight: '600', marginTop: 20, lineHeight: 32 },
  pairingCard: { backgroundColor: '#fff', borderRadius: 22, padding: 20, marginTop: 20, borderWidth: 1, borderColor: '#eeeff1' },
  pairingTitle: { color: INK, fontSize: 16, fontWeight: '600', lineHeight: 24 },
  pairingDetail: { color: '#777b84', fontSize: 14, lineHeight: 21, marginTop: 8 },
  groupLabel: { fontSize: 12, color: '#96989d', marginLeft: 14, marginBottom: 10 },
  form: { backgroundColor: '#ffffff', borderRadius: 26, padding: 22 },
  label: { fontSize: 14, color: INK, marginBottom: 12 },
  optional: { color: '#a5a7ad', fontWeight: '400', fontSize: 12 },
  input: { borderWidth: 1, borderColor: '#eeeff1', borderRadius: 13, backgroundColor: '#f8f8fa', color: INK, fontSize: 16, paddingHorizontal: 13, paddingVertical: 14, minHeight: 49 },
  inputError: { borderColor: '#d8a5a0' },
  notice: { color: '#9d7846', fontSize: 11, lineHeight: 18, marginTop: 8 },
  error: { color: '#b45e55', fontSize: 12, lineHeight: 20, marginTop: 14 },
  primary: { flexDirection: 'row', height: 50, justifyContent: 'center', alignItems: 'center', backgroundColor: BLUE, borderRadius: 26, marginTop: 24, gap: 12 },
  primaryText: { color: 'white', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: .8 },
  scanButton: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  scanPrimary: { marginTop: 16 },
  manualLink: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  scanText: { color: '#777b84', fontSize: 13 },
  shell: { flex: 1, backgroundColor: '#ffffff' },
  speechSafeArea: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  webPreview: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  toolbar: { height: 64, position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, backgroundColor: 'white' },
  toolbarIconButton: { zIndex: 1, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  darkButton: { backgroundColor: '#1c1d21', borderColor: '#303137' },
  toolbarTitle: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4 },
  toolbarName: { flexShrink: 1, lineHeight: 20, fontSize: 13, fontWeight: '500', color: INK, textAlign: 'center' },
  viewMenuLayer: { position: 'absolute', inset: 0, zIndex: 20 },
  viewMenu: { position: 'absolute', top: 0, right: 58, width: 164, padding: 5, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e6e7eb', backgroundColor: 'white', boxShadow: '0 6px 24px #00000012' },
  darkViewMenu: { backgroundColor: '#24252a', borderColor: '#383940' },
  viewMenuItem: { minHeight: 44, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 11 },
  viewMenuLabel: { fontSize: 15, color: INK },
  dot: { width: 5, height: 5, borderRadius: 3 },
  loading: { position: 'absolute', inset: 0, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', padding: 30 },
  loadingTitle: { color: INK, fontSize: 17, fontWeight: '500', marginTop: 20 },
  loadingDetail: { color: '#989faf', fontSize: 12, marginTop: 10 },
  errorBadge: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf0ff' },
  errorDescription: { maxWidth: 280, textAlign: 'center', color: '#8b91a0', lineHeight: 23, fontSize: 13, marginTop: 13 },
  scannerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, height: 64 },
  modalBackdrop: { flex: 1, backgroundColor: '#0000002b', paddingTop: Platform.OS === 'web' ? 28 : 0 },
  settingsSheet: { flex: 1, marginTop: 12, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: '#f7f7f8', overflow: 'hidden' },
  sheetHeader: { height: 84, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: INK },
  closeSheet: { position: 'absolute', right: 18, top: 20, height: 42, width: 42, borderRadius: 21, borderWidth: 1, borderColor: '#ededf0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backButton: { position: 'absolute', left: 18, top: 20, height: 42, width: 42, borderRadius: 21, borderWidth: 1, borderColor: '#ededf0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  settingsContent: { padding: 16, width: '100%', maxWidth: 540, alignSelf: 'center' },
  settingsGroup: { backgroundColor: '#fff', borderRadius: 26, paddingLeft: 18, paddingRight: 18 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 15, minHeight: 58 },
  settingsRowContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ededf0' },
  settingsRowTitle: { flex: 1, color: INK, fontSize: 16 },
  settingsValue: { flex: 1, textAlign: 'right', color: '#96989d', fontSize: 14, marginLeft: 10 },
  nextGroup: { marginTop: 32 },
  deviceInfo: { flexDirection: 'row', gap: 6, alignItems: 'center', marginHorizontal: 14, marginTop: 12 },
  deviceInfoText: { color: '#747983', fontSize: 12, flex: 1, lineHeight: 18 },
});
