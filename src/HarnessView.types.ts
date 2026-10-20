import type { Ref } from 'react';
import type { BrowserDiagnostic } from './browser-diagnostics';

export type ConversationView = {
  id: string;
  label: string;
  selected: boolean;
  disabled: boolean;
};

export type SpeechUpdate = {
  id: number;
  state: 'preparing' | 'listening' | 'processing' | 'complete' | 'cancelled' | 'error';
  text?: string;
  message?: string;
  level?: number;
};

export type SpeechOverlayPhase = 'hidden' | 'recording' | 'cancel' | 'processing';

export type HarnessMessage =
  | { type: 'page-reset' }
  | { type: 'ready'; version?: string }
  | { type: 'drawer'; open: boolean }
  | { type: 'tools'; open: boolean }
  | { type: 'tools-available'; available: boolean }
  | { type: 'diagnostics'; entries: BrowserDiagnostic[]; dropped: number }
  | { type: 'back-state'; canGoBack: boolean }
  | { type: 'theme'; theme: 'dark' | 'light' }
  | { type: 'title'; title: string }
  | { type: 'conversation-views'; views: ConversationView[] }
  | { type: 'speech-start' | 'speech-stop' | 'speech-cancel'; id: number }
  | { type: 'speech-overlay'; phase: SpeechOverlayPhase }
  | { type: 'settings-categories'; categories: { index: number; label: string }[] }
  | { type: 'app-settings' }
  | { type: 'computer-picker' }
  | { type: 'external-link'; url: string };

export type HarnessHandle = {
  toggleSidebar(): void;
  closeSidebar(): void;
  toggleTools(): void;
  closeTools(): void;
  selectConversationView(id: string): void;
  updateSpeechInput(update: SpeechUpdate): void;
  newSession(): void;
  openSettings(): void;
  selectSettingsCategory(index: number): void;
  closeSettings(): void;
  back(): void;
  reload(): void;
};

export type HarnessViewProps = {
  ref?: Ref<HarnessHandle>;
  url: string;
  computerName: string;
  onMessage(message: HarnessMessage): void;
  onError(message: string): void;
};
