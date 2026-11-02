// CI preview: a real browser, the widget and fixed data; no DSH or model.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'dudu-widget-check-'));
let browser;
try {
  const built = await build({
    stdin: { contents: `import { createElement as h } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Widget, declaration } from './widget.mjs';
      import { exampleWidgetProps, widgetCases, inspectWidget } from 'dudu/widget-testing';
      window.cases = widgetCases(declaration);
      window.show = (scenario) => {
        const root = document.getElementById('root');
        const size = { ...scenario.size, width: scenario.size.cols * 83 - 12, height: scenario.size.rows * 83 - 12 };
        root.style.width = size.width + 'px'; root.style.height = size.height + 'px';
        root.className = 'du-widget-preview'; root.dataset.theme = scenario.theme;
        window.widgetRootInstance ??= createRoot(root);
        window.widgetRootInstance.render(h(Widget, { ...exampleWidgetProps(), size }));
      };
      window.check = () => inspectWidget(document.getElementById('root'));`, resolveDir: here },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
    ...(process.env.DUDU_WIDGET_ROOT ? { alias: Object.fromEntries(['widget', 'widget-ui', 'widget-testing'].map((name) => [`dudu/${name}`, join(process.env.DUDU_WIDGET_ROOT, `${name}.mjs`)])) } : {}),
  });
  const widgetRoot = process.env.DUDU_WIDGET_ROOT ?? dirname(fileURLToPath(import.meta.resolve('dudu/package.json')));
  const css = await readFile(join(widgetRoot, 'widget.css'), 'utf8');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent('<style>body{margin:0}*{box-sizing:border-box}</style><div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: built.outputFiles[0].text });
  for (const scenario of await page.evaluate(() => window.cases)) {
    await page.evaluate((value) => window.show(value), scenario);
    await page.getByRole('region', { name: 'Example widget' }).waitFor();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const result = await page.evaluate(() => window.check());
    if (!result.fits) console.log(await page.locator('#root *').evaluateAll((nodes) => nodes.filter((node) =>
      node.clientHeight && (node.scrollHeight > node.clientHeight + 2 || node.scrollWidth > node.clientWidth + 2)).map((node) => ({
      tag: node.tagName, class: node.className, client: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight],
    }))));
    assert.deepEqual(result, { fits: true, accessible: true }, scenario.name);
    console.log(`${scenario.name}: passed`);
  }
} finally {
  await browser?.close();
  await rm(work, { recursive: true, force: true });
}
