import { createElement as h } from 'react';

export function Frame({ title, action, hideTitle = false, className = '', children }) {
  return h('section', { 'aria-label': title, className: 'du-widget-frame' },
    !hideTitle && h('header', { className: 'du-widget-header' }, h('h2', null, title), action),
    h('div', { className: `du-widget-content ${className}` }, children));
}
export const Empty = ({ children }) => h('div', { className: 'du-widget-empty' }, children);
export const Row = ({ children }) => h('div', { className: 'du-widget-row' }, children);
export const WidgetNumber = ({ value, label }) => h('div', { className: 'du-widget-number' }, h('strong', null, value), h('span', null, label));
export const Badge = ({ children }) => h('span', { className: 'du-widget-badge' }, children);
export function ProgressBar({ value, label }) {
  const bounded = Math.min(100, Math.max(0, Number(value) || 0));
  return h('div', { className: 'du-widget-progress', role: 'progressbar', 'aria-label': label, 'aria-valuenow': bounded, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('span', { style: { width: `${bounded}%` } }));
}
