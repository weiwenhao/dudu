// Shared example data and browser assertions for a widget's preview, inspector and CI.
export function exampleData(at = new Date(2026, 9, 31, 12).getTime()) {
  const items = [
    { id: 1, ref: null, title: '准备续费资料', brief: '确认本次续费的范围。', status: 'todo', priority: 'high', agent: null, ask: '', agentState: 'idle', dueAt: at + 86400000, createdAt: at, updatedAt: at, source: 'owner', project: null },
    { id: 2, ref: 'CON-1', title: '补齐合同附件', brief: '还缺一份附件。', status: 'in_progress', priority: 'medium', agent: 'claude', ask: '附件放在哪里？', agentState: 'needs_you', dueAt: at - 86400000, createdAt: at, updatedAt: at, source: 'connector', project: { name: 'Contract', path: '/work/contract' } },
  ];
  return {
    issues: { outcome: 'success', items, total: items.length, nextCursor: null, groups: [], counts: { active: 2, backlog: 0, all: 2 }, facets: {} },
    quota: { providers: [{ id: 'claude', name: 'Claude', plan: 'Max', state: 'ok', windows: [{ key: 'five', label: '5-hour', used: 0.74, resetsAt: at + 7200000 }] }] },
    inputs: { outcome: 'success', createdToday: 2, connectors: [{ id: 'example', name: 'Example', readToday: 12, createdToday: 2, lastRead: { at, ok: true, items: 12, created: 2 } }] },
    sessions: { outcome: 'success', sessions: [{ key: 'claude:example', id: 'example', provider: 'claude', title: '准备续费资料', updatedAt: at, evidence: { text: '正在检查附件。' } }], indexing: { running: false } },
  };
}

export function exampleWidgetProps(data = exampleData()) {
  const ready = (value) => ({ status: 'ready', value });
  return {
    editing: false,
    useIssues: () => ready(data.issues), useQuota: () => ready(data.quota),
    useInputs: () => ready(data.inputs), useSessions: () => ready(data.sessions),
    openIssue() {}, async openSession() {},
    async readSession() { return { outcome: 'success', messages: [{ role: 'assistant', text: '正在检查附件。' }], nextCursor: null }; },
    async takeOverSession() { return { outcome: 'no_op', issue: data.issues.items[0] }; },
    renderIssues: () => null,
  };
}

// A recommended size of 'fill' is a window: thirteen of the grid's fifteen columns, nine rows.
export function widgetCases(declaration) {
  return ['min', 'size'].flatMap((key) => ['light', 'dark'].map((theme) => ({
    name: `${key}-${theme}`, theme,
    size: { cols: declaration[key].w === 'fill' ? 13 : declaration[key].w, rows: declaration[key].h === 'fill' ? 9 : declaration[key].h },
  })));
}

/** Run in the browser after rendering. Scrolling containers may overflow; their children must stay inside them. */
export function inspectWidget(element) {
  if (!element) return { fits: false, accessible: false };
  const scrolls = (node, axis) => /auto|scroll/.test(getComputedStyle(node)[axis]);
  const fits = [...element.querySelectorAll('*'), element].every((node) => {
    if (!(node instanceof HTMLElement) || !node.clientWidth || !node.clientHeight) return true;
    const style = getComputedStyle(node);
    if (style.position === 'absolute' || style.position === 'fixed' || style.whiteSpace === 'nowrap') return true;
    const checkX = node === element || /hidden|clip/.test(style.overflowX);
    const checkY = node === element || /hidden|clip/.test(style.overflowY);
    return (!checkX || node.scrollWidth <= node.clientWidth + 2 || scrolls(node, 'overflowX')) &&
      (!checkY || node.scrollHeight <= node.clientHeight + 2 || scrolls(node, 'overflowY'));
  });
  const accessible = [...element.querySelectorAll('button')].every((node) =>
    node.getAttribute('aria-label')?.trim() || node.getAttribute('aria-labelledby')?.trim() || node.textContent.trim() || node.getAttribute('title')?.trim());
  return { fits, accessible };
}
