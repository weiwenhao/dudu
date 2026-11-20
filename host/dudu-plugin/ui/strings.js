// Interface language follows DSH. Issue titles, descriptions and messages keep their original content.
// Words marked NEW are not in the approved design and wait for the owner's review before anything ships.
import { localized } from './lib/locale.mjs';
import { compileDiagnostics } from './lib/diagnostics.mjs';
import { TEXT as CONNECTOR_TEXT } from '../../assistant/connectors/text.mjs';

// Owner-approved color names, 2026-11-10. Keep these exact reviewed names in both
// locales until English names are reviewed too; Color and Default already exist.
const NEEDS_YOU_COLORS = {
  mist: '雾蓝', indigo: '靛蓝', teal: '青绿', mauve: '灰紫', 'rose-gray': '玫瑰灰', slate: '蓝灰', gold: '金色',
  blue: '亮蓝', violet: '电光紫', orange: '鲜橙', rose: '玫红', green: '墨绿', graphite: '石墨黑',
};

// Current-conversation find proposal approved by the owner, 2026-11-17.
// Keep the reviewed Chinese wording in both locales until English wording is reviewed.
const CONVERSATION_FIND = { label: '搜索当前会话', empty: '无匹配', previous: '上一处', next: '下一处' };

const en = {
  conversationFind: CONVERSATION_FIND,
  needsYouColors: NEEDS_YOU_COLORS,
  // Scheduled-task modal design approved by the owner, 2026-11-10.
  // NEW: targets.new/existing, kinds.weekly/monthly/interval/cron, delivery.delivering/failed/uncertain await review (docs/issues-ui-wording.md).
  // NEW (2026-11-11): runFailed, in front of the reason when a run of a task of 嘟嘟 failed (its line in 嘟嘟's conversation); it awaits the owner's review. 嘟嘟 as a provider is the brand word, not a new one.
  tasks: {
    title: 'Tasks', search: 'Search tasks', create: 'New task', manual: 'Create manually', inConversation: 'Create in conversation',
    all: 'All statuses', statuses: { active: 'Enabled', paused: 'Paused', ended: 'Ended' },
    rules: 'Rules', history: 'Task run history', name: 'Automation task name', prompt: 'Automation task content', provider: 'Provider', model: 'Model', defaultModel: 'Default model',
    target: 'Run in', workspace: 'Workspace', timing: 'Run time', timezone: 'Time zone', next: 'Next run',
    targets: { reuse: 'Create a conversation and reuse it', new: 'New conversation each run', existing: 'Existing conversation' },
    kinds: { daily: 'Every day', workdays: 'Monday to Friday', weekly: 'Every week', monthly: 'Every month', interval: 'Interval', once: 'Once', cron: 'Cron' },
    pause: 'Pause task', resume: 'Resume task', run: 'Run now', duplicate: 'Duplicate task', delete: 'Delete task',
    linked: 'Linked conversation', unsaved: 'You have unsaved changes', discard: 'Discard', save: 'Save changes', more: 'Load more', optionsFailed: 'Could not load', // NEW (2026-11-18): the retry button in the window's header when the providers, models and workspaces could not be read
    delivery: { delivered: 'Delivered', delivering: 'Delivering', failed: 'Delivery failed', uncertain: 'Needs confirmation' },
    runFailed: 'Run failed', // NEW
  },
  // The scheduled tasks of a conversation, in its header (owner, 2026-11-17; `.local/designs/session-schedules-2026-11-17/`). count ("{N} 个定时任务"), list and confirmDelete (DSH's own "Click again to confirm"
  // of its stop button, for delete) were shown to the owner with the design and approved on 2026-11-17 ("就按你定的来吧"). copy, copied and noOutput are the words of DSH's own terminal block. Everything else
  // in the control is the tasks window's words (T.tasks).
  sessionTasks: {
    count: (n) => (n === 1 ? '1 scheduled task' : `${n} scheduled tasks`), list: 'Scheduled tasks',
    copy: 'Copy', copied: 'Copied', noOutput: '(no output)', confirmDelete: 'Click again to confirm delete',
  },
  brand: 'Dudu',
  issues: 'Issues',
  tabs: { active: 'Active', backlog: 'Backlog', all: 'All' },
  status: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', canceled: 'Canceled' },
  priority: { none: 'No priority', urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' },
  priorityOf: (name) => `Priority: ${name}`,
  addFilter: 'Add Filter…',
  filterOptions: 'Filter…',
  filterButton: 'Filter',
  fields: { status: 'Status', agent: 'Agent', sessionState: 'Session status', priority: 'Priority', project: 'Project', source: 'Source', label: 'Labels' }, // NEW: Session status, docs/issues-ui-wording.md
  isAnyOf: 'is any of',
  is: 'is',
  removeFilter: 'Remove filter',
  command: { suggestions: 'Suggestions' }, // NEW: the menu's option list, for screen readers
  clear: 'Clear',
  addFilterChip: 'Filter',
  changeStatus: 'Change status…',
  changeStatusOf: (status, title) => `${status}. Change status: ${title}`,
  noProject: 'No project', // NEW
  source: { owner: 'You', dudu: 'Dudu', connector: 'Collector', session: 'Session' }, // NEW: the Source property of a row; the owner's role is "you" (2026-11-04); an issue made from collected records says Collector (2026-11-05)
  // Linear due-date menu wording approved by the owner (2026-11-02).
  due: { placeholder: 'Try: 24h, 7 days, Feb 9', remove: 'Remove due date', custom: 'Custom…', weekEnd: 'End of this week', oneWeek: 'In one week' },
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
    property: { id: 'ID', status: 'Status', agent: 'Agent', priority: 'Priority', project: 'Project', labels: 'Labels', dueDate: 'Due date', source: 'Source', created: 'Created', updated: 'Updated' },
    reset: 'Reset',
  },
  collapse: (name) => `Collapse ${name}`, // NEW: aria-label of the triangle that folds a group
  expand: (name) => `Expand ${name}`, // NEW
  // NEW: the Activity of an issue and its page (the doc fixes the sections; the words are mine).
  detail: {
    menuDetails: 'Open issue', // Existing English copy; the owner supplied the Chinese menu label on 2026-11-10.
    duduMention: 'Dudu', // Name supplied by the owner.
    mention: 'Mention',
    messageErrors: {
      invalid_message: 'Write a message first.', multiple_targets: 'Mention one recipient at a time.',
      choose_agent: 'Choose an agent first.', empty_request: 'Add a message after the mention.',
      recipient_unavailable: 'Mention the recipient assigned to this issue.',
      choose_project: 'Choose a project before sending work to an agent.',
      delivery_failed: 'Your comment was saved, but the request could not be delivered.',
    }, // NEW
    // NEW: issue-level forgetting names the exact local scope before deletion.
    more: 'More',
    properties: 'Properties', project: 'Project', source: 'Source', activity: 'Activity', leaveComment: 'Leave a comment…', send: 'Send',
    untitled: 'Untitled', description: 'Add description…', loadEarlier: 'Load earlier', showMore: 'Show more', showLess: 'Show less', notFound: 'This issue does not exist.', back: 'Back to Issues', // NEW: showMore, showLess
    previous: 'Previous issue', next: 'Next issue', position: (index, total) => `${index} / ${total}`, noDueDate: 'No due date', noProjectSet: 'No project',
    clearDue: 'Clear', dueDate: 'Due date', setPriority: 'Set priority…',
    // NEW: the buttons beside the title, the agent menu and the reply box (the doc names them; the words are mine).
    copyId: 'Copy ID', openSession: 'Open session', openSource: 'Open source', snooze: 'Snooze', setAgent: 'Set agent…',
    agentNote: 'Starts a new session. The old one is closed.',
    reply: 'Leave a reply…', sendReply: 'Send reply', result: 'Add a result…', saveResult: 'Save', skipResult: 'Skip',
  },
  // NEW: Snooze hides what an agent asked, until the time chosen; the status does not change.
  snooze: { laterToday: 'Later today', tomorrow: 'Tomorrow', nextWeek: 'Next week', clear: 'Clear snooze', until: (date) => `Snoozed until ${date}` },
  activity: {
    you: 'You', unknownTime: '—', justNow: 'just now', minutesAgo: (n) => `${n}m ago`, hoursAgo: (n) => `${n}h ago`, yesterday: 'Yesterday', // 2h ago, as the design writes it
    created: 'created the issue', createdFromMessage: 'created the issue from a message', createdFromSession: 'created the issue from a session',
    status: (from, to) => `changed status from ${from} to ${to}`, priority: (to) => `changed priority to ${to}`,
    due: (date) => `set the due date to ${date}`, dueRemoved: 'removed the due date',
    assigned: (agent) => `assigned the issue to ${agent}`, unassigned: 'removed the agent', asked: 'asked', session: 'changed the session', commented: 'commented',
    sessionStarted: (agent) => `started a session with ${agent}`, sessionClosed: 'closed the session', sessionResumed: 'resumed the session',
    // NEW: stored system messages; user and model content keeps its original language.
    whoShouldTake: 'Who should handle this?',
    failed: (reason) => `Something went wrong: ${reason}. What should we do?`, noReason: 'No reason given',
    notStarted: (reason) => `Could not start: ${reason}. Choose another agent, or try later?`,
    notDelivered: (reason) => `Could not send the reply to the session: ${reason}`,
    access: 'access', requestedAccess: 'asked for', allowedAccess: 'ASSIGN.md allows',
    sessionDropped: 'the session it named was not offered, so a new one starts',
    urgentNeedsRule: 'Urgent needs a rule in TRIAGE.md; the priority comes from impact and effort.',
  },
  // NEW: the New issue window (the canvas has the button, not the window).
  newIssue: {
    title: 'New issue', description: 'Create an issue with a title and an optional description.', titlePlaceholder: 'Issue title', briefPlaceholder: 'Add description…',
    cancel: 'Cancel', create: 'Create issue', failed: 'Could not create the issue',
  },
  // NEW: ticking rows for a bulk change, and the bar that appears.
  bulk: { toolbar: 'Bulk actions', selected: (count) => `${count} selected`, clear: 'Clear selection', select: (label) => `Select ${label}`, selectAll: 'Select all' },
  // NEW: what the bar at the bottom says after a change, with its Undo.
  toast: {
    markedDone: 'Marked as Done', status: (name) => `Status set to ${name}`, priority: (name) => `Priority set to ${name}`,
    dueSet: 'Due date set', dueRemoved: 'Due date removed', assigned: (name) => `Assigned to ${name}`, unassigned: 'Agent removed',
    updated: (count) => (count === 1 ? 'Updated 1 issue' : `Updated ${count} issues`), copied: (text) => `Copied ${text}`,
    snoozed: 'Snoozed', snoozeCleared: 'Snooze cleared', failed: 'Could not save the change',
    region: 'Notifications',
  },
  // NEW: the Dates row of the filter menu: three fields with ready-made ranges.
  dates: {
    name: 'Dates', due: 'Due date', created: 'Created', updated: 'Updated',
    overdue: 'Overdue', today: 'Today', next7: 'Next 7 days', next30: 'Next 30 days', day: 'Past day', week: 'Past week', month: 'Past month',
  },
  // NEW: the search box and the footer of All issues.
  search: { label: 'Search issues', placeholder: 'Search issues…' },
  total: (count) => (count === 1 ? '1 issue' : `${count.toLocaleString('en-US')} issues`),
  // NEW: the Collector widget. The owner approved its design and these words on 2026-11-05 ("没问题，就按你的推荐实现吧"); the rest is Issues' own (Filter, Clear, Dates, New issue, Open source, Open issue, Search issues…, Undo).
  collector: {
    select: 'Select', // Existing bulk-selection wording; moved to the context menu at the owner's request, 2026-11-09.
    tabs: { todo: 'To handle', done: 'Handled' },
    empty: 'Nothing here', loadFailed: 'Could not load the information',
    shareSession: 'Forward', restore: 'Restore', // Forward: the owner's word (2026-11-18, "我们不应该叫分享了，我们也改成叫转发吧"; it was Share to session); the English is mine
    markDone: 'Handled', remove: 'Delete', // NEW (2026-11-07): the owner's buttons 已处理 and 删除 ("collected information is often wrong"); the English names are mine
    complete: 'Fill in context', // NEW (2026-11-11): 补全上下文, the owner's own phrase ("让收集信息对应的会话去继续补全这一条信息的上下文"); the English name is mine
    toast: { restored: 'Restored', done: 'Handled', deleted: 'Deleted', sharedSession: (ref) => `Forwarded to ${ref}` }, // NEW: sharedSession (the phone's "已转发到 {0}"), done, deleted
    // The line of the dialog about which issue the record went to: "Dudu made [DUD-12]" (an issue it made before it stopped making them), and what the owner did ("Forwarded to [DUD-12]", then the issue's status icon and number)
    verdict: { made: 'made', shared: 'Forwarded to', created: 'Created' },
  },
  // NEW: the + of a group bar or board column, and the menu of a board column.
  addTo: (name) => `New issue in ${name}`, // the design's label for the + of a group or column
  lane: { options: 'Column options', collapse: 'Collapse column', expand: 'Expand column' },
  // The dashboard. "Edit layout", "Add widget", "Restore default" and "Done" are the design's words; the rest is mine (NEW).
  dashboard: {
    menu: 'Dudu menu', // NEW
    editLayout: 'Edit layout', editHint: 'Drag to move, pull an edge to resize', addWidget: 'Add widget', restoreDefault: 'Restore default', done: 'Done', // the hint is the design's line
    settings: 'Settings', board: 'Dashboard', remove: 'Remove widget', addTitle: 'Add widget', addDescription: 'Pick a widget to put on the dashboard.', added: 'Added',
    searchWidgets: 'Search widgets', fullWidth: 'Full width', fullHeight: 'Full height', // design/ui.html gallery; Chinese translations await review; Full height is NEW (2026-11-01)
    add: 'Add', source: (name) => `From ${name}`, noMore: 'Every widget is on the dashboard.',
    minimum: 'Minimum size', maximum: 'Maximum size', undo: 'Undo',
    placed: (name, x, y) => `${name}: column ${x}, row ${y}`, sized: (name, w, h) => `${name}: ${w} by ${h}`,
    broken: (name) => `This widget could not be shown`, brokenFrom: (source) => `From ${source}`, missing: (source) => `This widget comes from ${source}, which is not installed.`,
    loadFailed: 'Could not load the dashboard', retry: 'Retry', saveFailed: 'Could not save the layout',
    actionAdded: (name) => `Added「${name}」`, actionRemoved: (name) => `Removed「${name}」`,
    actionMoved: (name) => `Moved「${name}」`, actionResized: (name, w, h) => w === 'fill' || h === 'fill' ? `「${name}」resized to ${w === 'fill' ? 'full width' : w} × ${h === 'fill' ? 'full height' : h}` : `「${name}」resized to ${w}×${h}`, restored: 'Restored default', changed: 'Changed layout',
  },
  projects: { choose: 'Choose a project', create: 'Create project', empty: 'No projects yet', loading: 'Loading projects…', failed: 'Could not load projects' }, // NEW
  // NEW (2026-11-05): labels and sub-issues, after Linear (the owner's screenshots). The words are Linear's where the screenshots show them and mine elsewhere; they await the owner's review.
  labels: {
    name: 'Labels', add: 'Add label', search: 'Change or add labels…', create: (name) => `Create new label: "${name}"`, pickColor: 'Pick a color for label',
    colors: { grey: 'Grey', darkGrey: 'Dark Grey', purple: 'Purple', teal: 'Teal', green: 'Green', yellow: 'Yellow', orange: 'Orange', pink: 'Pink', red: 'Red' },
    loading: 'Loading labels…', failed: 'Could not load labels', createFailed: 'Could not create the label', empty: 'No labels yet',
  },
  subIssues: {
    add: 'Add sub-issue', addMore: 'Add sub-issues', title: 'Sub-issues', placeholder: 'Sub-issue title', parent: 'Parent issue', subIssueOf: 'Sub-issue of',
    setParent: 'Set parent issue…', removeParent: 'Remove parent', searchParent: 'Search issues…', progress: (done, total) => `${done}/${total}`, noMatch: 'No issues found',
    createFailed: 'Could not create the sub-issue',
  },
  newIssue2: { more: 'More', parent: 'Parent issue' },
  // NEW: Linear's Copy submenu (2026-11-05): the words are Linear's; what each puts on the clipboard is in issues/copy.js.
  copy: {
    menu: 'Copy', title: 'Copy title', markdown: 'Copy issue as Markdown', everything: 'Copy everything as Markdown', branch: 'Copy git branch name', prompt: 'Copy as prompt', duplicate: 'Make a copy…',
    done: { title: 'title', markdown: 'issue as Markdown', everything: 'everything as Markdown', branch: 'git branch name', prompt: 'prompt' },
  },
  // NEW: the links of an issue (2026-11-05); the menu words are Linear's, the window's are mine.
  // NEW: the description's rich text (2026-11-05): the "/" menu, the bar over selected text; Linear's words where it has them.
  // NEW: the description history (2026-11-05): "Show description history" is Linear's word, the window's are mine.
  descriptionHistory: { menu: 'Show description history', title: 'Description history', current: 'Current version', restore: 'Restore this version', close: 'Close', none: 'The description has not been changed.', empty: 'The description was empty.' },
  // NEW: saved views (2026-11-05): "Add new view" and "Create view" are Linear's words, the rest are mine.
  views: {
    add: 'Add new view', newTitle: 'New view', renameTitle: 'Rename view', name: 'View name', create: 'Create view', save: 'Save', rename: 'Rename', delete: 'Delete view',
    deleteTitle: (name) => `Delete view "${name}"?`, deleteScope: 'The view is deleted. The issues in it stay.',
  },
  richText: {
    menu: 'Blocks', linkPlaceholder: 'Paste or type a link…',
    blocks: { heading1: 'Heading 1', heading2: 'Heading 2', heading3: 'Heading 3', bulletList: 'Bulleted list', orderedList: 'Numbered list', taskList: 'Checklist', quote: 'Quote', codeBlock: 'Code block', divider: 'Divider' },
    format: { bold: 'Bold', italic: 'Italic', strike: 'Strikethrough', code: 'Code', link: 'Link' },
  },
  links: {
    title: 'Links', add: 'Add link…', addPullRequest: 'Add pull request…', addDocument: 'Add document…', url: 'URL', titleOptional: 'Title (optional)', addButton: 'Add',
    dialog: { link: 'Add link', pull_request: 'Add pull request', document: 'Add document' }, remove: (name) => `Remove ${name}`,
    invalid: 'Enter a web address that starts with http:// or https://', duplicate: 'This link is on the issue already.',
  },
  // NEW: the delete confirmation, in Linear's shape (2026-11-05). Linear says deleted issues stay 30 days in "Recently deleted"; here a deleted issue is gone, so the sentence says what is deleted and what stays.
  deleteIssue: {
    title: (name) => `Delete "${name}"?`, titleMany: (count) => `Delete ${count} issues?`,
    scope: 'This issue, its activity and local links will be deleted. Source messages and session history stay.',
    scopeMany: 'These issues, their activity and local links will be deleted. Source messages and session history stay.',
  },
  // NEW: the words of the small widgets (the design names the widgets and what they show, not their wording).
  widgets: {
    titles: { issues: 'Issues', quota: 'Quota', sessions: 'Sessions', office: 'Office', collector: 'Inbox' },
    descriptions: {
      issues: 'Every issue, as a list or a board',
      office: 'Assigned active issues as people at desks',
      collector: 'What the collectors collected, to forward to a conversation or make an issue of', // NEW
    },
    needs: { issues: 'issues', quota: 'quota', inputs: 'inputs', sessions: 'sessions', network: 'network' },
    quota: {
      // NEW: what is left of a window, in a block of the quota panel and its card ("5-hour 79% left"; the number is told apart from the words by where it stands in the line).
      leftLine: (window, percent) => `${window} ${percent}% left`,
      empty: 'No usage to show', unknown: '—', fiveHour: '5-hour', weekly: 'Weekly', days: (n) => `${n}-day`, used: (label, percent) => `${label} ${percent}% used`,
      resets: (when) => `resets ${when}`, resetsAt: (when) => `Resets ${when}`, limitReached: (when) => `Limit reached, resets ${when}`, label: (name, percent) => `${name} ${percent}% used`,
      balance: 'Balance', // NEW: the wallet of DeepSeek's account, beside its amount
      until: (date) => `Until ${date}`, // NEW (2026-11-11, magpie's own words from the owner's screenshot): when the plan's paid time ends, after the plan's name; awaits the owner's review
      updated: (when) => `Updated ${when}`, // NEW (2026-11-11): the time of the reading a panel shows, at the top of the quota panel behind the header icon; awaits the owner's review
    },
    sessions: {
      search: 'Search sessions', empty: 'No sessions', failed: 'Could not read sessions',
      // NEW (2026-11-05): what a search cannot see, in grey under the results once something is searched for; and a list that is not complete.
      unsearchable: (count) => (count === 1 ? '1 session cannot be searched, so results may be incomplete' : `${count} sessions cannot be searched, so results may be incomplete`),
      indexing: (done, total) => `Building the search index (${done}/${total}), so results may be incomplete`,
      listPartial: 'Some sessions could not be read, so the list may be incomplete',
      history: 'Conversation history', importLabel: 'Import', takeOverLabel: 'Take over', noMessages: 'No messages', // NEW; Chinese action labels supplied by the owner
      clear: 'Clear search', more: 'More sessions', openFailed: 'Could not open this session.', takeoverLabel: 'Let Dudu manage this task', // NEW
      takeoverFailed: 'Could not take over this session.', openIssue: 'Open issue', // NEW
      takeoverSuccess: 'Session taken over', // NEW: Chinese supplied by the owner, English awaits review (2026-11-05).
      agents: { claude: 'Claude', codex: 'ChatGPT', pi: 'Pi', dsh: 'DeepSeek Harness' },
    },
  },
  // The approved settings layout and Chinese copy; English translations and NEW states await review.
  settings: {
    title: 'Settings', openFolder: 'Open project folder', failed: 'Could not load this page', retry: 'Retry', unavailable: 'The project folder could not be opened.',
    nav: { general: 'General', statuses: 'Status', connectors: 'Connectors', collectors: 'Collectors', rules: 'Rules', memory: 'Memory', skills: 'Skills', providers: 'Providers', phone: 'Phone control' }, // NEW: the two existing DSH sections embedded here
    // The same words as forgetting a memory (`memory.willDelete`, `cancel`, `confirmForget`): the window that asks before a connector or a collector is deleted.
    confirmDelete: { title: 'This will be deleted', cancel: 'Cancel', delete: 'Delete' },
    // NEW: Linear-style workflow settings; exact wording awaits owner review.
    statuses: {
      title: 'Status', name: 'Name', description: 'Description', color: 'Color', create: 'Create', add: (category) => `Add status to ${category}`,
      // Owner approved the Chinese preview on 2026-11-10; English wording awaits review.
      icon: '状态图标', progress: '完成度',
      options: 'Status options', reorder: 'Reorder', moveUp: 'Move up', moveDown: 'Move down', makeDefault: 'Set as default', moveIssues: 'Move issues to',
      categories: { backlog: 'Backlog', unstarted: 'Unstarted', started: 'Started', completed: 'Completed', canceled: 'Canceled' },
      errors: {
        unknown_status: 'This status no longer exists.', invalid_status: 'Check the status name and color.',
        duplicate_status: 'A status with this name already exists.', last_status: 'Keep at least one status in each category.',
        status_in_use: 'Choose a status for the existing issues.',
      },
    },
    general: {
      folder: 'Project folder', isDefault: 'Default', change: 'Change…', path: 'Folder path', moveFiles: 'Move the files into it', save: 'Save', cancel: 'Cancel',
      issues: 'Issues', exportIssues: 'Export issues', export: 'Export', exportFailed: 'Could not export the issues',
      // NEW: General controls for the conversation and the existing pet settings.
      pet: 'Pet', showPet: 'Show pet', doubleSpace: 'Double Space to open conversation', holdSpace: 'Hold Space for voice input',
      model: 'Model', changeModel: 'Change in DSH', lastTidy: 'Last tidy', noTidy: 'Not tidied yet',
      deepSleep: 'Deep sleep', // NEW (2026-11-05): the owner's word 深度睡眠, a switch in the Issues card; the English name awaits review
    },
    // NEW (2026-11-05): a connector is how to reach a service (a Prompt, or an MCP server); what to collect and how often are the collector's.
    // What is left of the first connectors page is what the redrawn page (connectorsPage, below) and other pages still use.
    connectors: {
      name: 'Name', kind: { prompt: 'Prompt', mcp: 'MCP' }, needsAuth: 'Needs authorization',
      inUse: (names) => `Collectors still use it: ${names.join(', ')}`,
      empty: 'No connectors', remove: 'Remove', removeOf: (name) => `Remove ${name}`,
    },
    // NEW (2026-11-06): the connectors page redrawn after Claude's and Muse's. The words are the owner's table in docs/issues-ui-wording.md ("2026-11-06 连接器页重画"); English awaits review.
    connectorsPage: {
      addCustom: 'Add custom connector', addLabel: 'Connector', search: 'Search', back: 'Back',
      views: { available: 'Available', connected: 'Connected' },
      groups: { here: 'This computer', work: 'Work', projects: 'Projects', dev: 'Development', web: 'Web' }, // NEW: Projects and Web (the owner's list of 2026-11-06)
      connect: 'Connect', authorize: 'Authorize', disconnect: 'Disconnect',
      address: 'Address', tools: 'Tools', toolsValue: (n) => String(n),
      // the grey line under a connected connector's name
      about: { tools: (n) => (n === 1 ? '1 tool' : `${n} tools`), commandLine: (command) => `Command line · ${command}`, thisComputer: (command) => `This computer · ${command}` },
      // what a connector says of itself while it connects, and the line that tells what to do about it
      state: {
        waiting: 'Waiting for the browser…', timedOut: 'Connection timed out', needsLogin: 'Needs sign-in', missing: 'Not installed',
        login: (command) => `Run ${command} in a terminal, then retry`,
        notFound: (command, install) => (install ? `Not found: ${command}. Install: ${install}` : `Not found: ${command}`),
      },
      // the page of one box
      custom: {
        placeholder: 'Paste an address or command, or write a sentence on how to read it', checking: 'Checking…',
        kind: { remote: 'Remote', local: 'Local', sentence: 'Command line' },
        how: { oauth: 'Sign in in the browser', none: 'No sign-in', token: 'Needs a token', command: 'One command', sentence: 'This sentence' },
        token: 'Token', addEnv: 'Add environment variable',
        several: (n) => `${n} connectors`, // NEW: what a pasted file with several servers says it was taken for
        envName: 'Variable name', envValue: 'Value', // NEW: the two boxes of an environment variable
      },
    },
    // NEW (2026-11-05): a collector reads through one connector. The frequency and the line of the last collection were the connector's before.
    collectors: {
      add: 'Add collector', name: 'Name', connector: 'Connector', prompt: 'What to collect', empty: 'No collectors', needConnector: 'Add a connector first',
      frequency: 'How often, such as 30m, 2h, 1d, or cron', common: 'Common frequencies',
      everyMinutes: (n) => `Every ${n} minutes`, everyHours: (n) => (n === 1 ? 'Every hour' : `Every ${n} hours`), everyDays: (n) => (n === 1 ? 'Every day' : `Every ${n} days`),
      preset: {
        '5m': 'Every 5 minutes', '15m': 'Every 15 minutes', '30m': 'Every 30 minutes', '1h': 'Every hour', '6h': 'Every 6 hours',
        '0 9 * * *': 'Every day at 09:00', '0 9 * * 1-5': 'Monday to Friday at 09:00', '0 9-18 * * 1-5': 'Monday to Friday, every hour 9–18',
      },
      last: { done: (when, added) => (added > 0 ? `Last ${when} · ${added} new` : `Last ${when} · nothing new`), failed: (when) => `Last ${when} · failed` },
      addedByDudu: 'Added by Dudu', removeOf: (name) => `Remove ${name}`,
    },
    rules: {
      open: 'Open', empty: 'Empty', missing: 'Not found',
      files: {
        'TRIAGE.md': { title: 'Impact, effort and due dates' },
        'ASSIGN.md': { title: 'Issue assignment' },
      },
    },
    memory: {
      search: 'Search records', count: (n) => n === 1 ? '1 record' : `${n} records`, editOf: (text) => `Edit: ${text}`, forgetOf: (text) => `Forget: ${text}`, empty: 'Nothing is remembered yet', edit: 'Edit', save: 'Save', cancel: 'Cancel', forget: 'Forget', willDelete: 'This will be deleted',
      confirmForget: 'Delete', since: (date) => `Since ${date}`, superseded: 'Superseded', reviews: 'Tidy runs', noReviews: 'No tidy runs yet',
      scope: 'This removes local memory and its references. DSH source messages and model history stay.', // NEW
      summary: (counts) => {
        const updated = (counts.refine ?? 0) + (counts.supersede ?? 0) + (counts.corroborate ?? 0);
        const parts = [];
        if (updated) parts.push(`${updated} ${updated === 1 ? 'entry' : 'entries'} updated`);
        if (counts.new) parts.push(`${counts.new} ${counts.new === 1 ? 'entry' : 'entries'} added`);
        if (counts.skill) parts.push(`${counts.skill} ${counts.skill === 1 ? 'skill' : 'skills'} added`);
        return parts.length ? parts.join(', ') : 'No changes';
      },
      counts: { turns: 'conversation turns', entries: 'entries', logLines: 'lines of the daily notes', skills: 'skills', reviews: 'tidy notes', staged: 'staged notes' },
    },
    widgets: {
      // NEW: widget development controls and checks.
      inspect: 'Inspect widget',
      minimum: 'Minimum size', recommended: 'Recommended size', light: 'Light', dark: 'Dark', theme: 'Theme',
      sample: 'Example data', mine: 'My data', data: 'Data', checks: 'Checks',
      metadata: 'Name, description and preview', fits: 'Content fits', accessible: 'Icon buttons have labels', healthy: 'No errors',
      pass: 'Pass', fail: 'Check',
      idMismatch: 'The widget id does not match its slot registration.',
    },
    skills: { empty: 'No skills yet', delete: 'Delete', back: 'Back to skills', deleteOf: (name) => `Delete: ${name}` },
  },
  sessionState: { idle: 'Idle', processing: 'Working', unread: 'Unread', unassigned: 'Unassigned' }, // NEW: Unread awaits English review; Working reuses the previous label
  // NEW: the Pet frame's English controls and its unavailable states.
  pet: {
    open: 'Open conversation', close: 'Close', conversation: 'Dudu', message: 'Message', send: 'Send',
    hide: 'Hide Dudu',
    earlier: 'Earlier', voice: 'Voice input', release: 'Release to send · Esc to cancel',
    stop: 'Stop', failed: 'Could not load the conversation', voiceFailed: 'Voice input failed',
    // The line while Dudu works: DSH's own (chat.deepDiving, chat.deepDivingFor and its duration units). The owner showed the Chinese and asked for it (2026-11-04); the English is DSH's.
    running: 'Deep diving', runningFor: (duration) => `Deep diving for ${duration} ···`, duration: { hour: 'h ', minute: 'm ', second: 's' },
    // NEW: the "+" menu of the conversation window, the model box, and what Compact answers (docs/issues-ui-wording.md, 2026-11-01 evening).
    file: 'File', compact: 'Compact', compactHint: 'Compact the conversation above',
    model: 'Model', effort: 'Reasoning effort', compacted: 'Compacted', nothingToCompact: 'Nothing to compact yet', compactFailed: 'Could not compact',
    // NEW: the card of the quick buttons when there is no scheduled task (the other two empty cards say the pages' own: No issues, Nothing here). Awaits review, docs/issues-ui-wording.md.
    noTasks: 'No tasks',
    // NEW (2026-11-11): the capsule of a long answer. 展开 is the word of the owner's Lark screenshot, 收起 is its pair; the English is mine. They await the owner's review (docs/issues-ui-wording.md).
    expand: 'Expand', collapse: 'Collapse',
    // NEW (2026-11-10): the menu of a message and the "You:" of a line in the todo rows; the owner approved the Chinese with "你就按这一版实现吧" (docs/issues-ui-wording.md); the English is mine.
    reply: 'Reply', copy: 'Copy', remove: 'Delete', you: 'You: ',
    // NEW: tasks_create/resume/duplicate/delete await review; update/pause match the approved task receipts, run reuses the approved action.
    actions: { tasks_create: 'Task created', tasks_update: 'Task updated', tasks_pause: 'Task paused', tasks_resume: 'Task resumed', tasks_duplicate: 'Task duplicated', tasks_run: 'Run now', tasks_delete: 'Task deleted', issues_add: 'Issue added', issues_update: 'Issue updated', issues_assign: 'Issue assigned', issues_complete: 'Issue completed', issues_cancel: 'Issue canceled', memory_remember: 'Remembered', memory_forget: 'Forgotten', connector_register: 'Connector added', collector_register: 'Collector added', dashboard_add: 'Widget added', dashboard_remove: 'Widget removed', dashboard_reset: 'Layout restored' },
  },
  attachments: { download: 'Download', copyImage: 'Copy image', copyLink: 'Copy link' }, // NEW: issue attachment controls, pending wording review
  issuePin: { on: '置顶', off: '取消置顶' }, // Owner-supplied wording; no unreviewed English translation.
  noAgent: 'No agent',
  today: 'Today',
  // NEW: the hint shown when the mouse rests on a due date (the doc asks for date and days left or overdue).
  dueIn: (days) => (days === 1 ? 'in 1 day' : `in ${days} days`),
  overdue: (days) => (days === 1 ? '1 day overdue' : `${days} days overdue`),
  // NEW: empty and failed states of the list.
  empty: 'No issues',
  loadFailed: 'Could not load issues',
  retry: 'Retry',
  shell: {
    unavailable: 'Connection unavailable.', reading: 'Loading connection settings…', loading: 'Loading…', busy: 'Working…',
    phone: 'Phone control', computerName: 'Computer name', addresses: 'Connection addresses', lan: 'LAN address',
    publicAddress: 'Public address', lanLabel: 'LAN', publicLabel: 'Public', editPublicAddress: 'Edit public address', edit: 'Edit', removeRoute: 'Remove address', // approved remote connection design, 2026-11-04
    lanCode: 'Generate a QR code for the LAN address', generate: 'Generate QR code', address: (n) => `Connection address ${n}`,
    removeAddress: (n) => `Delete connection address ${n}`, remove: 'Delete', addAddress: 'Add address', save: 'Save', saved: 'Saved',
    devices: 'Paired devices', paired: (date) => `Paired on ${date}`, revoke: 'Revoke', noDevices: 'No paired devices',
    scan: 'Open Dudu to scan', close: 'Close', copied: 'Copied', copyPairing: 'Copy pairing link',
    copyFailed: 'Could not copy. Scan the QR code to connect.', expiry: 'QR code expires in 10 minutes', pair: 'Pair phone',
    revokeQuestion: (name) => `Revoke the connection to ${name}?`, cancel: 'Cancel', revokePairing: 'Revoke pairing',
    providers: 'Providers', state: 'Status', enable: 'Enable', executable: 'Executable path', autoFind: 'Leave blank to find automatically',
    detect: 'Check again', providerStates: { ready: 'Ready', missing: 'Not found', unsupported: 'Unsupported version', broken: 'Cannot run' },
    providerChip: (name) => `Provider: ${name}`,
  },
};

