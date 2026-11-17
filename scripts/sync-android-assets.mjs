import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { agentLogo, AGENT_COLORS } from '../host/dudu-plugin/ui/issues/agent-logos.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const resources = path.join(root, 'native-android/app/src/main/res');
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
  'ListPlus', 'MessageSquarePlus', 'ChartNoAxesColumn', 'CircleDashed', 'CornerDownRight',
  'Star', 'KeyRound', 'Lock', 'Monitor', 'Brain', 'LoaderCircle', 'Settings2', 'ClipboardList', 'FoldVertical', 'CircleStop',
  'OctagonPause', 'EyeOff', 'RotateCcw', 'PencilLine', 'Reply']) {
  const svg = path.join(scratch, `${name}.svg`);
  await writeFile(svg, renderToStaticMarkup(React.createElement(icons[name], { size: 96, strokeWidth: 2 })));
  execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
    path.join(resources, 'drawable-nodpi', `ic_${name.replace(/[A-Z]/g, (v) => `_${v.toLowerCase()}`).replace(/^_/, '')}.png`), svg]);
}
const connectorLogos = [];
for (const entry of await readdir(path.join(root, 'native/DSBot/Assets.xcassets'))) {
  const key = /^Connector-([\w-]+)\.imageset$/.exec(entry)?.[1];
  if (!key) continue;
  const resource = `connector_${key.replaceAll('-', '_')}`;
  await copyFile(path.join(root, `native/DSBot/Assets.xcassets/${entry}/Connector-${key}.png`),
    path.join(resources, `drawable-nodpi/${resource}.png`));
  connectorLogos.push(`    "${key}" to R.drawable.${resource}`);
}
await writeFile(path.join(root, 'native-android/app/src/main/java/app/dudu/android/ui/ConnectorLogos.kt'),
  '// Generated from the existing iOS connector assets by scripts/sync-android-assets.mjs.\n'
  + 'package app.dudu.android.ui\n\nimport app.dudu.android.R\n\ninternal val connectorLogos = mapOf(\n'
  + connectorLogos.sort().join(',\n') + '\n)\n');
for (const agent of ['claude', 'codex', 'deepseek', 'pi']) {
  const source = path.join(root, `native/DSBot/Assets.xcassets/Agent-${agent}.imageset/Agent-${agent}.svg`);
  let svg;
  try { svg = await readFile(source, 'utf8'); } catch {
    const logo = agentLogo(agent);
    if (!logo) continue;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="${logo.transform ?? ''}">`
      + (logo.parts ?? [{ d: logo.path, fill: logo.color }]).map(part => `<path d="${part.d}" fill="${part.fill}"/>`).join('')
      + '</g></svg>';
  }
  if (agent !== 'codex') svg = svg.replaceAll(/#000(?:000)?\b|black\b/g, AGENT_COLORS[agent]);
  const staging = path.join(scratch, `agent-${agent}.svg`);
  await writeFile(staging, svg);
  execFileSync('rsvg-convert', ['-w', '192', '-h', '192', '-o',
    path.join(resources, 'drawable-nodpi', `agent_${agent}.png`), staging]);
}
const dudu = path.join(root, 'native/DSBot/Assets.xcassets/DuduLogo.imageset/DuduLogo.png');
await copyFile(dudu, path.join(resources, 'drawable-nodpi/dudu.png'));
for (const name of ['Goal', 'Queue']) {
  execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
    path.join(resources, 'drawable-nodpi', `ic_${name.toLowerCase()}.png`),
    path.join(root, `native/DSBot/Assets.xcassets/${name}.imageset/${name}.svg`)]);
}
for (const [source, target] of [['Home-SwipeMarkUnread', 'home_swipe_mark_unread'],
  ['Home-SwipeClearUnread', 'home_swipe_clear_unread']]) {
  await copyFile(path.join(root, `native/DSBot/Assets.xcassets/${source}.imageset/${source}@3x.png`),
    path.join(resources, `drawable-nodpi/${target}.png`));
}
console.log('Synced the existing Dudu/Agent assets and Lucide icons.');
