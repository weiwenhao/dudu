import type { ReactNode, ComponentType } from 'react';
export const Frame: ComponentType<{ title: string; hideTitle?: boolean; action?: ReactNode; className?: string; children?: ReactNode }>;
export const Empty: ComponentType<{ children?: ReactNode }>;
export const Row: typeof Empty;
export const Badge: typeof Empty;
export const WidgetNumber: ComponentType<{ value: ReactNode; label: string }>;
export const ProgressBar: ComponentType<{ value: number; label: string }>;
