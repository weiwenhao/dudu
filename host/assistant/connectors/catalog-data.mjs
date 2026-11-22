// What dudu ships for the connectors page, as data (catalog.mjs reads and checks it). A module and not a .json file because the plugin's packaging follows imports of
// .mjs files only. docs/assistant.md 3.1, 目录.
//
// Fourteen services: the owner's fifteen of 2026-11-06, read from what Claude's connector directory and Codex's plugins ship (the ones both have that dudu can connect with
// one click or with a command line the owner signs in to), less Gmail, which the owner had taken out on 2026-11-08 (it needs a Google Cloud client of their own, as Google
// does not register clients by itself, so it is no click). GitHub is the hosted server too, signed in by a device code (device.mjs) with an OAuth App of dudu's own: its
// `clientId` is empty until that app is registered (github.com/settings/developers, "Enable Device Flow"), and an item without one is not offered. Its address is the
// read-only one of GitHub's server (/mcp/readonly: the tools that write are not there), so that "read only" is GitHub's and not a sentence. The `gh` command line was taken
// out on 2026-11-09 (owner: a command line like that is a custom connector; it used the owner's own login of the whole computer, with write rights, behind a button that
// said connected). Slack, Asana, HubSpot, Figma, Box and Microsoft 365 are in their lists too, and are left out because they need
// an app of the owner's own or a token. Each hosted address was asked without signing in on 2026-11-06: a 401 with the sign-in discovery, and an authorization server that
// registers clients by itself (Atlassian's protected-resource file is 404: the SDK falls back to the authorization server at the origin, which does).
export default {
  groups: ['work', 'projects', 'dev', 'web'],
  items: [
    { id: 'lark', name: '飞书', group: 'work', icon: 'lark', line: '消息、日程和文档', how: 'cli',
      command: 'lark-cli', status: ['auth', 'status'], ready: { path: 'identities.user.status', equals: 'ready' }, login: 'lark-cli auth login', install: 'npm install -g @larksuite/cli',
      prompt: '用 lark CLI（命令是 lark-cli，我已经登录好了）读，按 lark-im 技能里的办法来。找 @ 我的消息用 `im +messages-search --is-at-me`，老话题下面的新回复只有它能找到。' },
    // Google Calendar and Google Drive are one command line, `gws` (Google's own Workspace CLI), signed in once. `gws auth status` prints JSON whose `auth_method` is "oauth2" when
    // credentials are stored and "none" when they are not (read from its source, crates/google-workspace-cli/src/auth_commands.rs `handle_status`, 2026-11-11), and it exits 0 either way.
    { id: 'google-calendar', name: 'Google 日历', group: 'work', icon: 'googlecalendar', line: '日程', how: 'cli',
      command: 'gws', status: ['auth', 'status'], ready: { path: 'auth_method', equals: 'oauth2' }, login: 'gws auth login', install: 'npm install -g @googleworkspace/cli',
      prompt: '用 gws 命令行（命令是 gws，我已经登录好了）读 Google 日历，按 gws 技能里的办法来。' },
    { id: 'google-drive', name: 'Google 云端硬盘', group: 'work', icon: 'googledrive', line: '文件、文档和表格', how: 'cli',
      command: 'gws', status: ['auth', 'status'], ready: { path: 'auth_method', equals: 'oauth2' }, login: 'gws auth login', install: 'npm install -g @googleworkspace/cli',
      prompt: '用 gws 命令行（命令是 gws，我已经登录好了）读 Google 云端硬盘里的文件、文档和表格，按 gws 技能里的办法来。' },
    { id: 'notion', name: 'Notion', group: 'work', icon: 'notion', line: '页面、数据库和评论', how: 'oauth', url: 'https://mcp.notion.com/mcp' },
    { id: 'airtable', name: 'Airtable', group: 'work', icon: 'airtable', line: '表格和数据库', how: 'oauth', url: 'https://mcp.airtable.com/mcp' },
    { id: 'canva', name: 'Canva', group: 'work', icon: 'canva', line: '设计', how: 'oauth', url: 'https://mcp.canva.com/mcp' },
    { id: 'linear', name: 'Linear', group: 'projects', icon: 'linear', line: '事项和项目', how: 'oauth', url: 'https://mcp.linear.app/mcp' },
    { id: 'atlassian', name: 'Atlassian', group: 'projects', icon: 'atlassian', line: 'Jira 和 Confluence', how: 'oauth', url: 'https://mcp.atlassian.com/v1/mcp' },
    { id: 'github', name: 'GitHub', group: 'dev', icon: 'github', line: '仓库、议题和拉取请求', how: 'device', url: 'https://api.githubcopilot.com/mcp/readonly',
      clientId: '', scope: 'repo read:org read:user', deviceUrl: 'https://github.com/login/device/code', tokenUrl: 'https://github.com/login/oauth/access_token' },
    // gitlab.com only; a GitLab of the owner's own is added by its address on the custom page.
    { id: 'gitlab', name: 'GitLab', group: 'dev', icon: 'gitlab', line: '仓库、议题和合并请求', how: 'oauth', url: 'https://gitlab.com/api/v4/mcp' },
    { id: 'sentry', name: 'Sentry', group: 'dev', icon: 'sentry', line: '报错和告警', how: 'oauth', url: 'https://mcp.sentry.dev/mcp' },
    { id: 'supabase', name: 'Supabase', group: 'dev', icon: 'supabase', line: '数据库和项目', how: 'oauth', url: 'https://mcp.supabase.com/mcp' },
    { id: 'vercel', name: 'Vercel', group: 'dev', icon: 'vercel', line: '项目和部署', how: 'oauth', url: 'https://mcp.vercel.com' },
    // ego lite (https://lite.ego.app/), the browser made for agents: what the owner imported into it is signed in (X, V2EX, Linux.do: pages that have no connector). It is named for what it
    // is, not "a browser": another browser tool is a custom connector with a sentence of its own. First called "ego" (owner, 2026-11-11: "浏览器连接器这个直接改成叫 ego 连接器"), then the
    // full product name (owner, 2026-11-21: "浏览器不叫 ego，叫 ego lite"), moved from its own "web" group into "dev" and given its own mark (icons/ego.svg, ego lite's official black
    // mark, the same one its macOS app icon uses) in place of a plain globe, the same day. The app registers the `ego-browser` command when the first run is done, so that is what is
    // checked (it must run); where to get the app is what the row says when it is not there. Connecting it is the owner's permission to use it.
    { id: 'ego', name: 'ego lite', group: 'dev', icon: 'ego', line: '浏览器操控', how: 'cli',
      command: 'ego-browser', status: ['--version'], install: 'https://lite.ego.app/',
      prompt: '用 ego-browser 技能，通过我已经登录好的浏览器打开网页。' },
  ],
  here: [],
};
