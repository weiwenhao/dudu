// Every word the interface shows that is not content. Fixed interface words are English, as in Linear (owner, 2026-10-31);
// issue titles, descriptions and what agents write are content, in whatever language they were written.
// Words marked NEW are not in the approved design and wait for the owner's review before anything ships.
export const T = {
  issues: 'Issues',
  tabs: { active: 'Active', backlog: 'Backlog', all: 'All issues' },
  status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'Canceled' },
  priority: { none: 'No priority', urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' },
  priorityOf: (name) => `Priority: ${name}`,
  addFilter: 'Add Filter…',
  filterOptions: 'Filter…',
  filterButton: 'Filter',
  fields: { status: 'Status', agent: 'Agent', agentState: 'Agent state', priority: 'Priority', project: 'Project', source: 'Source' },
  isAnyOf: 'is any of',
  is: 'is',
  removeFilter: 'Remove filter',
  clear: 'Clear',
  addFilterChip: 'Filter',
  changeStatus: 'Change status…',
  changeStatusOf: (status, title) => `${status}. Change status: ${title}`,
  noProject: 'No project', // NEW
  source: { owner: 'You', dudu: '嘟嘟', connector: 'Connector', session: 'Session' }, // NEW: the Source property of a row
  display: {
    title: 'Display options',
    list: 'List', board: 'Board',
    grouping: 'Grouping', subGrouping: 'Sub-grouping', ordering: 'Ordering', columns: 'Columns', rows: 'Rows',
    noGrouping: 'No grouping',
    groupBy: { status: 'Status', agent: 'Agent', project: 'Project', priority: 'Priority' },
    orderBy: { priority: 'Priority', status: 'Status', due: 'Due date', updated: 'Updated', created: 'Created' },
    reverse: (what) => `Reverse ${what}`,
    recency: 'Order completed by recency',
    completedIssues: 'Completed issues',
    // NEW: the choices after "All".
    completed: { all: 'All', day: 'Past day', week: 'Past week', month: 'Past month', none: 'None' },
    listOptions: 'List options', showEmptyGroups: 'Show empty groups',
    boardOptions: 'Board options', showEmptyColumns: 'Show empty columns',
    properties: 'Display properties',
    property: { id: 'ID', status: 'Status', agent: 'Agent', priority: 'Priority', project: 'Project', dueDate: 'Due date', source: 'Source', created: 'Created', updated: 'Updated' },
    reset: 'Reset',
  },
  collapse: (name) => `Collapse ${name}`, // NEW: aria-label of the triangle that folds a group
  expand: (name) => `Expand ${name}`, // NEW
  // NEW: the Activity of an issue and its page (the doc fixes the sections; the words are mine).
  detail: {
    properties: 'Properties', project: 'Project', activity: 'Activity', leaveComment: 'Leave a comment…', send: 'Send',
    needsYou: 'Needs you', untitled: 'Untitled', description: 'Add description…', loadEarlier: 'Load earlier', notFound: 'This issue does not exist.', back: 'Back to Issues',
    previous: 'Previous issue', next: 'Next issue', position: (index, total) => `${index} / ${total}`, noDueDate: 'No due date', noProjectSet: 'No project',
    setDue: 'Set due date', clearDue: 'Clear', dueDate: 'Due date', setPriority: 'Set priority…',
    // NEW: the buttons beside the title, the agent menu and the reply box (the doc names them; the words are mine).
    copyId: 'Copy ID', openSession: 'Open session', openSource: 'Open source', snooze: 'Snooze', setAgent: 'Set agent…',
    agentNote: 'A new session starts with the log of this issue as its first message. The old session is closed.',
    reply: 'Reply…', sendReply: 'Send reply', result: 'Add a result…', saveResult: 'Save', skipResult: 'Skip',
  },
  // NEW: Snooze hides what an agent asked, until the time chosen; the status does not change.
  snooze: { laterToday: 'Later today', tomorrow: 'Tomorrow', nextWeek: 'Next week', clear: 'Clear snooze', until: (date) => `Snoozed until ${date}` },
  activity: {
    you: 'You', justNow: 'just now', minutesAgo: (n) => `${n} min ago`, hoursAgo: (n) => (n === 1 ? '1 h ago' : `${n} h ago`), yesterday: 'Yesterday',
    created: 'created the issue', createdFromMessage: 'created the issue from a message', createdFromSession: 'created the issue from a session',
    status: (from, to) => `changed status from ${from} to ${to}`, priority: (to) => `changed priority to ${to}`,
    due: (date) => `set the due date to ${date}`, dueRemoved: 'removed the due date',
    assigned: (agent) => `assigned the issue to ${agent}`, unassigned: 'removed the agent', asked: 'asked', session: 'changed the session', commented: 'commented',
  },
  // NEW: the New issue window (the canvas has the button, not the window).
  newIssue: {
    title: 'New issue', description: 'Create an issue with a title and an optional description.', titlePlaceholder: 'Issue title', briefPlaceholder: 'Add description…',
    cancel: 'Cancel', create: 'Create issue', failed: 'Could not create the issue',
  },
  // NEW: ticking rows for a bulk change, and the bar that appears.
  bulk: { toolbar: 'Bulk actions', selected: (count) => `${count} selected`, clear: 'Clear selection', select: (title) => `Select ${title}` },
  // NEW: what the bar at the bottom says after a change, with its Undo.
  toast: {
    undo: 'Undo', markedDone: 'Marked as Done', status: (name) => `Status set to ${name}`, priority: (name) => `Priority set to ${name}`,
    dueSet: 'Due date set', dueRemoved: 'Due date removed', assigned: (name) => `Assigned to ${name}`, unassigned: 'Agent removed',
    updated: (count) => (count === 1 ? 'Updated 1 issue' : `Updated ${count} issues`), copied: (text) => `Copied ${text}`,
    snoozed: 'Snoozed', snoozeCleared: 'Snooze cleared', failed: 'Could not save the change',
  },
  // NEW: the Dates row of the filter menu: three fields with ready-made ranges.
  dates: {
    name: 'Dates', due: 'Due date', created: 'Created', updated: 'Updated',
    overdue: 'Overdue', today: 'Today', next7: 'Next 7 days', next30: 'Next 30 days', day: 'Past day', week: 'Past week', month: 'Past month',
  },
  // NEW: the search box and the footer of All issues.
  search: { label: 'Search issues', placeholder: 'Search issues…' },
  total: (count) => (count === 1 ? '1 issue' : `${count.toLocaleString('en-US')} issues`),
  // NEW: the + of a group bar or board column, and the menu of a board column.
  addTo: (name) => `Add issue to ${name}`,
  lane: { options: (name) => `${name} options`, collapse: 'Collapse column', expand: 'Expand column' },
  agentState: { working: 'Working', needs_you: 'Needs you', stuck: 'Stuck', idle: 'Idle' },
  noAgent: 'No agent',
  today: 'Today',
  // NEW: the hint shown when the mouse rests on a due date (the doc asks for date and days left or overdue).
  dueIn: (days) => (days === 1 ? 'in 1 day' : `in ${days} days`),
  overdue: (days) => (days === 1 ? '1 day overdue' : `${days} days overdue`),
  // NEW: empty and failed states of the list.
  empty: 'No issues',
  loadFailed: 'Could not load issues',
  retry: 'Retry',
};
