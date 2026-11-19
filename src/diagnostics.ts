import { AppState, Keyboard, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import appConfig from '../app.json';
import { DiagnosticLogger, type DiagnosticLevel, type DiagnosticLogInput, type DiagnosticStorage } from './diagnostics-core';
import type { BrowserDiagnostic } from './browser-diagnostics';

const originalWarn = console.warn.bind(console);
const directory = `${FileSystem.documentDirectory ?? ''}diagnostics/`;
const storage: DiagnosticStorage = {
  initialize: () => FileSystem.makeDirectoryAsync(directory, { intermediates: true }),
  list: async () => {
    const names = (await FileSystem.readDirectoryAsync(directory)).filter((name) => name.endsWith('.jsonl'));
    const files: { name: string; size: number; modifiedAt: number }[] = [];
    for (let index = 0; index < names.length; index += 16) {
      const batch = await Promise.all(names.slice(index, index + 16).map(async (name) => {
        const info = await FileSystem.getInfoAsync(directory + name);
        return info.exists && !info.isDirectory
          ? { name, size: info.size, modifiedAt: info.modificationTime * 1000 } : null;
      }));
      for (const file of batch) if (file) files.push(file);
    }
    return files;
  },
  write: (name, contents) => FileSystem.writeAsStringAsync(directory + name, contents),
  remove: (name) => FileSystem.deleteAsync(directory + name, { idempotent: true }),
};
const logger = new DiagnosticLogger(storage, {
  maxTotalBytes: 16 * 1024 * 1024,
  onStorageFailure: (error) => originalWarn('[dudu diagnostics] Local log write failed:', error),
});

export function logEvent(
  event: string, data?: unknown, level: DiagnosticLevel = 'info', source = 'app',
): void {
  logger.log({ event, data, level, source });
  if (level === 'error') void logger.flush();
}

export function logWebDiagnostics(entries: BrowserDiagnostic[], dropped = 0): void {
  for (const entry of entries.slice(0, 160)) {
    if (!entry || typeof entry.event !== 'string' || typeof entry.time !== 'string') continue;
    const input: DiagnosticLogInput = {
      source: 'webview', event: entry.event, data: entry.data,
      time: entry.time, elapsedMs: entry.elapsedMs,
      level: ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info',
    };
    logger.log(input);
  }
  if (dropped) logEvent('diagnostics.dropped', { count: dropped, source: 'webview' }, 'warn');
  if (entries.some((entry) => entry.level === 'error')) void logger.flush();
}

export function flushDiagnostics(): Promise<void> {
  return logger.flush();
}

let initialized = false;
export function startRuntimeDiagnostics(): void {
  if (initialized) return;
  initialized = true;
  void logger.initialize();
  for (const method of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      logEvent(`console.${method}`, { args }, method === 'log' ? 'info' : method, 'react-native');
      original.apply(console, args);
    };
  }
  const runtime = globalThis as typeof globalThis & {
    RN$registerExceptionListener?: (listener: (error: unknown) => void) => void;
    ErrorUtils?: {
      getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
    };
  };
  if (runtime.RN$registerExceptionListener) {
    runtime.RN$registerExceptionListener((error) => logEvent('runtime.exception', { error }, 'error', 'react-native'));
  } else if (runtime.ErrorUtils) {
    const original = runtime.ErrorUtils.getGlobalHandler();
    runtime.ErrorUtils.setGlobalHandler((error, fatal) => {
      logEvent('runtime.exception', { error, fatal }, 'error', 'react-native');
      original(error, fatal);
    });
  }
  let active = AppState.currentState === 'active';
  let expected = performance.now() + 1000;
  AppState.addEventListener('change', (state) => {
    active = state === 'active';
    expected = performance.now() + 1000;
    logEvent('app.state', { state });
    void logger.flush();
  });
  for (const name of ['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide', 'keyboardWillChangeFrame', 'keyboardDidChangeFrame'] as const) {
    Keyboard.addListener(name, (event) => logEvent(`keyboard.${name}`, {
      durationMs: event.duration, easing: event.easing,
      start: 'startCoordinates' in event ? event.startCoordinates : undefined, end: event.endCoordinates,
    }, 'info', 'react-native'));
  }
  setInterval(() => {
    const now = performance.now();
    if (active && now - expected > 150) logEvent('performance.event-loop-lag', { delayMs: Math.round(now - expected) }, 'warn', 'react-native');
    expected = now + 1000;
    void logger.flush();
  }, 1000);
  logEvent('app.start', {
    platform: Platform.OS, osVersion: Platform.Version,
    version: appConfig.expo.version, build: appConfig.expo.ios.buildNumber,
    retentionDays: 7, totalLimitMiB: 20, segmentLimitKiB: 256,
  });
}

startRuntimeDiagnostics();
