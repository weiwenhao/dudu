import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const treeHash = (files) => sha256([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([name, hash]) => `${name}\0${hash}\n`).join(''));

// npm verifies the archive's SRI in package-lock.json. Also verify the installed
// source tree: a changed file or a different version must never be patched by luck.
// Source maps are not maintained or shipped by this adapter.
async function inventory(root, prefix = '', files = new Map()) {
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = posix.join(prefix, entry.name);
    if (entry.name === 'node_modules' || entry.name.endsWith('.map')) continue;
    if (entry.isDirectory()) await inventory(root, name, files);
    else if (entry.isFile()) files.set(name, sha256(await readFile(join(root, name))));
    else throw new Error(`OAR source contains an unsupported entry: ${name}`);
  }
  return files;
}

async function checkedHash(root, name, expected, phase) {
  let actual = null;
  try { actual = sha256(await readFile(join(root, name))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (actual !== expected) throw new Error(`OAR ${phase} checksum mismatch: ${name}`);
}

function applyPatch(folder, patch, label, check = false) {
  try {
    // --no-index makes paths relative to the staging directory, including when
    // the adapter is built inside the application's git working tree.
    execFileSync('git', ['apply', '--no-index', '--whitespace=nowarn', ...(check ? ['--check'] : []), patch], {
      cwd: folder, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`OAR patch failed: ${label}\n${error.stderr?.toString().trim() || error.message}`, { cause: error });
  }
}

/** Build-only API; overrides allow isolated tests without touching the installed dependency or current artifact. */
export async function prepareOar({
  adapterRoot = packageRoot,
  upstreamRoot,
  outputRoot = join(adapterRoot, '.generated', 'oar'),
} = {}) {
  const spec = JSON.parse(await readFile(join(adapterRoot, 'upstream.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(adapterRoot, 'package.json'), 'utf8'));
  if (manifest.dependencies?.[spec.upstream.name] !== spec.upstream.version) {
    throw new Error('OAR dependency must exactly match the version in upstream.json.');
  }
  if (!upstreamRoot) {
    const entry = fileURLToPath(import.meta.resolve('@botiverse/oar/runtimes/claude'));
    upstreamRoot = resolve(dirname(entry), '../../..');
  }
  const upstream = JSON.parse(await readFile(join(upstreamRoot, 'package.json'), 'utf8'));
  if (upstream.name !== spec.upstream.name || upstream.version !== spec.upstream.version) {
    throw new Error(`OAR version mismatch: expected ${spec.upstream.name}@${spec.upstream.version}, found ${upstream.name}@${upstream.version}.`);
  }
  const original = await inventory(upstreamRoot);
  if (treeHash(original) !== spec.upstream.treeSha256) throw new Error('OAR upstream source checksum mismatch; reinstall the pinned official dependency.');

  const expected = new Map(original);
  const patches = [];
  for (const patch of spec.patches) {
    if (!/^patches\/[a-z0-9-]+\.patch$/.test(patch.file)) throw new Error(`Invalid OAR patch path: ${patch.file}`);
    for (const [name, hashes] of Object.entries(patch.files)) {
      if (!name.startsWith('dist/') || name !== posix.normalize(name) || name.includes('\\')) throw new Error(`Invalid OAR source path: ${name}`);
      if ((expected.get(name) ?? null) !== hashes.before) throw new Error(`OAR patch base checksum mismatch: ${patch.file}: ${name}`);
      expected.set(name, hashes.after);
    }
    patches.push({ ...patch, content: await readFile(join(adapterRoot, patch.file)) });
  }
  const notice = await readFile(join(adapterRoot, 'NOTICE'));
  expected.set('NOTICE', sha256(notice));
  const expectedTree = treeHash(expected);
  const inputs = sha256(JSON.stringify(spec) + patches.map((patch) => patch.content.toString()).join('') + notice.toString());
  const receipt = { upstream: `${upstream.name}@${upstream.version}`, inputs, treeSha256: expectedTree, patches: patches.map((patch) => patch.file) };
  const receiptPath = join(dirname(outputRoot), 'build.json');
  let rebuilt = true;
  try {
    const cached = JSON.parse(await readFile(receiptPath, 'utf8'));
    rebuilt = cached.inputs !== inputs || treeHash(await inventory(outputRoot)) !== expectedTree;
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (rebuilt) {
    await mkdir(dirname(outputRoot), { recursive: true });
    const staging = await mkdtemp(join(dirname(outputRoot), '.oar-prepare-'));
    const previous = `${outputRoot}.previous-${randomUUID()}`;
    let displaced = false;
    try {
      for (const name of original.keys()) {
        await mkdir(dirname(join(staging, name)), { recursive: true });
        await writeFile(join(staging, name), await readFile(join(upstreamRoot, name)));
      }
      for (const patch of patches) {
        for (const [name, hashes] of Object.entries(patch.files)) await checkedHash(staging, name, hashes.before, 'patch input');
        // Read the captured bytes, so edits to a patch during this build cannot
        // change what was validated or produce an artifact for different inputs.
        const patchFile = join(dirname(outputRoot), `.oar-patch-${randomUUID()}`);
        try {
          await writeFile(patchFile, patch.content);
          applyPatch(staging, patchFile, patch.file, true);
          applyPatch(staging, patchFile, patch.file);
        } finally { await rm(patchFile, { force: true }); }
        for (const [name, hashes] of Object.entries(patch.files)) await checkedHash(staging, name, hashes.after, 'patch output');
      }
      await writeFile(join(staging, 'NOTICE'), notice);
      if (treeHash(await inventory(staging)) !== expectedTree) throw new Error('OAR patched tree checksum mismatch; a patch changed files outside its manifest.');
      // A failed validation leaves the previous good artifact intact.
      try { await rename(outputRoot, previous); displaced = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await rename(staging, outputRoot); }
      catch (error) { if (displaced) await rename(previous, outputRoot); throw error; }
      await rm(previous, { recursive: true, force: true });
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  const temporary = `${receiptPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n');
    await rename(temporary, receiptPath);
  } finally { await rm(temporary, { force: true }); }
  return { ...receipt, upstreamRoot, outputRoot, rebuilt };
}

// Node canonicalizes import.meta.url, while argv can retain a symlink or macOS's
// /var alias for /private/var. Compare real paths so the CLI cannot silently skip.
const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => null) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await prepareOar();
  console.log(`Prepared ${result.upstream} with ${result.patches.length} Dudu patches (${result.rebuilt ? 'rebuilt' : 'verified'}).`);
}
