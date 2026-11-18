import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const folder = dirname(fileURLToPath(import.meta.url));

/** Bundle the pinned upstream engine without loading a second copy of host services. */
export async function prepareComputerUse() {
  const upstream = JSON.parse(await readFile(join(folder, 'upstream.json'), 'utf8'));
  for (const [file, expected] of Object.entries(upstream.files)) {
    const actual = createHash('sha256').update(await readFile(join(folder, file))).digest('hex');
    if (actual !== expected) throw new Error(`Computer Use upstream source changed: ${file}`);
  }
  const result = await build({
    entryPoints: [join(folder, 'entry.mjs')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', target: 'node24', metafile: true,
    legalComments: 'none', logLevel: 'warning',
  });
  const imports = [...new Set(Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.filter((item) => item.external).map((item) => item.path)))].sort();
  if (imports.some((name) => !name.startsWith('@deepseek-ai/'))) throw new Error('Unexpected Computer Use runtime dependency.');
  // Statically compiled CommonJS inside a factory, not eval or a custom module
  // loader. Dependencies come from DSH's loader, retaining its service identity.
  const source = `// Generated from @deepseek-ai/dsh-tool-executor-ptc@${upstream.version}; see upstream.json and README.md.
export const imports = ${JSON.stringify(imports)};
export function createEngine(dependencies) {
  const module = { exports: {} };
  const exports = module.exports;
  const require = (name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error('Missing DSH dependency: ' + name);
    return dependencies[name];
  };
${result.outputFiles[0].text}
  return module.exports;
}
`;
  const output = join(folder, '.generated', 'engine.mjs');
  await mkdir(dirname(output), { recursive: true });
  let previous;
  try { previous = await readFile(output, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== source) {
    const temp = `${output}.${process.pid}.tmp`;
    await writeFile(temp, source);
    await rename(temp, output);
  }
  return { output, upstream, imports };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await prepareComputerUse();
