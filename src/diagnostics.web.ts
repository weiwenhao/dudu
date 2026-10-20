import type { BrowserDiagnostic } from './browser-diagnostics';
import type { DiagnosticLevel } from './diagnostics-core';

const recent: unknown[] = [];
export function logEvent(event: string, data?: unknown, level: DiagnosticLevel = 'info', source = 'app'): void {
  recent.push({ time: new Date().toISOString(), event, data, level, source });
  if (recent.length > 250) recent.shift();
}
export function logWebDiagnostics(entries: BrowserDiagnostic[], dropped = 0): void {
  for (const entry of entries) logEvent(entry.event, entry.data, entry.level, 'webview');
  if (dropped) logEvent('diagnostics.dropped', { count: dropped }, 'warn');
}
export async function flushDiagnostics(): Promise<void> {}
export function startRuntimeDiagnostics(): void {}
