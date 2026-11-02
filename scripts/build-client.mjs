// Builds the desktop plugin's interface (host/dudu-plugin/ui/) into host/dudu-plugin/dist/client.js.
//
// client.js stays the hand-written shell DSH loads. The build wraps it: the React interface is compiled to a function
// `__DUDU_UI__(require)` that sits in front of the shell's own text, so the shell can ask for the interface only when it is
// there (the source file still works unbuilt, with the interface missing). The interface's React and react-dom come from DSH's
// own module table, through the `require` DSH gives the shell, not from the bundle: two copies of React cannot share hooks.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import prefixer from 'postcss-prefix-selector';
import { collectNotices } from './licenses.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'host', 'dudu-plugin');
const ui = join(plugin, 'ui');
// What every DSH's loader provides (its seed table in the web client: DSH 0.2.0-rc.2 has exactly these plus its own packages);
// everything else the interface uses is bundled. Newer DSH builds seed more (@tanstack/react-virtual, zod), but a plugin
// must run on the ones that do not.
const SHARED = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'];
const SCOPE = '.dudu';
const DARK_SCOPE = /^body\[data-ds-dark-theme\]/;

// Cascade layers are unwrapped: DSH's own global CSS is unlayered, and an unlayered rule beats any layered one however weak.
const unlayer = () => ({
  postcssPlugin: 'unlayer',
  OnceExit(css) {
    css.walkAtRules('layer', (rule) => { if (rule.nodes) rule.replaceWith(rule.nodes); else rule.remove(); });
  },
});
unlayer.postcss = true;

/** Tailwind's output, with every rule moved under `.dudu`; `:root` and `:host` (theme variables) become `.dudu` itself. */
export async function scopeCss(css) {
  const result = await postcss([unlayer(), prefixer({
    prefix: SCOPE,
    transform(prefix, selector, prefixed) {
      if (selector === ':root' || selector === ':host') return prefix;
      if (selector === '*' || selector === '::before' || selector === '::after' || selector === '::backdrop') return `${prefix} ${selector}`;
      if (DARK_SCOPE.test(selector)) return selector;
      return prefixed;
    },
  })]).process(css, { from: undefined });
  return result.css;
}

export async function compileCss(work) {
  const raw = join(work, 'tailwind.css');
  execFileSync(join(root, 'node_modules', '.bin', 'tailwindcss'), ['-i', join(ui, 'styles.css'), '-o', raw, '--minify'], {
    cwd: root, stdio: ['ignore', 'ignore', 'inherit'],
  });
  return scopeCss(await readFile(raw, 'utf8'));
}

/** Returns the text of the built client.js and the licence notices of what was bundled into it. */
export async function buildClient() {
  const work = await mkdtemp(join(tmpdir(), 'dudu-client-'));
  try {
    const css = await compileCss(work);
    const { outputFiles, metafile } = await build({
      entryPoints: [join(ui, 'entry.jsx')], bundle: true, write: false, metafile: true, format: 'cjs', platform: 'browser', target: 'es2022',
      jsx: 'automatic', minify: true, legalComments: 'none', logLevel: 'warning', outfile: join(work, 'ui.cjs'),
      loader: { '.png': 'dataurl', '.webp': 'dataurl' },
      external: SHARED, define: { 'process.env.NODE_ENV': '"production"', __DUDU_CSS__: JSON.stringify(css) },
    });
    const shell = await readFile(join(plugin, 'client.js'), 'utf8');
    const text = `(function () {
function __DUDU_UI__(require) {
var module = { exports: {} }; var exports = module.exports;
${outputFiles[0].text}
return module.exports;
}
${shell}
})();
`;
    const notices = await collectNotices(root, metafile);
    // the Office's scene is marvis-office's (not an npm package): where it comes from and on what footing travels with the plugin too
    const marvis = join(ui, 'widgets', 'office', 'marvis');
    if (Object.values(metafile.outputs).some((output) => Object.keys(output.inputs).some((input) => input.includes('widgets/office/marvis/')))) {
      notices.push(`marvis-office (https://github.com/winterBI/marvis-office, commit 6b6aba4)\n\n${(await readFile(join(marvis, 'SOURCE.md'), 'utf8')).trim()}\n`);
    }
    return { text, notices, size: { js: outputFiles[0].text.length, css: css.length } };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function writeClient(target = join(plugin, 'dist', 'client.js')) {
  const { text, notices, size } = await buildClient();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
  return { target, notices, size, bytes: text.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { target, size, bytes } = await writeClient();
  console.log(`client.js ${(bytes / 1024).toFixed(0)} KB (interface ${(size.js / 1024).toFixed(0)} KB, css ${(size.css / 1024).toFixed(1)} KB) -> ${target}`);
}
