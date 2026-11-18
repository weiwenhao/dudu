import { readFile, writeFile, readdir } from 'node:fs/promises';
import { DICTIONARIES } from '../host/dudu-plugin/ui/strings.js';

const root = new URL('../', import.meta.url);
const native = JSON.parse(await readFile(new URL('native/DSBot/Resources/Localizable.xcstrings', root))).strings;
const words = {};
for (const [zh, value] of Object.entries(native)) {
  const en = value.localizations?.en?.stringUnit?.value ?? value.localizations?.en?.variations?.plural?.other?.stringUnit?.value;
  if (en) words[zh] = en;
  // A source-language phrase already used by the iPhone stays that way until its English is reviewed.
  else if (value.localizations?.['zh-Hans']?.stringUnit?.value === zh) words[zh] = zh;
}
function walk(zh, en) {
  for (const [key, value] of Object.entries(zh)) {
    if (typeof value === 'string' && typeof en?.[key] === 'string') words[value] ??= en[key];
    else if (value && typeof value === 'object') walk(value, en?.[key]);
  }
}
walk(DICTIONARIES.zh, DICTIONARIES.en);
// Debug implementation only: exact Android-specific wording still awaits owner review.
const pending = { '添加图片': 'Add pictures', '发送视频': 'Send video',
  '回到底部': 'Scroll to bottom', '刷新': 'Refresh', '语言': 'Language', '跟随系统': 'System default',
  '连接嘟嘟': 'Connect to Dudu',
  '打开 DSH 并安装嘟嘟插件，在嘟嘟设置中打开配对二维码': 'Open DSH and install the Dudu plugin, then open the pairing QR code in Dudu settings.',
  // The inbox, forward and task redesign (owner, 2026-11-18): the iOS catalog has the same words, its English is awaiting review there too.
  '转发': 'Forward', '转发给': 'Forward to', '最近会话': 'Recent conversations',
  '已转发到 {0}': 'Forwarded to {0}', '已转发到 ': 'Forwarded to ', '搜索': 'Search' };
Object.assign(words, pending);
const src = new URL('native-android/app/src/main/java/app/dudu/android/', root);
async function sources(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry =>
    entry.isDirectory() ? sources(new URL(`${entry.name}/`, directory)) :
      entry.name.endsWith('.kt') && entry.name !== 'Wording.kt' ? readFile(new URL(entry.name, directory), 'utf8') : ''
  ))).flat().join('\n');
}
const used = [...new Set([...((await sources(src)).matchAll(/\bw(?:p)?\("([^"]+)"/g))].map(m => m[1]))];
const missing = used.filter(key => !words[key]);
if (missing.length) throw new Error(`Use existing reviewed App wording: ${JSON.stringify(missing)}`);
const literal = value => JSON.stringify(value).replaceAll('$', '\\$');
const singular = used.flatMap(key => {
  const en = native[key]?.localizations?.en?.variations?.plural?.one?.stringUnit?.value;
  return en ? [`    ${literal(key)} to ${literal(en)}`] : [];
});
await writeFile(new URL('ui/Wording.kt', src), `// Generated from existing App dictionaries by scripts/sync-android-words.mjs.\npackage app.dudu.android.ui\n\nimport androidx.compose.runtime.Composable\nimport androidx.compose.ui.platform.LocalConfiguration\n\nprivate val english = mapOf(\n${used.map(zh => `    ${literal(zh)} to ${literal(words[zh])}`).join(',\n')}\n)\nprivate val englishSingular = mapOf<String, String>(\n${singular.join(',\n')}\n)\n\n@Composable\nfun w(key: String): String {\n    val chinese = LocalConfiguration.current.locales[0].language == "zh"\n    return if (chinese) key else english[key] ?: key\n}\n\n@Composable\nfun wp(key: String, count: Int): String {\n    val chinese = LocalConfiguration.current.locales[0].language == "zh"\n    val pattern = if (chinese) key else if (count == 1) englishSingular[key] ?: english[key] ?: key else english[key] ?: key\n    return pattern.replace("%lld", count.toString())\n}\n`);
console.log(`Synced ${used.length} existing App phrases.`);
await writeFile(new URL('native-android/wording-pending.json', root), JSON.stringify({
  status: 'awaiting-owner-review-before-release', words: pending,
  also: 'wording-sources.json: englishAwaitingOwnerReview',
}, null, 2) + '\n');
