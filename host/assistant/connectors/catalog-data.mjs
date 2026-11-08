// What dudu ships for the connectors page, as data (catalog.mjs reads and checks it). A module and not a .json file because the plugin's packaging follows imports of
// .mjs files only. docs/assistant.md 3.1, 目录.
//
// Fourteen services: the owner's fifteen of 2026-11-06, read from what Claude's connector directory and Codex's plugins ship (the ones both have that dudu can connect with
// one click or with a command line the owner signs in to), less Gmail, which the owner had taken out on 2026-11-08 (it needs a Google Cloud client of their own, as Google
// does not register clients by itself, so it is no click). Slack, Asana, HubSpot, Figma, Box and Microsoft 365 are in their lists too, and are left out because they need
// an app of the owner's own or a token. Each hosted address was asked without signing in on 2026-11-06: a 401 with the sign-in discovery, and an authorization server that
// registers clients by itself (Atlassian's protected-resource file is 404: the SDK falls back to the authorization server at the origin, which does).
export default {
  groups: ['work', 'projects', 'dev', 'web'],
  items: [
    { id: 'lark', name: '飞书', group: 'work', icon: 'lark', line: '消息、日程和文档', how: 'cli',
      command: 'lark-cli', status: ['auth', 'status'], ready: { path: 'identities.user.status', equals: 'ready' }, login: 'lark-cli auth login', install: 'npm install -g @larksuite/cli',
      prompt: '用 lark CLI（命令是 lark-cli，我已经登录好了）读，按 lark-im 技能里的办法来。' },
    // Google Calendar and Google Drive are one command line, `gws` (Google's own Workspace CLI), signed in once; whether `gws auth status` exists is not verified, so the
    // check for these only looks that the command is there.
    { id: 'google-calendar', name: 'Google 日历', group: 'work', icon: 'googlecalendar', line: '日程', how: 'cli',
      command: 'gws', login: 'gws auth login', install: 'npm install -g @googleworkspace/cli',
      prompt: '用 gws 命令行（命令是 gws，我已经登录好了）读 Google 日历，按 gws 技能里的办法来。' },
    { id: 'google-drive', name: 'Google 云端硬盘', group: 'work', icon: 'googledrive', line: '文件、文档和表格', how: 'cli',
      command: 'gws', login: 'gws auth login', install: 'npm install -g @googleworkspace/cli',
      prompt: '用 gws 命令行（命令是 gws，我已经登录好了）读 Google 云端硬盘里的文件、文档和表格，按 gws 技能里的办法来。' },
    { id: 'notion', name: 'Notion', group: 'work', icon: 'notion', line: '页面、数据库和评论', how: 'oauth', url: 'https://mcp.notion.com/mcp' },
    { id: 'airtable', name: 'Airtable', group: 'work', icon: 'airtable', line: '表格和数据库', how: 'oauth', url: 'https://mcp.airtable.com/mcp' },
    { id: 'canva', name: 'Canva', group: 'work', icon: 'canva', line: '设计', how: 'oauth', url: 'https://mcp.canva.com/mcp' },
    { id: 'linear', name: 'Linear', group: 'projects', icon: 'linear', line: '事项和项目', how: 'oauth', url: 'https://mcp.linear.app/mcp' },
    { id: 'atlassian', name: 'Atlassian', group: 'projects', icon: 'atlassian', line: 'Jira 和 Confluence', how: 'oauth', url: 'https://mcp.atlassian.com/v1/mcp' },
    { id: 'github', name: 'GitHub', group: 'dev', icon: 'github', line: '仓库、议题和拉取请求', how: 'cli',
      command: 'gh', status: ['auth', 'status'], login: 'gh auth login', install: 'brew install gh',
      prompt: '用 gh 命令行（命令是 gh，我已经登录好了）读 GitHub 的仓库、议题和拉取请求，只读。' },
    // gitlab.com only; a GitLab of the owner's own is added by its address on the custom page.
    { id: 'gitlab', name: 'GitLab', group: 'dev', icon: 'gitlab', line: '仓库、议题和合并请求', how: 'oauth', url: 'https://gitlab.com/api/v4/mcp' },
    { id: 'sentry', name: 'Sentry', group: 'dev', icon: 'sentry', line: '报错和告警', how: 'oauth', url: 'https://mcp.sentry.dev/mcp' },
    { id: 'supabase', name: 'Supabase', group: 'dev', icon: 'supabase', line: '数据库和项目', how: 'oauth', url: 'https://mcp.supabase.com/mcp' },
    { id: 'vercel', name: 'Vercel', group: 'dev', icon: 'vercel', line: '项目和部署', how: 'oauth', url: 'https://mcp.vercel.com' },
    // The owner's own browser, already signed in, through a skill (X, V2EX, Linux.do: pages that have no connector). Connecting it is the owner's permission to use it.
    { id: 'browser', name: '浏览器', group: 'web', icon: 'browser', line: '用你已经登录好的浏览器打开网页', how: 'browser',
      command: 'ego-browser', install: '',
      prompt: '用 ego-browser 技能，通过我已经登录好的浏览器打开网页，只读，不登录、不发帖、不点赞。' },
  ],
  here: [],
};
