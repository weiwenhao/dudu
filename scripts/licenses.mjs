// Licence notices for the npm packages esbuild bundled into a file, found from its metafile. A bundled copy is a
// redistribution, so the notices travel with the plugin (THIRD_PARTY_NOTICES.txt).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'];

export async function collectNotices(root, metafile) {
  const packages = new Map();
  // Only what ended up in an output counts: a package esbuild read and then tree-shook away (radix-ui's index re-exports every
  // component) is not redistributed.
  const used = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, detail] of Object.entries(output.inputs)) if (detail.bytesInOutput > 0) used.add(input);
  }
  for (const input of used) {
    const match = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (match) packages.set(match[2], match[1]);
  }
  const notices = [];
  for (const [name, folder] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const manifest = JSON.parse(await readFile(join(root, folder, 'package.json'), 'utf8'));
    let license = '';
    for (const candidate of LICENSE_FILES) {
      try { license = await readFile(join(root, folder, candidate), 'utf8'); break; } catch { /* next */ }
    }
    notices.push(`${name} ${manifest.version} (${manifest.license ?? 'license not declared'})\n\n${license.trim() || 'No license file was published with this package.'}\n`);
  }
  return notices;
}
