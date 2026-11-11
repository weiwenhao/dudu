import type { ComponentType, ReactNode } from 'react';

export interface WidgetDeclaration {
  id: `${string}.${string}`;
  label: string;
  description: string;
  /**
   * Sizes count the cells of the dashboard: fifteen columns, and rows about as tall as a column is wide (the grid first had ten columns and
   * then twenty, so a size written for the ten is a half more cells now, and one written for the twenty a quarter fewer). `min` is the smallest size whose content still reads; `size` is the recommended one that
   * "add" uses. As a recommended size, 'fill' is every column (w) or every row the window shows (h).
   */
  min: { w: number; h: number };
  size: { w: number | 'fill'; h: number | 'fill' };
  needs: ('issues' | 'quota' | 'inputs' | 'sessions' | 'network')[];
  preview?: string;
  source?: string;
  widgetApi?: 1;
  development?: boolean;
}

export interface WidgetResult<T = unknown> {
  status: 'loading' | 'ready' | 'error';
  value: T | null;
}

export interface WidgetIssue {
  id: number;
  ref: string | null;
  title: string;
  brief: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled';
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  agent: string | null;
  agentState: 'idle' | 'working' | 'blocked';
  ask: string;
  dueAt: number | null;
  project: { name: string; path: string | null } | null;
  createdAt: number;
  updatedAt: number;
  [field: string]: unknown;
}

export interface WidgetIssues {
  items: WidgetIssue[];
  total: number;
  nextCursor: string | null;
  groups?: unknown[];
  [field: string]: unknown;
}

/** What the quota service has kept (read by a person opening the quota panel; a widget only looks): one entry for each provider whose usage could be read. */
export interface WidgetQuota {
  providers: {
    id: string;
    /** The logo's key: several entries may be one agent's (DeepSeek's account and key). */
    agent: string;
    name: string;
    plan?: string | null;
    kind?: 'balance';
    windows: { key: string; label: string; used: number; resetsAt?: number | null; core?: boolean }[];
    balance?: { text: string }[];
    /** When this was read (ms), which may be well before now. */
    readAt: number | null;
  }[];
  refreshing: boolean;
  readAt: number | null;
}

export interface WidgetCollector {
  id: string;
  name: string;
  readToday: number;
  createdToday: number;
  lastRead: { at: number; ok: boolean; items?: number; created?: number } | null;
}

export interface WidgetInputs {
  createdToday: number;
  /** What each collector last brought (a collector reads through a connector; the connector itself collects nothing). */
  collectors: WidgetCollector[];
  /** The same rows as `collectors`, kept under the name this field had before connectors and collectors were told apart. */
  connectors: WidgetCollector[];
}

export interface WidgetSession {
  id: string;
  key: string;
  provider: string;
  dshSessionId?: string;
  title: string;
  agent?: string;
  cwd?: string;
  project?: { name: string; path: string } | null;
  updatedAt: number;
  previewVersion?: string | null;
  evidence?: { text: string } | null;
  [field: string]: unknown;
}

export interface WidgetSessions {
  sessions: WidgetSession[];
  total?: number;
  indexing?: { running: boolean };
}

export interface WidgetProps {
  size: { cols: number; rows: number; width: number; height: number };
  editing: boolean;
  useIssues(view?: Record<string, unknown>): WidgetResult<WidgetIssues>;
  useQuota(): WidgetResult<WidgetQuota>;
  useInputs(): WidgetResult<WidgetInputs>;
  useSessions(query?: Record<string, unknown>): WidgetResult<WidgetSessions>;
  /** Read conversation text without importing it or creating an issue; before is an exclusive pagination cursor. */
  readSession(session: { provider: string; id: string; before?: number }): Promise<{
    outcome: 'success' | 'error';
    messages?: { role: 'user' | 'assistant'; at?: number; text: string }[];
    nextCursor?: number | null;
    code?: string;
  }>;
  openIssue(id: number | string, ids?: number[]): void;
  openSession(session: { provider: string; id: string; dshSessionId?: string }): Promise<void>;
  /** Explicit owner action: attach an existing conversation to an issue without prompting the worker. */
  takeOverSession(session: { provider: string; id: string }): Promise<{
    outcome: 'success' | 'no_op' | 'needs_clarification' | 'error';
    issue?: WidgetIssue;
    code?: string;
  }>;
  /** Render the hosted Issues interface. Its controls handle owner edits without exposing a write API. */
  renderIssues(): ReactNode;
}

export function defineWidget(declaration: WidgetDeclaration, Component: ComponentType<WidgetProps>): ComponentType<WidgetProps> & { readonly duduWidget: Readonly<WidgetDeclaration> };

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'dudu.widget': { kind: 'list'; scope: 'root'; owner: WidgetProps };
  }
}
