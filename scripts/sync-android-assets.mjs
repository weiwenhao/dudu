import { mkdir, readFile, writeFile, copyFile, readdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucideIcons from 'lucide-react';
import { agentLogo, AGENT_COLORS } from '../host/dudu-plugin/ui/issues/agent-logos.js';
import { HARNESS_MARKS } from '../host/dudu-plugin/ui/issues/harness-marks.js';
import { AGENT_NAMES } from '../host/dudu-plugin/ui/issues/model.js';
import { hasOwnColors, markPicture } from './sync-agent-assets.mjs';
import { syncNativeFileIcons } from './sync-native-file-icons.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Include Lucide's exported aliases too (the canonical `icons` dictionary omits them).
const iconComponents = { ...lucideIcons };
const resources = path.join(root, 'native/android/app/src/main/res');
const scratch = path.join(root, '.local/android-assets');
await mkdir(scratch, { recursive: true });
await mkdir(path.join(resources, 'drawable-nodpi'), { recursive: true });
// The iPhone's semantic glyphs are the source of Android's matching symbols too.
const iosGlyphSource = await readFile(path.join(root, 'native/ios/Dudu/Views/DuduIcon.swift'), 'utf8');
const glyphs = [...iosGlyphSource.matchAll(/case \.(\w+): return \.(\w+)/g)]
  .map(([, name, lucide]) => ({ name, icon: lucide[0].toUpperCase() + lucide.slice(1) }));
const assetGlyphs = new Map([...iosGlyphSource.matchAll(/case \.(\w+): return "(\w+)"/g)]
  .map(([, name, asset]) => [name, asset]));
const resourceName = (name) => `ic_${name.replace(/[A-Z]/g, (v) => `_${v.toLowerCase()}`).replace(/^_/, '')}`;
const menuGlyphs = {
  runDelivered: 'CircleCheck', runFailed: 'CircleAlert', runDelivering: 'Clock', runUnknown: 'CircleQuestionMark',
  goalPause: 'CirclePause', goalResume: 'CirclePlay', goalEdit: 'SquarePen',
  photoDownload: 'ArrowDownToLine', photoSaved: 'Check',
  // The connector card's points (2026-11-23): where it signs in or runs.
  connectorSignIn: 'LogIn', connectorLocal: 'SquareTerminal',
  // The pairing form uses the same clipboard outline on both phones.
  pasteLink: 'Clipboard',
};
// 'Pin' and 'PanelsTopLeft' are drawn by name in the drawer (`R.drawable.ic_pin`, `ic_panels_top_left`), not through a glyph: without them here this script deleted them (2026-11-21).
const iconNames = new Set(['Bell', 'BellOff', 'Star', 'ArrowDown', 'KeyRound', 'GitFork', 'Pin', 'PanelsTopLeft',
  ...Object.values(menuGlyphs),
  ...glyphs.filter(({ name }) => !assetGlyphs.has(name)).map(({ icon }) => icon)]);
const iconFiles = new Set([...iconNames].map((name) => `${resourceName(name)}.png`));
// This script owns ic_*.png. Remove obsolete choices so regeneration cannot keep both old and new sets.
for (const file of await readdir(path.join(resources, 'drawable-nodpi'))) {
  if (/^ic_[\w]+\.png$/.test(file) && !iconFiles.has(file)) await unlink(path.join(resources, 'drawable-nodpi', file));
}
for (const name of iconNames) {
  const svg = path.join(scratch, `${name}.svg`);
  await writeFile(svg, renderToStaticMarkup(React.createElement(iconComponents[name], {
    size: 96, strokeWidth: ['ArrowUpToLine', 'ArrowDownFromLine'].includes(name) ? 1.8 : 2,
  })));
  execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
    path.join(resources, 'drawable-nodpi', `${resourceName(name)}.png`), svg]);
}
for (const [name, asset] of assetGlyphs) {
  execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
    path.join(resources, 'drawable-nodpi', `dudu_glyph_${name.toLowerCase()}.png`),
    path.join(root, `native/ios/Dudu/Assets.xcassets/${asset}.imageset/${asset}.svg`)]);
}
// NewIssueSheet normalises the three menu marks to 16pt of ink. Its corner arrow
// has a 21 1/3pt box with a fixed 2pt line, instead of scaling the line down.
const menuOpenSvg = path.join(scratch, 'menu-open.svg');
await writeFile(menuOpenSvg, renderToStaticMarkup(React.createElement(lucideIcons.CornerDownRight,
  { size: 96, strokeWidth: 2 * 18 / 16 })));
execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
  path.join(resources, 'drawable-nodpi/menu_ink_open.png'), menuOpenSvg]);
// The conversation pin is the iPhone's own traced shape, not Lucide's upright pin.
const pinSource = await readFile(path.join(root, 'native/ios/Dudu/Views/DuduPinGlyph.swift'), 'utf8');
const pinPath = (name) => {
  const body = new RegExp(`static let ${name} = \\[([\\s\\S]*?)\\n    \\]`).exec(pinSource)?.[1];
  if (!body) throw new Error(`Missing iPhone pin ${name}`);
  return [...body.matchAll(/CGPoint\(x: ([\d.]+), y: ([\d.]+)\)/g)]
    .map(([, x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z';
};
const pinFile = path.join(scratch, 'dudu-pin.svg');
await writeFile(pinFile, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="${pinPath('outline')}" fill="none" stroke="black" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/><path d="${pinPath('needle')}" fill="black"/></svg>`);
execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
  path.join(resources, 'drawable-nodpi/dudu_pin.png'), pinFile]);
await writeFile(path.join(root, 'native/android/app/src/main/java/app/dudu/android/ui/DuduGlyphs.kt'),
  '// Generated from the iPhone DuduGlyph mapping by scripts/sync-android-assets.mjs.\n'
  + 'package app.dudu.android.ui\n\nimport app.dudu.android.R\n\ninternal object DuduGlyphs {\n'
  + glyphs.map(({ name, icon }) => `    val ${name} = R.drawable.${assetGlyphs.has(name) ? `dudu_glyph_${name.toLowerCase()}` : resourceName(icon)}`).join('\n')
  + '\n}\n');
await writeFile(path.join(root, 'native/android/app/src/main/java/app/dudu/android/ui/MenuGlyphs.kt'),
  '// Generated by scripts/sync-android-assets.mjs from the shared native menu choices.\n'
  + 'package app.dudu.android.ui\n\nimport app.dudu.android.R\n\ninternal object MenuGlyphs {\n'
  + Object.entries(menuGlyphs).map(([name, icon]) => `    val ${name} = R.drawable.${resourceName(icon)}`).join('\n')
  + '\n}\n');
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
    if (agent === 'pi') {
      // PiMark on iPhone fills 80% of its box, centred on the same 800-unit source.
      const scale = 19.2 / 469.43;
      const origin = 2.4 - 165.29 * scale;
      logo.transform = `translate(${origin} ${origin}) scale(${scale})`;
    }
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
  // A mark that is a picture of its own (`picture`: Antigravity's "A" from its app icon) is the desktop's file, 192 px like the others.
  if (logo.picture) await copyFile(path.join(root, `host/dudu-plugin/ui/issues/logos/${logo.picture}.png`), path.join(resources, 'drawable-nodpi', `agent_${agent}.png`));
  else await agentPicture(`agent_${agent}`, markPicture(logo, '#17181B'));
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
for (const name of ['ChangedFiles']) {
  execFileSync('rsvg-convert', ['-w', '96', '-h', '96', '-o',
    path.join(resources, 'drawable-nodpi', 'changed_files.png'),
    path.join(root, `native/ios/Dudu/Assets.xcassets/${name}.imageset/${name}.svg`)]);
}
// The glyphs of the board list's swipe are the iPhone's own (owner, 2026-11-19: the two phones show the same).
for (const [source, target] of [['Home-SwipeMarkUnread', 'home_swipe_mark_unread'],
  ['Home-SwipeClearUnread', 'home_swipe_clear_unread'], ['Home-SwipeComplete', 'home_swipe_complete'],
  ['Home-SwipePin', 'home_swipe_pin'], ['Home-SwipeUnpin', 'home_swipe_unpin']]) {
  await copyFile(path.join(root, `native/ios/Dudu/Assets.xcassets/${source}.imageset/${source}@3x.png`),
    path.join(resources, `drawable-nodpi/${target}.png`));
}
// The pinned shelf's 展开 / 收起 triangle: the iPhone's own 40pt canvas (`Home-PinsExpand`, `Home-PinsCollapse`), drawn as a template and tinted like a glyph.
for (const [source, target] of [['Home-PinsExpand', 'home_pins_expand'], ['Home-PinsCollapse', 'home_pins_collapse']]) {
  execFileSync('rsvg-convert', ['-w', '120', '-h', '120', '-o', path.join(resources, `drawable-nodpi/${target}.png`),
    path.join(root, `native/ios/Dudu/Assets.xcassets/${source}.imageset/${source}.svg`)]);
}
await syncNativeFileIcons();
console.log('Synced the iPhone glyphs and shared DSH file marks.');
