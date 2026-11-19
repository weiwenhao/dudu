import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { agentLogo, AGENT_COLORS } from '../host/dudu-plugin/ui/issues/agent-logos.js';
import { HARNESS_MARKS } from '../host/dudu-plugin/ui/issues/harness-marks.js';
import { AGENT_NAMES } from '../host/dudu-plugin/ui/issues/model.js';
import { hasOwnColors, markPicture } from './sync-agent-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const resources = path.join(root, 'native/android/app/src/main/res');
const scratch = path.join(root, '.local/android-assets');
await mkdir(scratch, { recursive: true });
await mkdir(path.join(resources, 'drawable-nodpi'), { recursive: true });
for (const name of ['Menu', 'Plus', 'Gauge', 'ChevronDown', 'Check', 'X', 'ArrowLeft',
  'ArrowUp', 'Pin', 'PinOff', 'Mail', 'MailOpen', 'Folder', 'UserRound', 'Trash2',
  'Settings', 'Search', 'Paperclip', 'Image', 'Square', 'Ellipsis', 'Copy', 'Download', 'Bell', 'BellOff',
  'File', 'FileDiff', 'Terminal', 'Bot', 'UsersRound', 'Clock', 'Inbox', 'MessageCircle', 'Mic',
  'CornerUpLeft', 'GitFork', 'ListTodo', 'Maximize2', 'CircleHelp', 'ChevronRight',
  'Pencil', 'Archive', 'ArchiveRestore', 'RefreshCw', 'Globe', 'Play', 'Pause',
  'ChevronUp', 'ArrowDown', 'Zap', 'Laptop', 'ExternalLink', 'Calendar', 'ScanLine', 'ScanQrCode', 'PanelsTopLeft',
  'Circle', 'CircleCheck', 'CircleAlert', 'Tag', 'ArrowUpRight', 'SlidersHorizontal', 'Video', 'Film', 'Minimize2', 'Info', 'ShieldCheck',
  'ChartNoAxesColumn', 'CircleDashed', 'CornerDownRight',
  'Star', 'KeyRound', 'Lock', 'Monitor', 'Brain', 'LoaderCircle', 'Settings2', 'ClipboardList', 'FoldVertical', 'CircleStop',
  'ListFilter', 'Activity', 'CalendarDays', 'Box', 'Plug',
  'OctagonPause', 'RotateCcw', 'PencilLine', 'Reply', 'Forward', 'CircleDot', 'SquarePen']) {
  const svg = path.join(scratch, `${name}.svg`);
  await writeFile(svg, renderToStaticMarkup(React.createElement(icons[name], { size: 96, strokeWidth: 2 })));
  execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
    path.join(resources, 'drawable-nodpi', `ic_${name.replace(/[A-Z]/g, (v) => `_${v.toLowerCase()}`).replace(/^_/, '')}.png`), svg]);
}
const connectorLogos = [];
for (const entry of await readdir(path.join(root, 'native/ios/Dudu/Assets.xcassets'))) {
  const key = /^Connector-([\w-]+)\.imageset$/.exec(entry)?.[1];
  if (!key) continue;
  const resource = `connector_${key.replaceAll('-', '_')}`;
  await copyFile(path.join(root, `native/ios/Dudu/Assets.xcassets/${entry}/Connector-${key}.png`),
    path.join(resources, `drawable-nodpi/${resource}.png`));
  connectorLogos.push(`    "${key}" to R.drawable.${resource}`);
}
await writeFile(path.join(root, 'native/android/app/src/main/java/app/dudu/android/ui/ConnectorLogos.kt'),
  '// Generated from the existing iOS connector assets by scripts/sync-android-assets.mjs.\n'
  + 'package app.dudu.android.ui\n\nimport app.dudu.android.R\n\ninternal val connectorLogos = mapOf(\n'
  + connectorLogos.sort().join(',\n') + '\n)\n');
