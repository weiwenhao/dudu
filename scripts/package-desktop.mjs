import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { writeClient } from './build-client.mjs';
import { collectNotices } from './licenses.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'host', 'dudu-plugin');
const { version } = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'));
const output = join(root, '.local', 'release');
await mkdir(output, { recursive: true });
const runtime = join(plugin, 'dist');
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime);
const copied = new Set();
// The installed plugin has no node_modules of its own to resolve OAR from, so the one file that imports it is bundled,
// with only the two runtimes the plugin uses. The licenses of what ends up inside travel with it.
const bundled = new Set(['providers/oar-runtimes.mjs']);
const noticeBlocks = [];
async function bundleRuntime(file) {
  const target = join(runtime, file);
  await mkdir(dirname(target), { recursive: true });
  const { metafile } = await build({
    entryPoints: [join(root, 'host', file)], outfile: target, bundle: true, platform: 'node', format: 'esm', target: 'node24',
    metafile: true, logLevel: 'warning', legalComments: 'none',
    // The bundled CommonJS dependencies require Node's own modules, which an ES module has no `require` for.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  });
  noticeBlocks.push(...await collectNotices(root, metafile));
}
async function copyRuntime(file) {
  if (copied.has(file)) return;
  copied.add(file);
  if (bundled.has(file)) { await bundleRuntime(file); return; }
  const source = join(root, 'host', file);
  const body = await readFile(source, 'utf8');
  const target = join(runtime, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  for (const match of body.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)) {
    const dependency = resolve(dirname(source), match[1]);
    const hostRoot = join(root, 'host') + '/';
    if (!dependency.startsWith(hostRoot)) throw new Error('Plugin runtime import escapes host source.');
    await copyRuntime(dependency.slice(hostRoot.length));
  }
}
const entrypoint = await readFile(join(plugin, 'index.mjs'), 'utf8');
const roots = [...entrypoint.matchAll(/from\s*['"]\.\/dist\/([^'"]+\.mjs)['"]/g)].map((match) => match[1]);
if (!roots.length) throw new Error('The desktop plugin has no runtime entrypoints.');
for (const file of roots) await copyRuntime(file);
// The interface (React, Radix, Tailwind output) is built into dist/client.js, around the hand-written client.js.
noticeBlocks.push(...(await writeClient(join(runtime, 'client.js'))).notices);
if (noticeBlocks.length) {
  await writeFile(join(runtime, 'THIRD_PARTY_NOTICES.txt'), `This plugin bundles the following packages.\n\n${[...new Set(noticeBlocks)].join('\n----------------------------------------\n\n')}`);
}
if ([...copied].some((file) => /(?:^|\/)(?:relay\.mjs|mobile-adapter)/.test(file))) {
  throw new Error('The native desktop package must not include the old web relay.');
}
const staging = await mkdtemp(join(tmpdir(), 'dudu-desktop-'));
try {
  const folder = join(staging, 'dudu-desktop');
  await mkdir(folder);
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', folder], {
    cwd: plugin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  }));
  if (packed.length !== 1) throw new Error('Expected one desktop plugin package.');
  await copyFile(join(root, 'desktop', 'README.md'), join(folder, 'README.md'));
  const archive = join(output, `dudu-desktop-${version}.zip`);
  // zip appends to an existing archive; create each artifact from an empty file.
  await rm(archive, { force: true });
  execFileSync('zip', ['-q', '-r', archive, 'dudu-desktop'], { cwd: staging });
  await copyFile(join(folder, packed[0].filename), join(output, packed[0].filename));
  console.log(archive);
} finally {
  await rm(staging, { recursive: true, force: true });
}
