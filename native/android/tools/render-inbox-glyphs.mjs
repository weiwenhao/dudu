// The inbox's eight actions for Android, as bitmaps whose line is made up for the box each is drawn at (`app/.../ui/InboxGlyph.kt`; owner, 2026-11-21, of
// `.local/designs/inbox-menu-icons-2026-11-21/`). A glyph of visual size v (the side of the square with the area of its ink box in Lucide's 24 box, measured by that folder's `measure.mjs`) is drawn
// at the box slot * 17 / v, so a line of 2 * v / 17 in the 24 grid is 2 * slot / 24 on the screen for every one of them, as the iPhone's absolute 2pt line is. 96px like the other glyphs.
// The names are the iPhone's `DuduGlyph` mapping (`selectRows` is the checkbox the owner picked); change `SET` and `InboxGlyph.kt` together.
//
//   node native/android/tools/render-inbox-glyphs.mjs      (needs `rsvg-convert`, `lucide-react`, `react`)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';

const target = join(dirname(fileURLToPath(import.meta.url)), '../app/src/main/res/drawable-nodpi');
const SET = [['select_rows', 'SquareCheckBig', 20.5], ['forward', 'Forward', 15.3], ['plus', 'Plus', 16], ['complete_context', 'RefreshCw', 20],
  ['check', 'Check', 15.3], ['restore', 'RotateCcw', 20], ['trash', 'Trash', 21], ['open_link', 'ExternalLink', 20],
  // The message menu of 嘟嘟's group chat (回复, 复制, 删除), one set as on the iPhone (`inkIn24`: reply 15.3, copy 22).
  ['reply', 'Reply', 15.3], ['copy', 'Copy', 22]];
const scratch = join(tmpdir(), 'dudu-inbox-glyphs');
mkdirSync(scratch, { recursive: true });
for (const [key, name, visual] of SET) {
  const svg = renderToStaticMarkup(React.createElement(lucide[name], { size: 24, width: 24, height: 24, strokeWidth: 2 * visual / 17, color: '#000' }));
  const file = join(scratch, `${key}.svg`);
  writeFileSync(file, svg);
  execFileSync('rsvg-convert', ['--width', '96', '--height', '96', '--output', join(target, `inbox_set_${key}.png`), file]);
}
console.log('Rendered the inbox glyphs for Android.');
