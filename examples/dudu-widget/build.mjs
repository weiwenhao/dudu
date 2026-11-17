import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// DSH starts a package's interface only when its script registers under the package's own name, so the id is read from package.json.
const { name: packageName } = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

export async function buildWidget({ outdir = join(here, 'dist'), duduRoot, development = false, entryPoint = join(here, 'client.mjs') } = {}) {
  await mkdir(outdir, { recursive: true });
  return build({
    entryPoints: [entryPoint], outfile: join(outdir, 'client.js'), bundle: true,
    format: 'iife', platform: 'browser', target: 'es2022', minify: true,
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    alias: duduRoot ? Object.fromEntries(['widget', 'widget-ui', 'widget-testing'].map((name) => [`dsh-dudu/${name}`, join(duduRoot, `${name}.mjs`)])) : {},
    define: { __WIDGET_DEV__: JSON.stringify(development) },
    // DSH's loader supplies React. Everything else, including defineWidget, is bundled.
    banner: { js: '(function () { let widgetFactory; const moduleLoader = globalThis.window.__ModuleLoader__; const window = { __ModuleLoader__: { load(value) { widgetFactory = value; } } }; function compile(require) {' },
    footer: { js: `} moduleLoader.load({ id: ${JSON.stringify(packageName)}, factory(require) { compile(require); return widgetFactory.factory(require); } }); })();` },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildWidget({ development: process.argv.includes('--development') });
