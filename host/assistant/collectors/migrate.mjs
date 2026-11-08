// The one-time split of the registry written when a connector and a collector were one thing: an entry of CONNECTORS.md that said where to look,
// what to collect and how often. It becomes two entries with the same words and the same id:
//
//   a collector   in COLLECTORS.md, with the entry's name, its text (now "what to collect") and its frequency;
//                 its id is the entry's, so that the records, the runs, the issues made from them and the session it reads in stay its own
//   a connector   in CONNECTORS.md, with the entry's name and the same id, and no prompt yet: the owner writes how to reach the service
//
// An entry is the old kind when its metadata line has no `kind:`. The old file is kept next to it as CONNECTORS.before-collectors.md. COLLECTORS.md
// is written before CONNECTORS.md, and an entry the collectors already hold is not added again, so a run that stopped halfway is finished by the next.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readText, writeText } from '../connectors/markdown.mjs';
import { parseSources } from '../connectors/sources.mjs';
import { TEMPLATES } from '../templates.mjs';

// The text CONNECTORS.md began with before the split (a file the owner has not touched still starts with it, and then gets the new one).
const LEGACY_HEAD = `# 连接器

连接器是你告诉嘟嘟去哪里、收集什么的 Prompt。每个来源写一个二级标题，下面直接写收集要求。嘟嘟用已有的工具和技能去读，不用另配启动方式或开启开关。

格式示例（缩进的部分不会被读取）：

    ## 飞书
    看飞书里需要我处理的消息，记下来源链接、发消息的人和截止日期。
`;

const connectorSection = (entry, eol) => [`## ${entry.name}`, `<!-- id: ${entry.id} | source: ${entry.source} | kind: prompt -->`, ''].join(eol);
const collectorSection = (entry, eol) => [
  `## ${entry.name}`,
  `<!-- id: ${entry.id} | source: ${entry.source} | connector: ${entry.id}${entry.frequency ? ` | ${/^\d+[mhd]$/.test(entry.frequency) ? 'every' : 'cron'}: ${entry.frequency}` : ''} -->`,
  '', entry.prompt, '',
].join(eol);

/** -> { migrated: how many entries were split }. Throws only when a file cannot be read or written; the caller decides what that means. */
export function splitLegacySources({ folder }) {
  const connectorsFile = join(folder, 'CONNECTORS.md');
  const collectorsFile = join(folder, 'COLLECTORS.md');

  const connectors = readText(connectorsFile);
  if (connectors.tooBig) return { migrated: 0 };
  const parsed = parseSources(connectors.text);
  const legacy = parsed.entries.filter((entry) => !entry.kinded);

  if (legacy.length) {
    const eol = parsed.eol;
    const collectors = readText(collectorsFile);
    if (collectors.tooBig) return { migrated: 0 };
    const held = new Set(parseSources(collectors.text).entries.map((entry) => entry.id));
    const added = legacy.filter((entry) => !held.has(entry.id));
    if (added.length) {
      const base = collectors.exists && collectors.text ? collectors.text : TEMPLATES['COLLECTORS.md'];
      writeText(collectorsFile, `${base}${base.endsWith('\n') ? '' : '\n'}${added.map((entry) => `\n${collectorSection(entry, '\n')}`).join('')}`);
    }

    const backup = join(folder, 'CONNECTORS.before-collectors.md');
    if (!existsSync(backup)) writeText(backup, connectors.text);

    const lines = [...parsed.lines];
    for (const entry of [...legacy].reverse()) lines.splice(entry.start, entry.end - entry.start, connectorSection(entry, eol));
    let text = lines.join(eol);
    if (text.startsWith(LEGACY_HEAD)) text = `${TEMPLATES['CONNECTORS.md']}${text.slice(LEGACY_HEAD.length)}`;
    writeText(connectorsFile, text);
  }

  return { migrated: legacy.length };
}
