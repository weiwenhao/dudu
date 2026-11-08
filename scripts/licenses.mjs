// Licence notices for the npm packages esbuild bundled into a file, found from its metafile. A bundled copy is a
// redistribution, so the notices travel with the plugin (THIRD_PARTY_NOTICES.txt).
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'];

export async function collectNotices(root, metafile) {
  root = resolve(root);
  const packages = new Map();
  const owners = new Map();
  async function packageOf(folder) {
    if (folder === root || folder === dirname(folder)) return null;
    if (owners.has(folder)) return owners.get(folder);
    let owner;
    try {
      const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
      if (manifest.name) owner = { folder, manifest };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    owner ??= await packageOf(dirname(folder));
    owners.set(folder, owner);
    return owner;
  }
  // Only what ended up in an output counts: a package esbuild read and then tree-shook away (radix-ui's index re-exports every
  // component) is not redistributed.
  const used = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, detail] of Object.entries(output.inputs)) if (detail.bytesInOutput > 0) used.add(input);
  }
  for (const input of used) {
    // A local adapter and its generated upstream copy are packages too. Resolve
    // ownership by the nearest manifest instead of relying on node_modules or
    // a hard-coded vendor path; retain separate copies of different versions.
    const owner = await packageOf(dirname(resolve(root, input)));
    if (owner) packages.set(owner.folder, owner);
  }
  const notices = [];
  for (const { folder, manifest } of [...packages.values()].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name) || a.manifest.version.localeCompare(b.manifest.version))) {
    let license = '';
    for (const candidate of LICENSE_FILES) {
      try { license = await readFile(join(folder, candidate), 'utf8'); break; } catch { /* next */ }
    }
    notices.push(`${manifest.name} ${manifest.version} (${manifest.license ?? 'license not declared'})\n\n${license.trim() || 'No license file was published with this package.'}\n`);
    try { notices.push((await readFile(join(folder, 'NOTICE'), 'utf8')).trim() + '\n'); } catch { /* optional upstream notice */ }
  }
  return notices;
}
