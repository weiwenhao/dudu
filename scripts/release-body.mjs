// The text of a release page (owner, 2026-11-26): the install lines, then what changed, then the link to the full list of changes.
// What changed is `release-notes/<version>.md`: both languages, written and reviewed before the tag is pushed. Without that file the page gets the install lines only,
// and the workflow adds the list that GitHub generates.
// Usage: node scripts/release-body.mjs <version> <tag> <owner/repo>      prints the Markdown of the page.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_STORE_EN = 'https://apps.apple.com/us/app/dudu-multi-agent-assistant/id6833981505';
const APP_STORE_ZH = 'https://apps.apple.com/cn/app/dudu-%E5%A4%9A%E6%99%BA%E8%83%BD%E4%BD%93%E5%8D%8F%E4%BD%9C%E5%8A%A9%E6%89%8B/id6833981505';
const TESTFLIGHT = 'https://testflight.apple.com/join/TNUPd6n7'; // a public link: it does not change from one version to the next

export const INSTALL = `## Install

- **Plugin:** enter \`dsh-dudu\` in DSH's "Add plugin".
- **iPhone:** search for "Dudu - Multi-Agent Assistant" in the [App Store](${APP_STORE_EN}), or join the [TestFlight beta](${TESTFLIGHT}) for the latest version.
- **Android:** install the apk below.

## 安装

- **插件：** 在 DSH 的「添加插件」里输入 dsh-dudu。
- **iPhone：** 在 [App Store](${APP_STORE_ZH}) 搜索「Dudu-多智能体协作助手」，也可以通过 [TestFlight](${TESTFLIGHT}) 安装最新版。
- **安卓：** 下载下面的 apk。`;

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Order of two release tags by semantic versioning (a version without a pre-release part is newer than the same one with it). */
export function compareTags(a, b) {
  const [x, y] = [TAG.exec(a), TAG.exec(b)];
  for (let i = 1; i <= 3; i += 1) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
  if (x[4] === y[4]) return 0;
  if (x[4] === undefined) return 1;
  if (y[4] === undefined) return -1;
  const [p, q] = [x[4].split('.'), y[4].split('.')];
  for (let i = 0; i < Math.max(p.length, q.length); i += 1) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const [n, m] = [/^\d+$/.test(p[i]), /^\d+$/.test(q[i])];
    if (n && m && Number(p[i]) !== Number(q[i])) return Number(p[i]) - Number(q[i]);
    if (n !== m) return n ? -1 : 1;
    if (!n && p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

/** The newest release tag that is older than `tag`, or undefined when there is none; a final release is compared with the previous final one, not with its own release candidates. */
export function previousTag(tag, tags) {
  const final = !TAG.exec(tag)[4];
  return tags.filter((item) => TAG.test(item) && compareTags(item, tag) < 0 && (!final || !TAG.exec(item)[4])).sort(compareTags).at(-1);
}

export function releaseBody({ version, tag, repo, tags, notes }) {
  if (!notes) return INSTALL;
  const previous = TAG.test(tag) ? previousTag(tag, tags) : undefined;
  const changelog = previous ? `**Full Changelog**: https://github.com/${repo}/compare/${previous}...${tag}` : '';
  return [INSTALL, notes.trim(), changelog].filter(Boolean).join('\n\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, tag, repo] = process.argv.slice(2);
  if (!version || !tag || !repo) throw new Error('Usage: node scripts/release-body.mjs <version> <tag> <owner/repo>');
  const file = join(root, 'release-notes', `${version}.md`);
  let tags = [];
  try { tags = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* no history: no link */ }
  process.stdout.write(`${releaseBody({ version, tag, repo, tags, notes: existsSync(file) ? readFileSync(file, 'utf8') : '' })}\n`);
}