const zh = {
  conversationFind: CONVERSATION_FIND,
  needsYouColors: NEEDS_YOU_COLORS,
  tasks: {
    title: '任务', search: '搜索任务', create: '新建任务', manual: '手动创建', inConversation: '在对话中创建',
    all: '全部状态', statuses: { active: '已开启', paused: '已暂停', ended: '已结束' },
    rules: '规则', history: '任务运行记录', name: '自动化任务名称', prompt: '自动化任务内容', provider: '供应商', model: '模型', defaultModel: '默认模型',
    target: '执行位置', workspace: '关联工作区', timing: '运行时间', timezone: '时区', next: '下次运行',
    targets: { reuse: '新建对话并复用', new: '每次新建对话', existing: '已有会话' },
    kinds: { daily: '每天', workdays: '周一至周五', weekly: '每周', monthly: '每月', interval: '间隔', once: '仅一次', cron: 'Cron' },
    pause: '暂停任务', resume: '恢复任务', run: '立即执行', duplicate: '复制任务', delete: '删除任务',
    linked: '关联会话', unsaved: '有未保存的修改', discard: '放弃', save: '保存修改', more: '加载更多', optionsFailed: '没能读取', // NEW（2026-11-18）：供应商、模型、工作区没读到时，窗口标题栏里重试按钮的名字，待主人审核
    delivery: { delivered: '已投递', delivering: '正在投递', failed: '投递失败', uncertain: '待确认' },
    runFailed: '运行失败', // NEW (2026-11-11): 待主人审核
  },
  // 对话头部的定时任务（主人，2026-11-17）。count（“{N} 个定时任务”）、list、confirmDelete（照 DSH 停止任务的“再次点击确认停止”）连同设计稿给主人看过，2026-11-17 主人说“就按你定的来吧”；copy、copied、noOutput 是 DSH 终端块自己的字。其余都是任务窗口里的字（T.tasks）。
  sessionTasks: {
    count: (n) => `${n} 个定时任务`, list: '定时任务',
    copy: '复制', copied: '已复制', noOutput: '（无输出）', confirmDelete: '再次点击确认删除',
  },
  brand: '嘟嘟', issues: '看板',
  tabs: { active: '进行中', backlog: '待规划', all: '全部' },
  status: { backlog: '待规划', todo: '待办', in_progress: '处理中', in_review: '待审核', done: '已完成', canceled: '已取消' },
  priority: { none: '无优先级', urgent: '紧急', high: '高', medium: '中', low: '低' },
  priorityOf: (name) => `优先级：${name}`,
  addFilter: '添加筛选…', filterOptions: '筛选…', filterButton: '筛选',
  fields: { status: '状态', agent: '智能体', sessionState: '会话状态', priority: '优先级', project: '项目', source: '来源', label: '标签' },
  command: { suggestions: '候选项' }, // NEW
  attachments: { download: '下载', copyImage: '复制图片', copyLink: '复制链接' }, // NEW: 事项附件按钮文案待主人审核
  isAnyOf: '是其中之一', is: '是', removeFilter: '移除筛选', clear: '清除', addFilterChip: '筛选', changeStatus: '更改状态…',
  changeStatusOf: (status, title) => `${status}。更改状态：${title}`, noProject: '无项目',
  source: { owner: '你', dudu: '嘟嘟', connector: '收集器', session: '会话' },
  // 截止日期菜单的中英文已由主人确认（2026-11-02）。
  due: { placeholder: '试试：24h、7天、2月9日', remove: '移除截止日期', custom: '自定义…', weekEnd: '本周结束', oneWeek: '一周后' },
  display: {
    title: '显示选项', list: '列表', board: '看板', grouping: '分组', subGrouping: '子分组', ordering: '排序', columns: '列', rows: '行',
    noGrouping: '不分组', groupBy: { status: '状态', agent: '智能体', project: '项目', priority: '优先级' },
    orderBy: { priority: '优先级', status: '状态', due: '截止日期', updated: '更新时间', created: '创建时间' },
    reverse: (what) => `反转${what}`, recency: '已完成事项按最近更新排序', completedIssues: '已完成事项',
    completed: { all: '全部', day: '过去一天', week: '过去一周', month: '过去一个月', none: '不显示' },
    listOptions: '列表选项', showEmptyGroups: '显示空分组', boardOptions: '看板选项', showEmptyColumns: '显示空列',
    properties: '显示属性', property: { id: '编号', status: '状态', agent: '智能体', priority: '优先级', project: '项目', labels: '标签', dueDate: '截止日期', source: '来源', created: '创建时间', updated: '更新时间' }, reset: '重置',
  },
  collapse: (name) => `折叠${name}`, expand: (name) => `展开${name}`,
  detail: {
    menuDetails: '详情', // Owner wording, 2026-11-10.
    duduMention: 'Dudu',
    mention: '提及',
    messageErrors: {
      invalid_message: '先写点内容。', multiple_targets: '一次只 @ 一个。',
      choose_agent: '先选择智能体。', empty_request: '@ 后面还要写要说的话。',
      recipient_unavailable: '只能 @ 当前事项的处理者。',
      choose_project: '先选项目，再把工作交给智能体。',
      delivery_failed: '留言已保存，请求没能送达。',
    }, // NEW
    more: '更多',
    properties: '属性', project: '项目', source: '来源', activity: '活动', leaveComment: '添加评论…', send: '发送',
    untitled: '未命名', description: '添加描述…', loadEarlier: '加载更早的记录', showMore: '展开', showLess: '收起', notFound: '这条事项不存在。', back: '返回看板',
    previous: '上一条事项', next: '下一条事项', position: (index, total) => `${index} / ${total}`, noDueDate: '无截止日期', noProjectSet: '无项目', clearDue: '清除', dueDate: '截止日期',
    setPriority: '设置优先级…', copyId: '复制编号', openSession: '打开会话', openSource: '打开来源', snooze: '稍后提醒', setAgent: '选择智能体…',
    agentNote: '会开启新会话，原会话会关闭。', reply: '回复…', sendReply: '发送回复', result: '记录结果…', saveResult: '保存', skipResult: '跳过',
  },
  snooze: { laterToday: '今天晚些时候', tomorrow: '明天', nextWeek: '下周', clear: '取消稍后提醒', until: (date) => `稍后提醒至 ${date}` },
  activity: {
    you: '你', unknownTime: '—', justNow: '刚刚', minutesAgo: (n) => `${n} 分钟前`, hoursAgo: (n) => `${n} 小时前`, yesterday: '昨天',
    created: '创建了事项', createdFromMessage: '从消息创建了事项', createdFromSession: '从会话创建了事项',
    status: (from, to) => `将状态从${from}改为${to}`, priority: (to) => `将优先级改为${to}`, due: (date) => `将截止日期设为 ${date}`,
    dueRemoved: '移除了截止日期', assigned: (agent) => `交给了 ${agent}`, unassigned: '移除了智能体', asked: '提问', session: '更换了会话', commented: '评论',
    sessionStarted: (agent) => `与 ${agent} 开始了会话`, sessionClosed: '关闭了会话', sessionResumed: '恢复了会话',
    whoShouldTake: '交给谁处理？',
    failed: (reason) => `出错了：${reason}。怎么办？`, noReason: '没有说明原因',
    notStarted: (reason) => `没能开始：${reason}。要换个智能体，还是稍后再试？`,
    notDelivered: (reason) => `回复没能发给会话：${reason}`,
    access: '访问模式', requestedAccess: '请求', allowedAccess: 'ASSIGN.md 允许',
    sessionDropped: '指定的会话不可用，已开启新会话',
    urgentNeedsRule: 'TRIAGE.md 没有紧急规则，优先级按影响和工作量判断。', // NEW
  },
  newIssue: { title: '新建事项', description: '填写标题，可补充描述。', titlePlaceholder: '事项标题', briefPlaceholder: '添加描述…', cancel: '取消', create: '创建事项', failed: '事项没能创建' },
  bulk: { toolbar: '批量操作', selected: (n) => `已选 ${n} 条`, clear: '取消选择', select: (label) => `选择 ${label}`, selectAll: '全选' },
  toast: {
    markedDone: '已标记为完成', status: (name) => `状态已改为${name}`, priority: (name) => `优先级已改为${name}`,
    dueSet: '已设置截止日期', dueRemoved: '已移除截止日期', assigned: (name) => `已交给 ${name}`, unassigned: '已移除智能体',
    updated: (n) => `已更新 ${n} 条事项`, copied: (text) => `已复制 ${text}`, snoozed: '已设为稍后提醒', snoozeCleared: '已取消稍后提醒',
    failed: '更改没能保存', region: '通知',
  },
  dates: { name: '日期', due: '截止日期', created: '创建时间', updated: '更新时间', overdue: '已逾期', today: '今天', next7: '未来 7 天', next30: '未来 30 天', day: '过去一天', week: '过去一周', month: '过去一个月' },
  search: { label: '搜索事项', placeholder: '搜索事项…' }, total: (n) => `${n.toLocaleString('zh-CN')} 条事项`,
  // 信息收集器：设计和这些字主人 2026-11-05 看过（“没问题，就按你的推荐实现吧”）；别的字是事项自己的（筛选、清除、日期、新建事项、打开来源、打开事项、搜索事项…、撤销）。
  collector: {
    select: '选择', // 已批准的原字；主人 2026-11-09 改为右键菜单入口。
    tabs: { todo: '待处理', done: '已处理' },
    empty: '没有信息', loadFailed: '信息没能加载',
    shareSession: '转发', restore: '恢复', // 转发：主人的原话（2026-11-18：“我们不应该叫分享了，我们也改成叫转发吧”；原来是分享到会话）
    markDone: '已处理', remove: '删除', // 主人的原话（2026-11-07）：“收集器增加删除和已处理按钮”
    complete: '补全上下文', // NEW（2026-11-11）：主人的原话“让收集信息对应的会话去继续补全这一条信息的上下文”
    toast: { restored: '已恢复', done: '已处理', deleted: '已删除', sharedSession: (ref) => `已转发到 ${ref}` }, // sharedSession：手机的“已转发到 {0}”；done 用主人的“已处理”，deleted：新写的
    // 详情里说这条信息去了哪个事项的一行：“嘟嘟 建了 [DUD-12]”（嘟嘟不再建事项之前建的），和主人自己做的（“已转发到 [DUD-12]”，后面跟事项的状态图标和编号）
    verdict: { made: '建了', shared: '已转发到', created: '已新建' },
  },
  addTo: (name) => `在${name}中新建事项`, lane: { options: '列选项', collapse: '折叠列', expand: '展开列' },
  dashboard: {
    menu: '嘟嘟菜单', // NEW
    editLayout: '编辑版面', editHint: '拖动移动，拉边调整大小', addWidget: '添加小组件', restoreDefault: '恢复默认', done: '完成', settings: '设置', board: '仪表盘',
    remove: '移除小组件', addTitle: '添加小组件', addDescription: '选择要放到仪表盘上的小组件。', added: '已添加', add: '添加', source: (name) => `来自 ${name}`,
    searchWidgets: '搜索小组件', fullWidth: '全宽', fullHeight: '全高', // NEW translations of the owner's gallery design; await review; 全高 is NEW (2026-11-01)
    noMore: '所有小组件都已添加。', minimum: '最小尺寸', maximum: '最大尺寸', undo: '撤销',
    placed: (name, x, y) => `${name}：第 ${x} 列，第 ${y} 行`, sized: (name, w, h) => `${name}：${w} 列，${h} 行`,
    broken: () => '这个小组件没能显示', brokenFrom: (name) => `来自 ${name}`, missing: (name) => `这个小组件来自 ${name}，该插件尚未安装。`,
    loadFailed: '仪表盘没能加载', retry: '重试', saveFailed: '版面没能保存',
    actionAdded: (name) => `已添加「${name}」`, actionRemoved: (name) => `已移除「${name}」`, actionMoved: (name) => `已移动「${name}」`,
    actionResized: (name, w, h) => w === 'fill' || h === 'fill' ? `已将「${name}」调整为${w === 'fill' ? '全宽' : w} × ${h === 'fill' ? '全高' : h}` : `已将「${name}」调整为 ${w}×${h}`, restored: '已恢复默认', changed: '已更改版面',
  },
  projects: { choose: '选择项目', create: '新建项目', empty: '还没有项目', loading: '正在读取项目…', failed: '项目没能读取' }, // NEW
  // NEW (2026-11-05): 标签和子事项，参照 Linear（主人的截图）。主人审过之前的字都是暂定。
  labels: {
    name: '标签', add: '添加标签', search: '修改或添加标签…', create: (name) => `新建标签：“${name}”`, pickColor: '选择标签颜色',
    colors: { grey: '灰色', darkGrey: '深灰', purple: '紫色', teal: '青色', green: '绿色', yellow: '黄色', orange: '橙色', pink: '粉色', red: '红色' },
    loading: '正在读取标签…', failed: '标签没能读取', createFailed: '标签没能创建', empty: '还没有标签',
  },
  subIssues: {
    add: '添加子事项', addMore: '添加子事项', title: '子事项', placeholder: '子事项标题', parent: '父事项', subIssueOf: '子事项，属于',
    setParent: '设置父事项…', removeParent: '移除父事项', searchParent: '搜索事项…', progress: (done, total) => `${done}/${total}`, noMatch: '没有找到事项',
    createFailed: '子事项没能创建',
  },
  newIssue2: { more: '更多', parent: '父事项' },
  // NEW: 复制菜单（2026-11-05，参照 Linear），待主人审核。
  copy: {
    menu: '复制', title: '复制标题', markdown: '复制事项为 Markdown', everything: '复制全部内容为 Markdown', branch: '复制 Git 分支名', prompt: '复制为提示词', duplicate: '复制一份…',
    done: { title: '标题', markdown: '事项 Markdown', everything: '全部内容 Markdown', branch: 'Git 分支名', prompt: '提示词' },
  },
  // NEW: 事项上的链接（2026-11-05），菜单词参照 Linear，窗口里的词待主人审核。
  // NEW: 描述的富文本（2026-11-05）：「/」菜单和选中文字上方的工具条，待主人审核。
  // NEW: 描述历史（2026-11-05），待主人审核。
  descriptionHistory: { menu: '查看描述历史', title: '描述历史', current: '当前版本', restore: '恢复此版本', close: '关闭', none: '描述还没有改过。', empty: '当时的描述是空的。' },
  // NEW: 保存的视图（2026-11-05），待主人审核。
  views: {
    add: '添加视图', newTitle: '新视图', renameTitle: '重命名视图', name: '视图名称', create: '创建视图', save: '保存', rename: '重命名', delete: '删除视图',
    deleteTitle: (name) => `删除视图“${name}”？`, deleteScope: '将删除这个视图，里面的事项不受影响。',
  },
  richText: {
    menu: '内容块', linkPlaceholder: '粘贴或输入链接…',
    blocks: { heading1: '一级标题', heading2: '二级标题', heading3: '三级标题', bulletList: '无序列表', orderedList: '有序列表', taskList: '待办清单', quote: '引用', codeBlock: '代码块', divider: '分隔线' },
    format: { bold: '加粗', italic: '斜体', strike: '删除线', code: '代码', link: '链接' },
  },
  links: {
    title: '链接', add: '添加链接…', addPullRequest: '添加拉取请求…', addDocument: '添加文档…', url: '网址', titleOptional: '标题（可选）', addButton: '添加',
    dialog: { link: '添加链接', pull_request: '添加拉取请求', document: '添加文档' }, remove: (name) => `移除 ${name}`,
    invalid: '请输入以 http:// 或 https:// 开头的网址。', duplicate: '这条链接已经在事项上了。',
  },
  // NEW: 删除确认，照 Linear 的样子（2026-11-05），待主人审核。Linear 说删除的事项会在“最近删除”里留 30 天；这里删了就没有了，所以这句话说清楚删什么、留什么。
  deleteIssue: {
    title: (name) => `删除“${name}”？`, titleMany: (count) => `删除 ${count} 条事项？`,
    scope: '将删除这条事项、活动和本地关联。来源消息和会话历史会保留。',
    scopeMany: '将删除这些事项、它们的活动和本地关联。来源消息和会话历史会保留。',
  },
  widgets: {
    titles: { issues: '看板', quota: '额度', sessions: '会话', office: '办公室', collector: '收件箱' },
    descriptions: { issues: '所有事项，可按列表或看板查看', office: '已分配智能体的进行中事项，各有一位员工', collector: '收集器收集回来的信息，可转发到会话或新建事项' }, // collector: 新写的
    needs: { issues: '事项', quota: '额度', inputs: '输入', sessions: '会话', network: '网络' },
    quota: { leftLine: (window, percent) => `${window} 剩余 ${percent}%`, empty: '暂无用量', unknown: '—', fiveHour: '5 小时', weekly: '每周', days: (n) => `${n} 天`, used: (label, percent) => `${label} 已用 ${percent}%`,
      resets: (when) => `${when} 重置`, resetsAt: (when) => `${when} 重置`, limitReached: (when) => `已达上限，${when} 重置`, label: (name, percent) => `${name} 已用 ${percent}%`, balance: '余额', updated: (when) => `更新于 ${when}`, until: (date) => `有效期至${date}` },
    sessions: {
      search: '搜索会话', empty: '暂无会话', failed: '会话没能读取',
      // NEW（2026-11-05）：搜索看不到什么，搜了之后在结果下面用灰字说；以及列表不全。待主人审核。
      unsearchable: (count) => `还有 ${count} 个会话没法搜索内容，结果可能不全`,
      indexing: (done, total) => `正在建立搜索索引（${done}/${total}），结果可能不全`,
      listPartial: '部分会话没能读取，列表可能不全',
      history: '会话记录', importLabel: '导入', takeOverLabel: '接管', noMessages: '暂无消息', // NEW; action labels supplied by the owner
      clear: '清空搜索', more: '更多会话', openFailed: '会话没能打开。', takeoverLabel: '交给嘟嘟管理',
      takeoverFailed: '会话没能接管。', openIssue: '打开事项', // NEW
      takeoverSuccess: '接管成功', // Owner wording (2026-11-05).
      agents: { claude: 'Claude', codex: 'ChatGPT', pi: 'Pi', dsh: 'DeepSeek Harness' },
    },
  },
  settings: {
    title: '设置', openFolder: '打开项目文件夹', failed: '这一页没能加载', retry: '重试', unavailable: '项目文件夹没能打开。',
    nav: { general: '常规', statuses: '状态', connectors: '连接器', collectors: '收集器', rules: '规则', memory: '记忆', skills: '技能', phone: '手机控制', providers: '供应商' },
    // 和忘记一条记忆用的同一套字（`memory.willDelete`、`cancel`、`confirmForget`）：删连接器和收集器之前问的那个窗口。
    confirmDelete: { title: '将要删除', cancel: '取消', delete: '删除' },
    // NEW: reviewed together with the English workflow settings above.
    statuses: {
      title: '状态', name: '名称', description: '描述', color: '颜色', create: '创建', add: (category) => `在${category}中添加状态`,
      icon: '状态图标', progress: '完成度', // Owner approved; fractions are accessibility labels only.
      options: '状态选项', reorder: '调整顺序', moveUp: '上移', moveDown: '下移', makeDefault: '设为默认', moveIssues: '将事项移至',
      categories: { backlog: '待规划', unstarted: '未开始', started: '已开始', completed: '已完成', canceled: '已取消' },
      errors: {
        unknown_status: '这个状态已不存在。', invalid_status: '请检查状态名称和颜色。',
        duplicate_status: '已有同名状态。', last_status: '每个分类至少保留一个状态。',
        status_in_use: '请选择现有事项要移入的状态。',
      },
    },
    general: { folder: '项目文件夹', isDefault: '默认', change: '更改', path: '文件夹路径', moveFiles: '把文件移过去', save: '保存', cancel: '取消',
      issues: '事项', exportIssues: '导出事项', export: '导出', exportFailed: '事项没能导出', pet: '宠物', showPet: '显示宠物', doubleSpace: '双击空格打开对话', holdSpace: '长按空格语音输入',
      model: '模型', changeModel: '在 DSH 里更换', lastTidy: '最近一次整理', noTidy: '还没有整理过', deepSleep: '深度睡眠' },
    // NEW (2026-11-05，主人看过图): 连接器只管怎么连上一个服务（Prompt 或 MCP）；收集什么、多久一次是收集器的。
    // 第一版连接器页剩下的字，是重画的页（下面的 connectorsPage）和别的页还在用的。
    connectors: { name: '名称', empty: '没有连接器', remove: '删除',
      kind: { prompt: 'Prompt', mcp: 'MCP' }, needsAuth: '需要授权',
      inUse: (names) => `还有收集器在用它：${names.join('、')}`,
      removeOf: (name) => `删除：${name}` },
    // NEW (2026-11-06)：连接器页照 Claude 和 Muse 重画。字是 docs/issues-ui-wording.md “2026-11-06 连接器页重画”里主人的表；没列在表里的标了 NEW。
    connectorsPage: {
      addCustom: '添加自定义连接器', addLabel: '连接器', search: '搜索', back: '返回',
      views: { available: '可用', connected: '已连接' },
      groups: { here: '这台电脑', work: '办公', projects: '项目', dev: '开发', web: '网页' }, // NEW: 项目、网页（主人 2026-11-06 点头的那份清单里的组名）
      connect: '连接', authorize: '授权', disconnect: '断开',
      address: '地址', tools: '工具', toolsValue: (n) => `${n} 个`,
      about: { tools: (n) => `${n} 个工具`, commandLine: (command) => `命令行 · ${command}`, thisComputer: (command) => `本机 · ${command}` },
      state: {
        waiting: '等待浏览器…', timedOut: '连接超时', needsLogin: '需要登录', missing: '没装',
        login: (command) => `在终端运行 ${command}，再点重试`,
        notFound: (command, install) => (install ? `没找到 ${command}：${install}` : `没找到 ${command}`),
      },
      custom: {
        placeholder: '粘贴地址或命令，或者写一句话说怎么读', checking: '正在查看…',
        kind: { remote: '远程', local: '本地', sentence: '命令行' },
        how: { oauth: '在浏览器里授权', none: '不用登录', token: '需要令牌', command: '一条命令', sentence: '就是这句话' },
        token: '令牌', addEnv: '添加环境变量',
        several: (n) => `${n} 个连接器`, // NEW
        envName: '变量名', envValue: '值', // NEW
      },
    },
    // NEW (2026-11-05): 收集器通过一个连接器去读。频率、笔记和“上次采集”一行原来属于连接器。
    collectors: { add: '添加收集器', name: '名称', connector: '连接器', prompt: '收集什么', empty: '没有收集器', needConnector: '先添加一个连接器',
      frequency: '频率，如 30m、2h、1d，或 cron', common: '常用频率',
      everyMinutes: (n) => `每 ${n} 分钟`, everyHours: (n) => (n === 1 ? '每小时' : `每 ${n} 小时`), everyDays: (n) => (n === 1 ? '每天' : `每 ${n} 天`),
      preset: {
        '5m': '每 5 分钟', '15m': '每 15 分钟', '30m': '每 30 分钟', '1h': '每小时', '6h': '每 6 小时',
        '0 9 * * *': '每天 09:00', '0 9 * * 1-5': '周一至周五 09:00', '0 9-18 * * 1-5': '周一至周五 9 至 18 点每小时',
      },
      last: { done: (when, added) => (added > 0 ? `上次 ${when} · 新增 ${added} 条` : `上次 ${when} · 没有新的`), failed: (when) => `上次 ${when} · 读取失败` },
      addedByDudu: '嘟嘟添加', removeOf: (name) => `删除：${name}` },
    rules: {
      open: '打开', empty: '空', missing: '未找到',
      files: {
        'TRIAGE.md': { title: '影响、工作量和截止' },
        'ASSIGN.md': { title: '任务分配' },
      },
    },
    memory: { search: '搜索记录', count: (n) => `${n} 条`, editOf: (text) => `编辑：${text}`, forgetOf: (text) => `忘记：${text}`, empty: '还没有记住的事', edit: '编辑', save: '保存', cancel: '取消',
      forget: '忘记', willDelete: '将要删除', confirmForget: '删除', since: (date) => `自 ${date}`, superseded: '已替代', reviews: '整理记录', noReviews: '还没有整理记录',
      scope: '会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。',
      summary: (counts) => {
        const updated = (counts.refine ?? 0) + (counts.supersede ?? 0) + (counts.corroborate ?? 0);
        return [updated && `更新 ${updated} 条`, counts.new && `新增 ${counts.new} 条`, counts.skill && `新增 ${counts.skill} 项技能`].filter(Boolean).join('，') || '没有变更';
      },
      counts: { turns: '轮对话', entries: '条记忆', logLines: '行每日记录', skills: '项技能', reviews: '条整理记录', staged: '条待整理记录' } },
    widgets: {
      inspect: '检查小组件', minimum: '最小尺寸', recommended: '推荐尺寸', light: '浅色', dark: '深色', theme: '主题',
      sample: '示例数据', mine: '我的数据', data: '数据', checks: '检查', metadata: '名称、描述和预览', fits: '内容完整显示', accessible: '图标按钮有名称', healthy: '没有错误',
      pass: '通过', fail: '待检查', idMismatch: '小组件编号与插槽注册不一致。' },
    skills: { empty: '还没有技能', delete: '删除', back: '返回技能', deleteOf: (name) => `删除：${name}` },
  },
  sessionState: { idle: '空闲', processing: '工作', unread: '未读', unassigned: '未分配' },
  pet: {
    open: '展开对话', close: '关闭', conversation: '嘟嘟', message: '发消息', send: '发送', earlier: '更早的对话', voice: '语音输入', release: '松开发送 · Esc 取消',
    hide: '隐藏 Dudu',
    stop: '停止', failed: '对话没能加载', voiceFailed: '语音输入失败',
    // 嘟嘟工作时的那一行：和 DSH 自己的一样（chat.deepDiving、chat.deepDivingFor 和时长单位），主人 2026-11-04 给了截图并要求加上
    running: '深度求索中', runningFor: (duration) => `深度求索中，用时 ${duration} ···`, duration: { hour: '小时', minute: '分', second: '秒' },
    file: '文件', compact: '压缩', compactHint: '压缩以上对话内容',
    model: '模型', effort: '推理等级', compacted: '已压缩', nothingToCompact: '还没有可压缩的内容', compactFailed: '压缩没能完成',
    noTasks: '没有任务', // 快捷项的卡片在没有任务时的话，句式照“没有连接器”“没有收集器”；另两张空卡片用看板和信息页现成的“没有事项”“没有信息”。主人 2026-11-10 审过“没有定时任务”，2026-11-11 说“定时任务改成任务”。
    expand: '展开', collapse: '收起', // 新（2026-11-11）：长回复的小药丸；展开是主人飞书截图上的字，收起是它的一对，等主人审
    reply: '回复', copy: '复制', remove: '删除', you: '你：', // 新：消息的菜单（长按、右键）和待办行里“你：”；主人 2026-11-10：“我们有这个回复和删除和复制就行”“你就按这一版实现吧”
    actions: { tasks_create: '已创建任务', tasks_update: '已更新任务', tasks_pause: '已暂停任务', tasks_resume: '已恢复任务', tasks_duplicate: '已复制任务', tasks_run: '立即执行', tasks_delete: '已删除任务', issues_add: '已添加事项', issues_update: '已更新事项', issues_assign: '已分配事项', issues_complete: '已完成事项', issues_cancel: '已取消事项',
      memory_remember: '已记录', memory_forget: '已忘记', connector_register: '已添加连接器', collector_register: '已添加收集器', dashboard_add: '已添加小组件', dashboard_remove: '已移除小组件', dashboard_reset: '已恢复版面' },
  },
  issuePin: { on: '置顶', off: '取消置顶' },
  noAgent: '未分配', today: '今天', dueIn: (n) => `${n} 天后`, overdue: (n) => `逾期 ${n} 天`, empty: '没有事项', loadFailed: '事项没能加载', retry: '重试',
  shell: {
    unavailable: '连接暂时不可用。', reading: '正在读取连接配置…', loading: '正在读取…', busy: '处理中…', phone: '手机控制',
    computerName: '电脑名称', addresses: '连接地址', lan: '内网地址', lanCode: '为内网地址生成二维码', generate: '生成二维码', address: (n) => `连接地址 ${n}`,
    publicAddress: '公网地址', lanLabel: '内网', publicLabel: '公网', editPublicAddress: '编辑公网地址', edit: '编辑', removeRoute: '移除地址', // 2026-11-04 已审核连接设计
    removeAddress: (n) => `删除连接地址 ${n}`, remove: '删除', addAddress: '添加地址', save: '保存', saved: '已保存', devices: '已配对设备',
    paired: (date) => `配对于 ${date}`, revoke: '撤销', noDevices: '暂无配对设备', scan: '打开嘟嘟扫码', close: '关闭', copied: '已复制', copyPairing: '复制配对链接',
    copyFailed: '复制失败，请扫码连接', expiry: '二维码 10 分钟内有效', pair: '配对手机', revokeQuestion: (name) => `撤销 ${name} 的连接？`, cancel: '取消', revokePairing: '撤销配对',
    providers: '供应商', state: '状态', enable: '启用', executable: '可执行文件路径', autoFind: '留空则自动查找', detect: '重新检测',
    providerStates: { ready: '可用', missing: '未找到', unsupported: '版本不受支持', broken: '无法运行' }, providerChip: (name) => `供应商：${name}`,
  },
};

