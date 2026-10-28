import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
async function bundleRuntime(file) {
  const target = join(runtime, file);
  await mkdir(dirname(target), { recursive: true });
  const { metafile } = await build({
    entryPoints: [join(root, 'host', file)], outfile: target, bundle: true, platform: 'node', format: 'esm', target: 'node24',
    metafile: true, logLevel: 'warning', legalComments: 'none',
    // The bundled CommonJS dependencies require Node's own modules, which an ES module has no `require` for.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  });
  const notices = [];
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const match = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (match) packages.set(match[2], match[1]);
  }
  for (const [name, folder] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const manifest = JSON.parse(await readFile(join(root, folder, 'package.json'), 'utf8'));
    let license = '';
    for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE']) {
      try { license = await readFile(join(root, folder, candidate), 'utf8'); break; } catch { /* next */ }
    }
    notices.push(`${name} ${manifest.version} (${manifest.license ?? 'license not declared'})\n\n${license.trim() || 'No license file was published with this package.'}\n`);
  }
  await writeFile(join(runtime, 'THIRD_PARTY_NOTICES.txt'), `This plugin bundles the following packages.\n\n${notices.join('\n----------------------------------------\n\n')}`);
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
