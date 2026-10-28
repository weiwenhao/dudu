import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'host', 'dudu-plugin');
const { version } = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'));
const output = join(root, '.local', 'release');
await mkdir(output, { recursive: true });
const runtime = join(plugin, 'dist');
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime);
const copied = new Set();
async function copyRuntime(file) {
  if (copied.has(file)) return;
  copied.add(file);
  const source = join(root, 'host', file);
  const body = await readFile(source, 'utf8');
  const target = join(runtime, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  for (const match of body.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"](\.\/[^'"]+\.mjs)['"]/g)) {
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
