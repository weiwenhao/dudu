// Prints the read log of this computer (`~/.dsh/dudu/diagnostics/reads.jsonl`, host/read-log.mjs) as a timeline: when a conversation got an answer, and when, from which screen and how it became
// read (or was marked unread). `npm run logs:reads -- [--last 40] [--session <id>] [--json]`. Titles come from the issues database, read-only.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const folder = process.env.DUDU_HOME ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dudu');
const file = join(folder, 'diagnostics', 'reads.jsonl');
const lines = [file + '.1', file].filter(existsSync).flatMap((path) => readFileSync(path, 'utf8').split('\n')).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
if (!lines.length) { console.log(`No reads logged yet (${file}).`); process.exit(0); }

const titles = new Map();
try {
  const db = new DatabaseSync(join(folder, 'assistant', 'issues.db'), { readOnly: true });
  for (const row of db.prepare("SELECT id, title, session FROM issues WHERE session LIKE 'dsh:%'").all()) titles.set(row.session.slice(4), `#${row.id} ${row.title}`);
  db.close();
} catch { /* titles are a nicety */ }

const SCREEN = { desktop: '电脑', iphone: 'iPhone', android: '安卓', dudu: '嘟嘟的工具', plugin: '插件' };
const HOW = { press: '点击', wheel: '滚动', key: '按键', touch: '触摸', opened: '点开会话', visible: '看着会话末尾', row: '行上的操作', tool: '工具', rebind: '换会话时迁移', unknown: '未说明' };
const EVENT = { read: '已读', 'unread-mark': '标未读', content: '新内容' };
const seconds = (ms) => (ms === undefined ? '' : ms < 1000 ? `${ms}毫秒` : `${(ms / 1000).toFixed(1)}秒`);
const wanted = option('--session');
const chosen = lines.filter((line) => !wanted || line.session === wanted || line.session.includes(wanted)).slice(-Number(option('--last', 40)));
if (args.includes('--json')) { console.log(chosen.map((line) => JSON.stringify(line)).join('\n')); process.exit(0); }

for (const line of chosen) {
  const time = new Date(line.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
  const name = titles.get(line.session) ?? line.session.slice(0, 18);
  if (line.event === 'content') {
    console.log(`${time}  ${EVENT.content}  ${name}  ${line.kind ?? ''} seq ${line.seq}  → ${line.nowUnread ? '未读（亮红点）' : '已经读过了（流出来时有屏幕看着），不亮红点'}`);
    continue;
  }
  const where = `${SCREEN[line.screen] ?? line.screen}${line.device ? ` ${line.device}` : ''}${line.panes ? `（${line.panes} 个会话在屏幕上，第 ${line.pane + 1} 个${line.embedded ? '，内嵌预览' : ''}）` : ''}`;
  const how = `${HOW[line.how] ?? line.how}${line.sinceTouchMs !== undefined ? `，${seconds(line.sinceTouchMs)}前` : ''}`;
  const change = `${line.wasUnread ? '未读' : '本来已读'}→${line.nowUnread ? '仍未读' : '已读'}`;
  const wait = line.unreadForMs !== undefined ? `，内容在屏幕上等了 ${seconds(line.unreadForMs)}` : line.ageMs !== undefined ? `，内容出来 ${seconds(line.ageMs)} 后` : '';
  console.log(`${time}  ${EVENT[line.event]}  ${name}  ${where}  ${how}  ${change}${wait}${line.stream ? '  （读的是流出来的那段）' : ''}  seq ${line.seq ?? ''}${line.previousSeq !== undefined ? ` ← ${line.previousSeq}` : ''}`);
}