// NEW: known backend diagnostics are translated at presentation; connector output and owner content stay verbatim.
const diagnostics = [
  ['Enter a folder path.', 'Enter a folder path.', '填写文件夹路径。'],
  ['Use a full path.', 'Use a full path.', '填写完整路径。'],
  ['That is a temporary folder the system may clear. Choose another.', 'That is a temporary folder the system may clear. Choose another.', '这是系统可能清理的临时文件夹，请换一个。'],
  ['That path is a file, not a folder.', 'That path is a file, not a folder.', '这个路径指向文件，请选择文件夹。'],
  ['That folder already has other files. Choose an empty one, or one 嘟嘟 made.', 'That folder already has other files. Choose an empty one, or one Dudu made.', '文件夹里已有其他文件，请选择空文件夹或嘟嘟的文件夹。'],
  ["嘟嘟 can't write to that folder.", "Dudu can't write to that folder.", '嘟嘟不能写入这个文件夹。'],
  ["嘟嘟 can't read that folder.", "Dudu can't read that folder.", '嘟嘟不能读取这个文件夹。'],
  ['That path is a link that leads nowhere.', 'That path is a link that leads nowhere.', '这个路径是已失效的链接。'],
  ['The current folder is a link. Move its files yourself.', 'The current folder is a link. Move its files yourself.', '当前文件夹是链接，请手动移动文件。'],
  ['The current folder is not a 嘟嘟 folder, so nothing was moved.', 'The current folder is not a Dudu folder, so nothing was moved.', '当前文件夹不是嘟嘟的文件夹，文件没有移动。'],
  ['The new folder must be empty.', 'The new folder must be empty.', '新文件夹必须是空的。'],
  ["The new folder can't be inside the current one, or the other way round.", "The new folder can't be inside the current one, or the other way round.", '新旧文件夹不能互相包含。'],
  ['That is already the folder in use.', 'That is already the folder in use.', '已经在使用这个文件夹。'],
  ['The files could not be moved. Nothing was deleted.', 'The files could not be moved. Nothing was deleted.', '文件没能移动，没有删除任何文件。'],
  ['Wait until the conversation and memory tidy finish.', 'Wait until the conversation and memory tidy finish.', '请等对话和记忆整理结束。'],
  ['It is not a widget declaration.', 'It is not a widget declaration.', '这不是小组件声明。'],
  ['It has no id.', 'It has no id.', '缺少编号。'],
  ['It has no name.', 'It has no name.', '缺少名称。'],
  ['It has no minimum size.', 'It has no minimum size.', '缺少最小尺寸。'],
  ['Its minimum size must be whole columns and rows, up to 18 rows.', 'Its minimum size must be whole columns and rows, up to 18 rows.', '最小尺寸须为整数列和行，最多 18 行。'],
  ['It has no recommended size.', 'It has no recommended size.', '缺少推荐尺寸。'],
  ['Its recommended size must be whole columns and rows, up to 18 rows.', 'Its recommended size must be whole columns and rows, up to 18 rows.', '推荐尺寸须为整数列和行，最多 18 行。'],
  ['Its recommended size is smaller than its minimum size.', 'Its recommended size is smaller than its minimum size.', '推荐尺寸小于最小尺寸。'],
  ['Its needs must be a list.', 'Its needs must be a list.', '数据来源须为列表。'],
  ['Its description must be text.', 'Its description must be text.', '说明须为文字。'],
  ['Use a plugin name followed by a dot and a widget name.', 'Use a plugin name followed by a dot and a widget name.', '编号须为插件名、小数点和小组件名。'],
  ['This widget needs a different version of 嘟嘟.', 'This widget needs a different version of Dudu.', '这个小组件需要其他版本的嘟嘟。'],
  ['This widget declares an unknown data source.', 'This widget declares an unknown data source.', '小组件声明了未知的数据来源。'],
  ['The development flag must be true or false.', 'The development flag must be true or false.', '开发标记须为 true 或 false。'],
  ['The widget id does not match its slot registration.', 'The widget id does not match its slot registration.', '小组件编号与插槽注册不一致。'],
  // NEW: why a connector prompt typed into the settings page was not saved (docs/issues-ui-wording.md, 2026-11-03); and, from 2026-11-05, a collector.
  ['Give the source a short name.', 'Give the connector a short name.', '请给连接器起一个简短的名称。'],
  ['Give the collector a short name.', 'Give the collector a short name.', '请给收集器起一个简短的名称。'],
  ['A connector is a Prompt or an MCP server.', 'A connector is a Prompt or an MCP server.', '连接器的形式是 Prompt 或 MCP。'],
  ['Give a prompt saying how to reach the service.', 'Write a prompt saying how to reach the service.', '请写下怎么连上这个服务。'],
  ['Choose an MCP server.', 'Choose an MCP server.', '请选一个 MCP 服务。'],
  ['Use the name of an MCP server in DSH.', 'Use the name of an MCP server in DSH.', '请填 DSH 里的 MCP 服务名称。'],
  ['Choose a connector.', 'Choose a connector.', '请选一个连接器。'],
  ['Choose an existing connector.', 'Choose an existing connector.', '这个连接器已不存在，请另选一个。'],
  ['Give a prompt saying what to collect.', 'Write what to collect.', '请写下要收集什么。'],
  ['The prompt is too long.', 'This is too long.', '内容太长了。'],
  ['A line of the prompt cannot start with # or ## (it would be read as a heading).', 'A line of the prompt cannot start with # or ##.', 'Prompt 里的行不能以 # 或 ## 开头。'],
  ['A line of the text cannot start with # or ## (it would be read as a heading).', 'A line cannot start with # or ##.', '这里的行不能以 # 或 ## 开头。'],
  ['Keep credentials in the existing tools, not in source prompts.', 'Keep credentials out of prompts. Use the tool that holds them.', '不要把密钥写进 Prompt，请使用保存密钥的工具。'],
  ['Keep credentials in the existing tools, not in the collector.', 'Keep credentials out of the collector. Use the tool that holds them.', '不要把密钥写进收集器，请使用保存密钥的工具。'],
  ['The connectors changed. Read them again before editing.', 'The connectors changed. Reload and try again.', '连接器刚刚有变动，请重新打开再试。'],
  ['The collectors changed. Read them again before editing.', 'The collectors changed. Reload and try again.', '收集器刚刚有变动，请重新打开再试。'],
  ['There are too many connectors.', 'There are too many connectors.', '连接器太多了。'],
  ['There are too many collectors.', 'There are too many collectors.', '收集器太多了。'],
  ['This connector no longer exists.', 'This connector no longer exists.', '这个连接器已不存在。'],
  ['This collector no longer exists.', 'This collector no longer exists.', '这个收集器已不存在。'],
  ['The connectors could not be read or saved.', 'The connectors could not be read or saved.', '连接器没能读取或保存。'],
  ['The collectors could not be read or saved.', 'The collectors could not be read or saved.', '收集器没能读取或保存。'],
  // NEW (2026-11-05): why a frequency was not saved.
  ['Give how often, such as 30m, 2h or 1d, or a cron expression such as 0 9 * * 1-5.', 'Write how often, such as 30m, 2h, 1d, or a cron expression such as 0 9 * * 1-5.', '请写多久采集一次，如 30m、2h、1d，或 cron 表达式，如 0 9 * * 1-5。'],
  ['The shortest time between collections is 5 minutes.', 'The shortest time between collections is 5 minutes.', '最短每 5 分钟采集一次。'],
];
en.diagnostics = Object.fromEntries(diagnostics.map(([key, value]) => [key, value]));
zh.diagnostics = Object.fromEntries(diagnostics.map(([key, , value]) => [key, value]));

