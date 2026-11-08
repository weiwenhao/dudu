import { T } from '../strings.js';
import { STATUS_ORDER } from './model.js';

const categories = { backlog: 'backlog', todo: 'unstarted', in_progress: 'started', in_review: 'started', done: 'completed', canceled: 'canceled' };
let definitions = STATUS_ORDER.map((id, position) => ({ id, type: id, category: categories[id], position, name: null, color: null, description: '', isDefault: id === 'todo', archived: false }));
const listeners = new Set();
let revision = 0;

export const subscribeWorkflow = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const workflowRevision = () => revision;
export const workflowStatuses = () => definitions;
export const statusDefinition = (id) => definitions.find((status) => status.id === id);
export const statusLabel = (id) => statusDefinition(id)?.name || T.status[id] || id;
export const statusType = (id) => statusDefinition(id)?.type ?? id;
export function statusOrder(tab, activeFirst = false) {
  const statuses = definitions.filter((status) => !status.archived &&
    (tab === 'backlog' ? status.category === 'backlog' : tab === 'active' ? ['unstarted', 'started'].includes(status.category) : true));
  if (activeFirst) {
    const categories = ['started', 'unstarted', 'backlog', 'completed', 'canceled'];
    statuses.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.position - b.position);
  }
  return statuses.map((status) => status.id);
}

export function receiveStatuses(statuses) {
  if (!Array.isArray(statuses) || !statuses.length || JSON.stringify(statuses) === JSON.stringify(definitions)) return;
  definitions = statuses;
  revision++;
  for (const listener of listeners) listener();
}
