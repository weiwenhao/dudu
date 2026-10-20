import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const names = {
  menu: 'menu', panel: 'panel-right', new: 'square-pen', plus: 'plus',
  close: 'x', back: 'chevron-left', settings: 'settings',
  down: 'chevron-down', check: 'check', photo: 'camera',
  keyboard: 'keyboard', voice: 'audio-lines', add: 'circle-plus',
  search: 'search', file: 'paperclip', goal: 'target', plan: 'list-todo',
  feedback: 'message-square', compact: 'archive', permission: 'shield-check',
  model: 'bot', export: 'download',
  plugins: 'layers', automation: 'clock', insights: 'notebook-text',
  options: 'ellipsis', folder: 'folder', list: 'list', recent: 'clock',
  computer: 'monitor',
};
const icons = {};
await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
for (const [name, filename] of Object.entries(names)) {
  const source = await readFile(new URL(`../node_modules/lucide-react-native/dist/esm/icons/${filename}.mjs`, import.meta.url), 'utf8');
  const literal = source.match(/const __iconData = (\{[\s\S]*?\n\});/)?.[1];
  if (!literal) throw new Error(`Missing Lucide icon data: ${filename}`);
  // Read the library's data without importing its React Native renderer into Node.
  const { node } = runInNewContext(`(${literal})`, {}, { timeout: 1000 });
  const shapes = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs)
    .filter(([key]) => key !== 'key')
    .map(([key, value]) => `${key}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ')}/>`).join('');
  icons[name] = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
}
await writeFile(new URL('../src/generated/mobile-icons.ts', import.meta.url),
  '// Lucide icons (ISC). Generated from lucide-react-native by scripts/build-icons.mjs.\n'
  + `export const MOBILE_ICONS = ${JSON.stringify(icons)};\n`);
