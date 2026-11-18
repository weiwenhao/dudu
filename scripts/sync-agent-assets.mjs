import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentLogo } from '../host/dudu-plugin/ui/issues/agent-logos.js';
import { HARNESS_MARKS } from '../host/dudu-plugin/ui/issues/harness-marks.js';
import { AGENT_NAMES } from '../host/dudu-plugin/ui/issues/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The ink of the phone (DSBotStyle.ink): what a mark's `currentColor` part is drawn in there, on its one light appearance. */
const PHONE_INK = '#17181B';

/** Whether the mark has colours of its own (several parts, or one colour that is not ink): such a mark is a picture, not a shape the app tints. */
export const hasOwnColors = (mark) => Boolean(mark.parts) || !mark.ink;

/** A mark as a picture in its own colours on the 24-unit box; `ink` is the colour of its `currentColor` parts. */
export function markPicture(mark, ink) {
  const parts = mark.parts ?? [{ d: mark.path, fill: mark.ink ? ink : mark.color }];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g${mark.transform ? ` transform="${mark.transform}"` : ''}>`
    + parts.map((part) => `<path d="${part.d}" fill="${part.fill === 'currentColor' ? ink : part.fill}"/>`).join('')
    + '</g></svg>\n';
}

/**
 * Native and desktop use the same approved vectors, including ChatGPT's optical sizing. A mark of one colour is a template the app tints (Claude, ChatGPT, DeepSeek
 * and the ink marks of harness-marks.js); a mark with colours of its own (Kimi, Antigravity, Devin) is a picture. Pi is drawn by the app itself (`PiMark`).
 * The agents' names and their order come from the Desktop's list too (`AGENT_NAMES`), so the phone has no list of its own to keep.
 */
export async function syncAgentAssets() {
  const pictured = [];
  for (const agent of ['claude', 'codex', 'deepseek', ...Object.keys(HARNESS_MARKS)]) {
    const mark = agentLogo(agent);
    const picture = Object.hasOwn(HARNESS_MARKS, agent) && hasOwnColors(mark);
    if (picture) pictured.push(agent);
    const name = `Agent-${agent}`;
    const folder = join(root, 'native', 'DSBot', 'Assets.xcassets', `${name}.imageset`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${name}.svg`), picture ? markPicture(mark, PHONE_INK)
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${mark.path}" fill="#000000"${mark.transform ? ` transform="${mark.transform}"` : ''}/></svg>\n`);
    await writeFile(join(folder, 'Contents.json'), JSON.stringify({
      images: [{ filename: `${name}.svg`, idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
      properties: { 'preserves-vector-representation': true, 'template-rendering-intent': picture ? 'original' : 'template' },
    }, null, 2) + '\n');
  }
  await writeFile(join(root, 'native', 'DSBot', 'Core', 'AgentNames.swift'),
    '// Written by scripts/sync-agent-assets.mjs from AGENT_NAMES in host/dudu-plugin/ui/issues/model.js. Do not edit: change that list and build again.\n\n'
    + 'extension SessionAgent {\n'
    + '    /// The agents the Desktop names, in the order it offers them (the last is DSH\'s own).\n'
    + '    static let listed: [(id: String, name: String)] = [\n'
    + Object.entries(AGENT_NAMES).map(([id, name]) => `        (${JSON.stringify(id)}, ${JSON.stringify(name)}),\n`).join('')
    + '    ]\n\n'
    + '    /// The agents whose mark is a picture in its own colours; every other mark in the asset catalog is a template of one colour that the app tints.\n'
    + `    static let pictured: Set<String> = [${pictured.map((id) => JSON.stringify(id)).join(', ')}]\n}\n`);
  const notices = await Promise.all(['agent-marks.txt', 'lobe-icons.txt', 'qwen-code.txt'].map((file) => readFile(join(root, 'licenses', file), 'utf8')));
  await writeFile(join(root, 'native', 'DSBot', 'Resources', 'AgentLogoNotices.txt'), notices.map((text) => text.trim()).join('\n\n----------------------------------------\n\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await syncAgentAssets();