const agentPicture = async (file, svg) => {
  const staging = path.join(scratch, `${file.replaceAll('_', '-')}.svg`);
  await writeFile(staging, svg);
  execFileSync('rsvg-convert', ['-w', '192', '-h', '192', '-o', path.join(resources, 'drawable-nodpi', `${file}.png`), staging]);
};
for (const agent of ['claude', 'codex', 'deepseek', 'pi']) {
  const source = path.join(root, `native/ios/Dudu/Assets.xcassets/Agent-${agent}.imageset/Agent-${agent}.svg`);
  let svg;
  try { svg = await readFile(source, 'utf8'); } catch {
    const logo = agentLogo(agent);
    if (!logo) continue;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="${logo.transform ?? ''}">`
      + (logo.parts ?? [{ d: logo.path, fill: logo.color }]).map(part => `<path d="${part.d}" fill="${part.fill}"/>`).join('')
      + '</g></svg>';
  }
  if (agent !== 'codex') svg = svg.replaceAll(/#000(?:000)?\b|black\b/g, AGENT_COLORS[agent]);
  await agentPicture(`agent_${agent}`, svg);
}
// The harnesses that came with OAR (ui/issues/harness-marks.js). A mark of one colour of ink is a black picture that a dark page tints, as it does the
// ChatGPT knot; a mark with colours of its own is drawn as it is, and has a second picture for a dark page when a part of it is ink (Kimi's K).
const agentDrawing = { codex: { ink: true } };
for (const agent of Object.keys(HARNESS_MARKS)) {
  const logo = agentLogo(agent);
  const own = hasOwnColors(logo);
  await agentPicture(`agent_${agent}`, markPicture(logo, '#030303'));
  if (own && logo.ink) await agentPicture(`agent_${agent}_dark`, markPicture(logo, '#FFFFFF'));
  agentDrawing[agent] = { ink: !own, dark: own && logo.ink };
}
const agentRows = Object.keys(AGENT_NAMES).filter((agent) => agentLogo(agent)).map((agent) => ({ agent, ...agentDrawing[agent] }));
await writeFile(path.join(root, 'native/android/app/src/main/java/app/dudu/android/ui/AgentMarks.kt'),
  '// Generated by scripts/sync-android-assets.mjs from the Desktop\'s list of agents (host/dudu-plugin/ui/issues/model.js) and their marks\n'
  + '// (host/dudu-plugin/ui/issues/agent-logos.js). Do not edit: change those and run the script again.\n'
  + 'package app.dudu.android.ui\n\nimport app.dudu.android.R\n\n'
  + '/**\n * How an agent is named and drawn: its picture, the picture for a dark page when it has one of its own, and whether a dark page tints it\n'
  + ' * (`ink`: a mark of one colour, drawn in the page\'s text colour).\n */\n'
  + 'internal data class AgentMark(val name: String, val light: Int, val dark: Int? = null, val ink: Boolean = false)\n\n'
  + '/** The agents the Desktop names, in the order it offers them. */\n'
  + 'internal val agentMarks = mapOf(\n'
  + agentRows.map(({ agent, ink, dark }) => `    ${JSON.stringify(agent)} to AgentMark(${JSON.stringify(AGENT_NAMES[agent])}, R.drawable.agent_${agent}`
    + `${dark ? `, dark = R.drawable.agent_${agent}_dark` : ''}${ink ? ', ink = true' : ''})`).join(',\n')
  + '\n)\n');
const dudu = path.join(root, 'native/ios/Dudu/Assets.xcassets/DuduLogo.imageset/DuduLogo.png');
await copyFile(dudu, path.join(resources, 'drawable-nodpi/dudu.png'));
for (const name of ['Goal', 'Queue']) {
  execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
    path.join(resources, 'drawable-nodpi', `ic_${name.toLowerCase()}.png`),
    path.join(root, `native/ios/Dudu/Assets.xcassets/${name}.imageset/${name}.svg`)]);
}
// The glyphs of the board list's swipe are the iPhone's own (owner, 2026-11-19: the two phones show the same).
for (const [source, target] of [['Home-SwipeMarkUnread', 'home_swipe_mark_unread'],
  ['Home-SwipeClearUnread', 'home_swipe_clear_unread'], ['Home-SwipeComplete', 'home_swipe_complete'],
  ['Home-SwipePin', 'home_swipe_pin'], ['Home-SwipeUnpin', 'home_swipe_unpin']]) {
  await copyFile(path.join(root, `native/ios/Dudu/Assets.xcassets/${source}.imageset/${source}@3x.png`),
    path.join(resources, `drawable-nodpi/${target}.png`));
}
console.log('Synced the existing Dudu/Agent assets and Lucide icons.');
