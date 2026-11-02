import type { WidgetDeclaration, WidgetProps } from './widget.d.ts';
export function exampleData(at?: number): Record<'issues' | 'quota' | 'inputs' | 'sessions', unknown>;
export function exampleWidgetProps(data?: ReturnType<typeof exampleData>): Omit<WidgetProps, 'size'>;
export function widgetCases(declaration: WidgetDeclaration): { name: string; theme: 'light' | 'dark'; size: { cols: number; rows: number } }[];
export function inspectWidget(element: Element | null): { fits: boolean; accessible: boolean };