// NEW: these are the connector library's own validation messages, not output from an external program.
const connectorErrors = [
  'fileError', 'unexpected', 'busy', 'unclosedFence', 'noFolder', 'noConnector', 'broken', 'exists', 'notDudu', 'isOn',
  'changedSince', 'badTicks', 'unknownOperation', 'isOff', 'needsReview', 'notRead',
  'notReadable', 'noDsh', 'noDshServer', 'outputCut', 'argObject', 'argUnknown', 'argMissing', 'argType', 'argLong',
  'argControl', 'argDash', 'notFound', 'cannotRun', 'exited', 'killed', 'timedOut', 'toolError', 'cannotConnect', 'signIn',
  'closed', 'unreachable', 'unsupported', 'noSecret', 'noEnv', 'original', 'originalBad', 'vars', 'sse', 'cannotReadConfig', 'tooMany',
];
en.connectorDiagnostics = {
  skipped: CONNECTOR_TEXT.skipped, config: CONNECTOR_TEXT.config, template: CONNECTOR_TEXT.template,
  runtime: Object.fromEntries(connectorErrors.map((key) => [key, CONNECTOR_TEXT.msg[key]])),
};
zh.connectorDiagnostics = {
  skipped: {
    tooBig: '文件太大，无法读取。',
    noMeta: '缺少元数据注释（<!-- id: … -->）。',
    badId: 'id 须为 1 到 24 个小写字母、数字或连字符。',
    badEnabled: 'enabled 须为 true 或 false。',
    noJson: '缺少 json 代码块。',
    manyJson: '有多个 json 代码块。',
    unclosedJson: 'json 代码块没有闭合。',
    badJson: (where) => `json 代码块格式无效${where.replace(/ \(line (\d+), column (\d+)\)/, '（第 $1 行，第 $2 列）').replace(/ \(at position (\d+)\)/, '（位置 $1）')}。`,
    duplicate: (line) => `这个 id 已在第 ${line} 行使用。`,
  },
  config: {
    notObject: 'json 代码块须为对象。',
    badKind: 'kind 须为 cli、mcp 或 dsh。',
    unknownKey: (key) => `未知字段“${key}”。`,
    command: 'command 须为 PATH 中的程序名或绝对路径。',
    runsAnything: (name) => `“${name}”可运行任意指令，允许列表无法限制它。`,
    noAllow: '命令行连接器需要允许的操作列表。',
    allow: (index, why) => `allow[${index}]：${why}`,
    allowShape: '须为文字，或含 run 的对象；可选 name、description 和 readOnly。',
    allowTwice: '已在列表中。',
    allowName: 'name 须为小写字母、数字和下划线，最多 29 个字符。',
    allowNameTwice: 'name 已被其他操作使用。',
    allowDescription: 'description 须为一行文字，最多 300 个字符。',
    allowReadOnly: 'readOnly 须为 true 或 false。',
    allowTooMany: 'allow 最多可有 50 个操作。',
    map: (label) => `${label} 须为对象。`,
    mapName: (label, key) => `${label} 中的名称不符合要求：${key}。`,
    mapValue: (label, key) => `${label}.${key} 须为文字、{ "secret": "<reference>" } 或 { "env": "<NAME>" }，可附带 prefix。`,
    literalSecret: (label, key) => `${label}.${key} 含有明文凭据，请改用 { "secret": "<reference>" }。`,
    transport: 'transport 须为 stdio 或 http。',
    args: 'args 须为文字列表，最多 50 项。',
    argSecret: '含有明文凭据，请通过 env 的 { "secret": "<reference>" } 传入。',
    envBlocked: (name) => `${name} 会改变程序加载代码或连接的方式，嘟嘟不能设置它。`,
    cwd: 'cwd 须为绝对路径。',
    url: 'url 须为 http 或 https 地址。',
    urlHttps: '请使用 https 地址；http 只用于本机。',
    urlCredential: 'url 含有凭据，请在 headers 中使用凭据引用。',
    mixed: 'url 和 headers 用于 http；command、args、env 和 cwd 用于 stdio。',
    from: 'from 须为 { agent, name }，agent 为 claude、claude-desktop 或 codex。',
    fromScope: 'scope 须为 user 或 project；project 需要绝对项目路径。',
    fromExclusive: 'from 与 command、args、env、url、headers 只能选一种。',
    launch: 'launch 须为启用连接器时写入的 16 位指纹。',
    server: 'server 须为 DSH 工具名称中 mcp__ 与 __ 之间的名称。',
    tools: 'tools 须为工具名称列表。',
    timeout: 'timeoutSec 须为 1 到 120 的整数。',
    oneLine: (label) => `${label} 须为一行文字。`,
    notMarkdown: (label) => `${label} 不能以标题、代码块或注释开头。`,
    name: 'name 须为一行文字，最多 100 个字符。',
    id: 'id 须为 1 到 24 个小写字母、数字或连字符。',
    needId: '请填写连接器 id，使用小写字母、数字和连字符。',
    input: '输入须为对象。',
    ownerOnly: (key) => `${key} 由你设置，嘟嘟不能修改。`,
  },
  template: {
    empty: '模板为空。',
    tooLong: '模板超过 500 个字符。',
    tooMany: '模板超过 40 个词。',
    unclosedQuote: '模板中的引号没有闭合。',
    firstWord: '模板的第一个词须为固定文字，不能是 {placeholder}。',
  },
  runtime: {
    fileError: (code) => `CONNECTORS.md 无法读取或写入（${code}）。`,
    unexpected: (what) => `出错了：${what}`,
    busy: 'CONNECTORS.md 一直在变动，请重试。',
    unclosedFence: (line) => `CONNECTORS.md 第 ${line} 行的代码块没有闭合，请先补齐再添加连接器。`,
    noFolder: '项目文件夹不存在。',
    noConnector: (id) => `没有编号为“${id}”的连接器。`,
    broken: (id, line, reason) => `第 ${line} 行的条目“${id}”无法使用：${reason}`,
    exists: (id) => `编号为“${id}”的连接器已存在。`,
    notDudu: (id) => `“${id}”由你添加，嘟嘟不能修改或删除。`,
    isOn: (id) => `“${id}”已开启，请先关闭再修改配置。`,
    changedSince: (id) => `“${id}”已变动，请重新查看后再开启。`,
    badTicks: 'tools 须为工具名称列表；null 表示使用默认值。',
    unknownOperation: (name) => `已开启的连接器中没有操作“${name}”。`,
    isOff: (id) => `连接器“${id}”已关闭，请在连接器页开启。`,
    needsReview: (id) => `“${id}”的原始配置有变动，请查看后重新开启。`,
    notRead: (name) => `“${name}”不是读取操作，不会自动运行。`,
    notReadable: (kind) => `${kind} 连接器只能在对话中使用。`,
    noDsh: '这里无法使用 DSH 工具。',
    noDshServer: (server) => `DSH 没有来自“${server}”的工具。`,
    outputCut: '程序输出超过限制，已停止；这里只显示开头部分。',
    argObject: 'arguments 须为对象。',
    argUnknown: (name) => `${name} 不是这个操作的参数。`,
    argMissing: (name) => `缺少 ${name}。`,
    argType: (name) => `${name} 须为文字或数字。`,
    argLong: (name, max) => `${name} 超过 ${max} 个字符。`,
    argControl: (name) => `${name} 含有控制字符或换行。`,
    argDash: (name) => `${name} 以“-”开头，会被当作选项。`,
    notFound: (command) => `找不到程序“${command}”，请检查是否已安装并在 PATH 中。`,
    cannotRun: (command, code) => `程序“${command}”无法启动（${code}）。`,
    exited: (code) => `程序已结束，退出码为 ${code}。`,
    killed: (signal) => `程序已停止（${signal}）。`,
    timedOut: (seconds) => `${seconds} 秒内没有结果，已停止。`,
    toolError: '工具返回了错误。',
    cannotConnect: (why) => `无法连接：${why}`,
    signIn: '服务器要求登录，请在配置它的工具中登录。',
    closed: '服务器关闭了连接。',
    unreachable: (code) => `无法访问服务器（${code}）。`,
    unsupported: (what) => `这里不支持 ${what}，可使用 stdio 和 streamable HTTP。`,
    noSecret: (ref) => `凭据库中没有“${ref}”。`,
    noEnv: (name) => `未设置环境变量 ${name}。`,
    original: (agent, name) => `${agent} 配置中没有条目“${name}”。`,
    originalBad: (agent) => `无法读取 ${agent} 配置。`,
    vars: (name) => `原始配置使用的 \${${name}} 尚未设置。`,
    sse: '原始配置使用旧的 SSE 传输方式。',
    cannotReadConfig: (agent) => `无法读取 ${agent} 配置。`,
    tooMany: '连接器数量过多。',
  },
};
const connectorDiagnostic = compileDiagnostics(en.connectorDiagnostics);

export const T = localized(en, zh);
export const DICTIONARIES = { en, zh };
export function diagnostic(text, depth = 0) {
  if (Object.hasOwn(en.diagnostics, text)) return T.diagnostics[text];
  if (typeof text !== 'string' || depth >= 8) return text;
  const match = connectorDiagnostic(text);
  if (!match) return text;
  const { path: [group, key], args } = match;
  const message = T.connectorDiagnostics[group][key];
  if (typeof message !== 'function') return message;
  if (group === 'config' && key === 'allow') args[1] = diagnostic(args[1], depth + 1);
  if (group === 'runtime' && key === 'broken') args[2] = diagnostic(args[2], depth + 1);
  return message(...args);
}
