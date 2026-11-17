import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { before, test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { prepareOar } from '../packages/oar-adapter/build.mjs';
import { collectNotices } from '../scripts/licenses.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'packages/oar-adapter');
const ownership = 'dist/shared/executable/ownership.js';
const exec = promisify(execFile);
let reference: Awaited<ReturnType<typeof prepareOar>>;
before(async () => { reference = await prepareOar(); });

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-oar-adapter-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const adapterRoot = join(folder, 'adapter');
  await cp(source, adapterRoot, { recursive: true, filter: path => !['.generated', 'node_modules'].includes(basename(path)) });
  const upstreamRoot = join(folder, 'upstream');
  await cp(reference.upstreamRoot, upstreamRoot, { recursive: true, filter: path => basename(path) !== 'node_modules' });
  const outputRoot = join(folder, 'generated/oar');
  const options = { adapterRoot, upstreamRoot, outputRoot };
  return { ...options, prepare: () => prepareOar(options), receipt: join(folder, 'generated/build.json') };
}

test('the OAR adapter reproduces its runtime, repairs changed output and leaves the official dependency unchanged', async t => {
  const sample = await fixture(t);
  const official = await readFile(join(sample.upstreamRoot, ownership));
  const first = await sample.prepare();
  assert.equal(first.rebuilt, true);
  assert.equal(first.treeSha256, reference.treeSha256);
  assert.equal(first.patches.length, 7);
  const receipt = await readFile(sample.receipt, 'utf8');
  const prepared = await readFile(join(sample.outputRoot, ownership), 'utf8');
  assert.match(prepared, /onExit/);
  assert.notEqual(prepared, official.toString());
  assert.equal((await sample.prepare()).rebuilt, false);
  assert.equal(await readFile(sample.receipt, 'utf8'), receipt, 'the build receipt is deterministic');
  await writeFile(join(sample.outputRoot, ownership), 'changed generated file\n');
  assert.equal((await sample.prepare()).rebuilt, true);
  assert.equal(await readFile(join(sample.outputRoot, ownership), 'utf8'), prepared);
  assert.deepEqual(await readFile(join(sample.upstreamRoot, ownership)), official);
});

test('a wrong OAR version or a changed official file refuses the build and preserves the last good output', async t => {
  const sample = await fixture(t);
  await sample.prepare();
  const receipt = await readFile(sample.receipt);
  const prepared = await readFile(join(sample.outputRoot, ownership));
  const manifestPath = join(sample.upstreamRoot, 'package.json');
  const originalManifest = await readFile(manifestPath);
  await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(originalManifest.toString()), version: '0.92.1' }));
  await assert.rejects(sample.prepare(), /OAR version mismatch/);
  await writeFile(manifestPath, originalManifest);
  // A file we do not patch must also be the exact pinned upstream source.
  await writeFile(join(sample.upstreamRoot, 'dist/observe/index.js'), 'changed official file\n');
  await assert.rejects(sample.prepare(), /OAR upstream source checksum mismatch/);
  assert.deepEqual(await readFile(sample.receipt), receipt);
  assert.deepEqual(await readFile(join(sample.outputRoot, ownership)), prepared);
});

test('changed OAR patches invalidate the cache and fail on a bad base or an undeclared change', async t => {
  const sample = await fixture(t);
  await sample.prepare();
  const receipt = await readFile(sample.receipt);
  const prepared = await readFile(join(sample.outputRoot, ownership));
  const patchPath = join(sample.adapterRoot, 'patches/process-ownership.patch');
  const patch = await readFile(patchPath, 'utf8');
  const broken = patch.replace(' const ownedChildren = new Set();', ' const ownedChildren = "wrong base";');
  assert.notEqual(broken, patch);
  await writeFile(patchPath, broken);
  await assert.rejects(sample.prepare(), /OAR patch failed: patches\/process-ownership.patch/);
  await writeFile(patchPath, patch + '\n--- /dev/null\n+++ b/dist/undeclared.js\n@@ -0,0 +1 @@\n+export const undeclared = true;\n');
  await assert.rejects(sample.prepare(), /OAR patched tree checksum mismatch/);
  assert.deepEqual(await readFile(sample.receipt), receipt);
  assert.deepEqual(await readFile(join(sample.outputRoot, ownership)), prepared);
});

test('the OAR prepare CLI also builds when invoked through a directory alias', async t => {
  const sample = await fixture(t);
  const dependencies = join(sample.adapterRoot, 'node_modules/@botiverse');
  await mkdir(dependencies, { recursive: true });
  await symlink(sample.upstreamRoot, join(dependencies, 'oar'), 'junction');
  const alias = join(sample.adapterRoot, '../adapter-alias');
  await symlink(sample.adapterRoot, alias, 'junction');
  const { stdout } = await exec(process.execPath, [join(alias, 'build.mjs')], { timeout: 30_000 });
  assert.ok(stdout.includes(`Prepared ${reference.upstream} with 7 Dudu patches`), stdout);
  const receipt = JSON.parse(await readFile(join(alias, '.generated/build.json'), 'utf8'));
  assert.equal(receipt.treeSha256, reference.treeSha256);
  assert.equal(await readFile(join(alias, '.generated/oar', ownership), 'utf8'),
    await readFile(join(reference.outputRoot, ownership), 'utf8'));
});

test('the desktop OAR bundle uses the prepared adapter and retains upstream, adapter and exit-hook notices', async () => {
  const { metafile } = await build({
    absWorkingDir: root, entryPoints: ['host/providers/oar-runtimes.mjs'],
    bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false, metafile: true,
    logLevel: 'warning',
  });
  const inputs = Object.keys(metafile!.inputs);
  assert.ok(inputs.some(input => input.includes('packages/oar-adapter/.generated/oar/dist/')));
  assert.ok(inputs.every(input => !input.startsWith('vendor/') && !input.includes('node_modules/@botiverse/oar/dist/')));
  const notices = (await collectNotices(resolve(root), metafile)).join('\n');
  assert.ok(notices.includes(`@botiverse/oar ${reference.upstream.split('@').pop()} (Apache-2.0)`));
  assert.match(notices, /@dudu\/oar-adapter 0\.1\.0\./);
  assert.match(notices, /signal-exit 4\.1\.0 \(ISC\)/);
  assert.match(notices, /Changes cover Claude opening/);
});
