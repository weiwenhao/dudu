import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentLogo } from '../host/dudu-plugin/ui/issues/agent-logos.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Native and desktop use the same approved vectors, including ChatGPT's optical sizing. */
export async function syncAgentAssets() {
  for (const agent of ['claude', 'codex', 'deepseek']) {
    const mark = agentLogo(agent);
    const name = `Agent-${agent}`;
    const folder = join(root, 'native', 'DSBot', 'Assets.xcassets', `${name}.imageset`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${name}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${mark.path}" fill="#000000"${mark.transform ? ` transform="${mark.transform}"` : ''}/></svg>\n`);
    await writeFile(join(folder, 'Contents.json'), JSON.stringify({
      images: [{ filename: `${name}.svg`, idiom: 'universal' }],
      info: { author: 'xcode', version: 1 },
      properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
    }, null, 2) + '\n');
  }
  await copyFile(join(root, 'licenses', 'lobe-icons.txt'), join(root, 'native', 'DSBot', 'Resources', 'AgentLogoNotices.txt'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await syncAgentAssets();
