import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { writeClient, writePhonePages } from './build-client.mjs';
import { collectNotices } from './licenses.mjs';
import { prepareOar } from '../packages/oar-adapter/build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Recheck the official source and every patch before bundling, even after a source edit or --ignore-scripts install.
await prepareOar();
const plugin = join(root, 'host', 'dudu-plugin');
const { version } = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'));
const output = join(root, '.local', 'release');
await mkdir(output, { recursive: true });
const runtime = join(plugin, 'dist');
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime);
const copied = new Set();
// Bundle runtime dependencies that Desktop cannot resolve from the source repository's node_modules.
// The licenses of everything inside the bundles travel with the plugin.
const bundled = new Set(['providers/oar-runtimes.mjs', 'providers/oar-pi.mjs', 'providers/mcp-stdio.mjs', 'providers/stats.mjs', 'assistant/dashboard/engine.mjs', 'assistant/connectors/mcp.mjs', 'assistant/inbox/submission.mjs', 'assistant/sessions/activity-projection.mjs', 'native-markdown-images.mjs', 'assistant/schedule/cron.mjs', 'providers/quota/system-proxy.mjs']);
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
await copyRuntime('providers/mcp-stdio.mjs');
// The interface (React, Radix, Tailwind output) is built into dist/client.js, around the hand-written client.js.
noticeBlocks.push(...(await writeClient(join(runtime, 'client.js'))).notices);
// The settings pages the phone opens in its web view: a script and a stylesheet next to the client, served by host/phone-pages.mjs.
await writePhonePages(join(runtime, 'phone'));
// The marks the interface draws for the agents (ui/issues/agent-logos.js, harness-marks.js): where each comes from, then the Lobe Icons licence. Qwen's licence is in OAR's block below.
noticeBlocks.push(`${await readFile(join(root, 'licenses', 'agent-marks.txt'), 'utf8')}\nLobe Icons - the Claude, OpenAI, DeepSeek, Grok, Kimi, OpenCode, Antigravity, CodeBuddy, Devin and Qoder brand marks\n\n${await readFile(join(root, 'licenses', 'lobe-icons.txt'), 'utf8')}`);
// The bundled OAR runtimes carry their brand marks (data URIs in brands.js); OAR's own notice names each source and licence.
const oarBrands = join(root, 'packages', 'oar-adapter', '.generated', 'oar', 'assets', 'brands');
noticeBlocks.push(`OAR runtime brand marks - the logos inside the bundled @botiverse/oar runtimes\n\n${await readFile(join(oarBrands, 'NOTICE.md'), 'utf8')}\nQwen Code icon licence (Apache-2.0)\n\n${await readFile(join(oarBrands, 'QWEN-LICENSE.txt'), 'utf8')}`);
noticeBlocks.push(`Connector icons - the logos of the connectors page\n\n${await readFile(join(plugin, 'ui', 'connectors', 'icons', 'NOTICE.md'), 'utf8')}`);
for (const [title, file] of [['Cline - the sign-in of hosted MCP servers', 'cline.txt'], ['OpenClaw - the loopback callback of that sign-in', 'openclaw.txt'], ['opencode - the token handling of that sign-in', 'opencode.txt']]) {
  noticeBlocks.push(`${title}\n\n${await readFile(join(root, 'licenses', file), 'utf8')}`);
}
noticeBlocks.push(`Hermes Agent - the paste-anything MCP parser of the connectors page\n\n${await readFile(join(root, 'licenses', 'hermes-agent.txt'), 'utf8')}`);
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
  // Loading in the repository masks missing runtime dependencies such as croner. Check the actual archive outside it.
  const check = join(staging, 'load-check');
  await mkdir(check);
  execFileSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock',
    '--prefer-offline', join(folder, packed[0].filename),
  ], { cwd: check, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync(process.execPath, ['--input-type=module', '--eval',
    'const plugin = await import(process.argv[1]); if (plugin.name !== "dudu" || typeof plugin.apply !== "function") throw new Error("Invalid desktop plugin entry."); const mcp = await import(new URL("./dist/providers/mcp-stdio.mjs", process.argv[1])); if (typeof mcp.connectStdioHostTools !== "function") throw new Error("Invalid session tools entry.");',
    pathToFileURL(join(check, 'node_modules', 'dsh-dudu', 'index.mjs')).href,
  ], { cwd: check, env: { ...process.env, NODE_PATH: '' }, timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  // The guide 嘟嘟 reads to write a widget (WIDGETS.md, in the package root) must be in the package.
  await readFile(join(check, 'node_modules', 'dsh-dudu', 'WIDGETS.md'));
  console.log('Packaged desktop plugin imports successfully outside the source repository.');
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
