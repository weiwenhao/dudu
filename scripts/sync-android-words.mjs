import { readFile, writeFile, readdir } from 'node:fs/promises';
import { DICTIONARIES } from '../host/dudu-plugin/ui/strings.js';
import { NATIVE_ENGLISH } from '../host/native-strings.mjs';

const root = new URL('../', import.meta.url);
const native = JSON.parse(await readFile(new URL('native/ios/Dudu/Resources/Localizable.xcstrings', root))).strings;
const words = {};
for (const [zh, value] of Object.entries(native)) {
  const en = value.localizations?.en?.stringUnit?.value ?? value.localizations?.en?.variations?.plural?.other?.stringUnit?.value;
  if (en) words[zh] = en;
  // A source-language phrase already used by the iPhone stays that way until its English is reviewed.
  else if (value.localizations?.['zh-Hans']?.stringUnit?.value === zh) words[zh] = zh;
}
// The words of 嘟嘟's settings pages. The app lays those pages out itself (`data/SettingsPages.kt`, 2026-11-21), so it says them in the English the computer used to send for the app
// (host/native-strings.mjs; awaiting the owner's review in docs/native-localization-wording.md). A key that the iPhone's catalog already has with an English keeps that one; the desktop's
// English comes after, so that a page says what it said on the phone before. A plural entry there is { one, other }.
const settingsSingular = {};
for (const [zh, en] of Object.entries(NATIVE_ENGLISH)) {
  const other = typeof en === 'string' ? en : en.other;
  if (words[zh] === undefined || words[zh] === zh) words[zh] = other;
  if (typeof en === 'object') settingsSingular[zh] = en.one;
}
function walk(zh, en) {
  for (const [key, value] of Object.entries(zh)) {
    if (typeof value === 'string' && typeof en?.[key] === 'string') words[value] ??= en[key];
    else if (value && typeof value === 'object') walk(value, en?.[key]);
  }
}
walk(DICTIONARIES.zh, DICTIONARIES.en);
// Debug implementation only: exact Android-specific wording still awaits owner review.
// 添加图片 and the guide's instruction are the iPhone's words and take the iPhone's English (2026-11-22, the parity audit's D24: "Add photos", "Dudu's settings").
const pending = { '发送视频': 'Send video',
  '回到底部': 'Scroll to bottom', '刷新': 'Refresh', '语言': 'Language', '跟随系统': 'System default',
  '连接嘟嘟': 'Connect to Dudu',
  // The inbox, forward and task redesign (owner, 2026-11-18): the iOS catalog has the same words, its English is awaiting review there too.
  '转发': 'Forward', '转发给': 'Forward to', '最近会话': 'Recent conversations',
  '已转发到 {0}': 'Forwarded to {0}', '已转发到 ': 'Forwarded to ', '搜索': 'Search',
  // The phone's speech service has no microphone permission of its own while the app has (2026-11-21): whose it is, and where to give it.
  '请允许{0}使用麦克风，点这里打开设置。': 'Allow {0} to use the microphone. Tap here to open its settings.',
  // Notifications without Google's push service (owner, 2026-11-22: the Chinese approved, 「可以的」): the ongoing notification and the two notification categories.
  '嘟嘟正在接收通知': 'Dudu is receiving notifications', '收集器通知': 'Collector notifications', '后台连接': 'Background connection' };
Object.assign(words, pending);
const src = new URL('native/android/app/src/main/java/app/dudu/android/', root);
async function sources(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry =>
    entry.isDirectory() ? sources(new URL(`${entry.name}/`, directory)) :
      entry.name.endsWith('.kt') && entry.name !== 'Wording.kt' ? readFile(new URL(entry.name, directory), 'utf8') : ''
  ))).flat().join('\n');
}
const used = [...new Set([...((await sources(src)).matchAll(/\b(?:wp?|word)\("([^"]+)"/g))].map(m => m[1]))];
const missing = used.filter(key => !words[key]);
if (missing.length) throw new Error(`Use existing reviewed App wording: ${JSON.stringify(missing)}`);
const literal = value => JSON.stringify(value).replaceAll('$', '\\$');
const singular = used.flatMap(key => {
  const en = native[key]?.localizations?.en?.variations?.plural?.one?.stringUnit?.value ?? settingsSingular[key];
  return en ? [`    ${literal(key)} to ${literal(en)}`] : [];
});
await writeFile(new URL('ui/Wording.kt', src), `// Generated from existing App dictionaries by scripts/sync-android-words.mjs.\npackage app.dudu.android.ui\n\nimport androidx.compose.runtime.Composable\nimport androidx.compose.ui.platform.LocalConfiguration\n\ninternal val english = mapOf(\n${used.map(zh => `    ${literal(zh)} to ${literal(words[zh])}`).join(',\n')}\n)\ninternal val englishSingular = mapOf<String, String>(\n${singular.join(',\n')}\n)\n\n@Composable\nfun w(key: String): String {\n    val chinese = LocalConfiguration.current.locales[0].language == "zh"\n    return if (chinese) key else english[key] ?: key\n}\n\n@Composable\nfun wp(key: String, count: Int): String {\n    val chinese = LocalConfiguration.current.locales[0].language == "zh"\n    val pattern = if (chinese) key else if (count == 1) englishSingular[key] ?: english[key] ?: key else english[key] ?: key\n    return pattern.replace("%lld", count.toString())\n}\n`);
console.log(`Synced ${used.length} existing App phrases.`);
await writeFile(new URL('native/android/wording-pending.json', root), JSON.stringify({
  status: 'awaiting-owner-review-before-release', words: pending,
  also: 'wording-sources.json: englishAwaitingOwnerReview; the settings pages\' words come from host/native-strings.mjs (docs/native-localization-wording.md)',
}, null, 2) + '\n');
