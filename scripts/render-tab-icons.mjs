// The selected look of the inbox, tasks and settings tabs (owner, 2026-11-21: of `.local/designs/tab-selected-2026-11-21/` he took E, 反色, and kept the board's coloured dial as it is).
// It is the unselected outline drawing inverted, not another drawing: the closed shape (the tray, the clock face, the cog) filled black with its outline merged into the fill (line 2, as the
// unselected glyph), and the lines that were inside it (the tray's notch, the clock's hands, the cog's inner circle) white and a little heavier (2.4) so that they still read at 25pt.
//
//   iPhone  `Home-{Inbox,Tasks,Settings}Selected.imageset`: two colours (black #17181B and white), original rendering, 24pt at @2x and @3x like `Image(lucide:)`. The app is light only.
//   Android `drawable-nodpi/home_{inbox,tasks,settings}_selected.png`: one colour, the lines cut out of the shape (transparent), tinted `onSurface` like the other glyphs, so that the lines show
//           the bar behind them in light and dark.
//
// `node scripts/render-tab-icons.mjs` (needs `rsvg-convert` and `lucide-react`). The geometry is Lucide's, as `DuduGlyph.inbox / schedule / settings` draw it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#17181B';
const strip = (name) => renderToStaticMarkup(React.createElement(lucide[name], { width: 24, height: 24 }))
  .replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replaceAll('></circle>', '/>').replaceAll('></path>', '/>').replaceAll('></polyline>', '/>');
const firstPath = (name) => strip(name).match(/<path d="([^"]+)"/)[1];

const TABS = [
  { ios: 'Home-InboxSelected', android: 'home_inbox_selected', body: `<path d="${firstPath('Inbox')}"/>`, detail: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>' },
  { ios: 'Home-TasksSelected', android: 'home_tasks_selected', body: '<circle cx="12" cy="12" r="10"/>', detail: '<path d="M12 6v6l4 2"/>' },
  { ios: 'Home-SettingsSelected', android: 'home_settings_selected', body: `<path d="${firstPath('Settings')}"/>`, detail: '<circle cx="12" cy="12" r="3"/>' },
];
const round = 'stroke-linecap="round" stroke-linejoin="round"';

const twoColours = (tab) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
  + `<g fill="${INK}" stroke="${INK}" stroke-width="2" ${round}>${tab.body}</g>`
  + `<g fill="none" stroke="#FFFFFF" stroke-width="2.4" ${round}>${tab.detail}</g></svg>`;
const cutOut = (tab) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
  + `<defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>`
  + `<g fill="none" stroke="#000" stroke-width="2.4" ${round}>${tab.detail}</g></mask></defs>`
  + `<g mask="url(#cut)" fill="#000" stroke="#000" stroke-width="2" ${round}>${tab.body}</g></svg>`;

const scratch = join(root, '.local/tab-icons');
mkdirSync(scratch, { recursive: true });
const png = (svg, name, pixels, out) => {
  const file = join(scratch, `${name}.svg`);
  writeFileSync(file, svg);
  execFileSync('rsvg-convert', ['--width', String(pixels), '--height', String(pixels), '--output', out, file]);
};

for (const tab of TABS) {
  // iPhone
  const set = join(root, 'native/ios/Dudu/Assets.xcassets', `${tab.ios}.imageset`);
  mkdirSync(set, { recursive: true });
  png(twoColours(tab), `${tab.ios}-2x`, 48, join(set, `${tab.ios}@2x.png`));
  png(twoColours(tab), `${tab.ios}-3x`, 72, join(set, `${tab.ios}@3x.png`));
  writeFileSync(join(set, 'Contents.json'), `${JSON.stringify({
    images: [{ idiom: 'universal', filename: `${tab.ios}@2x.png`, scale: '2x' }, { idiom: 'universal', filename: `${tab.ios}@3x.png`, scale: '3x' }],
    info: { author: 'xcode', version: 1 }, properties: { 'template-rendering-intent': 'original' },
  }, null, 2)}\n`);
  // Android (the vector it replaces is gone: one name, one file)
  png(cutOut(tab), `${tab.android}`, 192, join(root, 'native/android/app/src/main/res/drawable-nodpi', `${tab.android}.png`));
  const old = join(root, 'native/android/app/src/main/res/drawable', `${tab.android}.xml`);
  if (existsSync(old)) rmSync(old);
}
console.log('Rendered the selected tab icons (iPhone and Android).');
