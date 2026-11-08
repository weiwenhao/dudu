import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory } from '../host/assistant/memory/index.mjs';
import { parseCurated, serializeCurated } from '../host/assistant/memory/files.mjs';
import { redact } from '../host/assistant/memory/secrets.mjs';
import { checkFolder, defaultFolder, ensureFolder, MARKER, migrate, REASONS, tempRoots } from '../host/assistant/project.mjs';
import { TEMPLATE_NAMES, TEMPLATES } from '../host/assistant/templates.mjs';

// Real folders, real links, real moves. The temp-dir rule is on in the refusal tests (env = {}) and switched off, as the doc allows
// for isolated test setups, where a test needs to create a folder under the machine's temp dir.
const ALLOW = { DUDU_ALLOW_TEMP_HOME: '1' };
const world = (t: any) => {
  const base = mkdtempSync(join(tmpdir(), 'dudu-project-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
};
function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else found.push(join(dir, entry.name));
    }
  };
  walk(root);
  return found;
}
const snapshot = (dir: string) => Object.fromEntries(filesUnder(dir).map((file) => [file.slice(dir.length), readFileSync(file, 'utf8')]));

test('a new project folder gets the eight template files, never overwrites what is there, and a memory works in it', async (t) => {
  const base = world(t);
  assert.equal(defaultFolder('/Users/x/.dsh'), join('/Users/x/.dsh', 'dudu', 'home'));
  assert.equal(defaultFolder(undefined, { env: { DSH_HOME: '/data/dsh' } }), join('/data/dsh', 'dudu', 'home'));
  assert.equal(defaultFolder('', { env: {} }), join(homedir(), '.dsh', 'dudu', 'home'));

  const folder = join(base, 'home');
  assert.deepEqual(ensureFolder(folder, { env: ALLOW }), { ok: true, path: folder, created: TEMPLATE_NAMES, kept: [] });
  assert.deepEqual(TEMPLATE_NAMES, ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'CONNECTORS.md', 'COLLECTORS.md', 'TRIAGE.md', 'ASSIGN.md']);
  assert.deepEqual(readdirSync(folder).sort(), [...TEMPLATE_NAMES].sort());

  // The templates: complete, short, plain; the marker is the first line of AGENTS.md; nothing in them looks like a secret.
  for (const name of TEMPLATE_NAMES) {
    const text = readFileSync(join(folder, name), 'utf8');
    assert.equal(text, TEMPLATES[name]);
    assert.ok(text.length > 40 && text.length < 1500, `${name} is short`);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n') && !text.includes('\r'), name);
    assert.match(text, /[\u4e00-\u9fff]/, `${name} is written in Chinese`);
    assert.equal(redact(text), text, name);
  }
  assert.equal(MARKER, '<!-- dudu-home -->');
  assert.equal(TEMPLATES['AGENTS.md'].split('\n')[0], MARKER);
  assert.match(TEMPLATES['AGENTS.md'], /只有你能改/);
  assert.match(TEMPLATES['TRIAGE.md'], /影响[\s\S]*工作量[\s\S]*优先级[\s\S]*截止/);
  assert.match(TEMPLATES['ASSIGN.md'], /访问方式[\s\S]*只读/);
  assert.match(TEMPLATES['ASSIGN.md'], /Todo/);
  // USER.md and MEMORY.md start without entries and are already in the form the memory writes (so the first write changes nothing else).
  for (const name of ['USER.md', 'MEMORY.md']) {
    assert.deepEqual(parseCurated(TEMPLATES[name]).entries, []);
    assert.equal(serializeCurated(parseCurated(TEMPLATES[name])), TEMPLATES[name]);
  }
  // CONNECTORS.md and COLLECTORS.md show the format and register nothing: no heading, no comment line at the start of a line, nothing enabled.
  for (const name of ['CONNECTORS.md', 'COLLECTORS.md']) {
    const text = TEMPLATES[name];
    assert.ok(!/^## /m.test(text) && !/^<!--/m.test(text) && !/^```/m.test(text), name);
    assert.doesNotMatch(text, /enabled: true/);
    assert.ok(text.split('\n').filter((line) => /^\s*(##|<!--|```)/.test(line)).every((line) => line.startsWith('    ')), `the example of ${name} is indented`);
  }
  assert.match(TEMPLATES['CONNECTORS.md'], /Prompt[\s\S]*MCP/);
  assert.match(TEMPLATES['COLLECTORS.md'], /连接器[\s\S]*收集什么/);

  // The folder now counts as a 嘟嘟 folder; setting it up again changes nothing that is there, and only brings back what is missing.
  assert.deepEqual(checkFolder(folder, { env: ALLOW }), { ok: true, path: folder, real: checkFolder(folder, { env: ALLOW }).real, exists: true, empty: false, marked: true });
  writeFileSync(join(folder, 'SOUL.md'), '我自己写的口吻\n');
  rmSync(join(folder, 'TRIAGE.md'));
  const again = ensureFolder(folder, { env: ALLOW });
  assert.deepEqual([again.created, again.kept.length], [['TRIAGE.md'], 7]);
  assert.equal(readFileSync(join(folder, 'SOUL.md'), 'utf8'), '我自己写的口吻\n');
  assert.equal(readFileSync(join(folder, 'TRIAGE.md'), 'utf8'), TEMPLATES['TRIAGE.md']);

  // A memory opened on the folder works in it, and what it removes again leaves the file as the template.
  const memory = createMemory({ dir: folder, indexDir: join(base, 'state', 'index') });
  t.after(() => memory.close());
  const said = memory.capture({ role: 'owner', text: '记一下：数据库用 Postgres。' });
  assert.equal(memory.remember({ text: '数据库用 Postgres', src: said.ref }).outcome, 'success');
  assert.match(memory.context().text, /--- AGENTS\.md ---\n# 嘟嘟的规则/);
  assert.match(memory.context().text, /--- SOUL\.md ---\n我自己写的口吻/);
  assert.match(readFileSync(join(folder, 'MEMORY.md'), 'utf8'), /^# 记住的事\n\n<!-- 格式同 USER.md[^\n]*-->\n\n<!-- m1 \| /);
  assert.equal(memory.forget({ source: said.ref, preview: false }).outcome, 'success');
  assert.equal(readFileSync(join(folder, 'MEMORY.md'), 'utf8'), TEMPLATES['MEMORY.md']);
  assert.deepEqual(['AGENTS.md', 'TRIAGE.md', 'ASSIGN.md'].map((name) => readFileSync(join(folder, name), 'utf8')), [TEMPLATES['AGENTS.md'], TEMPLATES['TRIAGE.md'], TEMPLATES['ASSIGN.md']]);
});

test('a folder is refused when it is temporary, leads into a temporary place, is a file or is someone else\'s project; each refusal says why', (t) => {
  const base = world(t);
  const refused = (path: any, code: string, options: any = { env: {} }) => {
    const result: any = checkFolder(path, options);
    assert.equal(result.ok, false, String(path));
    assert.equal(result.code, code, `${path}: ${JSON.stringify(result)}`);
    assert.equal(result.reason, REASONS[code as keyof typeof REASONS]);
    assert.ok(typeof result.reason === 'string' && result.reason.length > 10);
    return result;
  };

  // The machine's real temporary locations, with nothing in `env`: the default folder and a chosen one are checked the same way.
  refused(join(tmpdir(), 'dudu-never-created', 'home'), 'temp');
  refused(join(base, 'home'), 'temp'); // a folder that exists under it
  if (process.platform !== 'win32') {
    for (const path of ['/tmp/dudu-never-created/home', '/private/tmp/dudu-never-created', '/var/folders/zz/dudu-never-created/T/home', '/var/tmp/dudu-never-created']) refused(path, 'temp');
  }
  assert.ok(tempRoots({ TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp', TMP: '/mine/tmp' }).includes('C:\\Users\\me\\AppData\\Local\\Temp'));
  assert.ok(tempRoots({ TMP: '/mine/tmp' }).includes('/mine/tmp'));
  // Only the exact word of the test setups switches the rule off.
  assert.equal(checkFolder(join(base, 'home'), { env: ALLOW }).ok, true);
  for (const word of ['0', 'true', 'yes', '']) refused(join(base, 'home'), 'temp', { env: { DUDU_ALLOW_TEMP_HOME: word } });

  // A link counts by where it leads. Here "temporary" is a folder of our own, so links can be made from outside it.
  const tempRoot = join(base, 'temp-root');
  const elsewhere = join(base, 'elsewhere');
  mkdirSync(join(tempRoot, 'inner'), { recursive: true });
  mkdirSync(join(elsewhere, 'plain'), { recursive: true });
  const options = { env: {}, tempRoots: [tempRoot] };
  assert.equal(checkFolder(join(elsewhere, 'plain'), options).ok, true);
  assert.equal(checkFolder(join(elsewhere, 'new-folder'), options).ok, true); // not there yet
  refused(join(tempRoot, 'inner', 'home'), 'temp', options);
  if (process.platform !== 'win32') {
    symlinkSync(join(tempRoot, 'inner'), join(elsewhere, 'to-temp'));
    symlinkSync(join(elsewhere, 'plain'), join(elsewhere, 'to-plain'));
    symlinkSync(join(base, 'missing'), join(elsewhere, 'dangling'));
    refused(join(elsewhere, 'to-temp'), 'temp', options);
    refused(join(elsewhere, 'to-temp', 'not-yet', 'home'), 'temp', options); // the new folder would be made inside the temp folder
    assert.equal(checkFolder(join(elsewhere, 'to-plain'), options).ok, true);
    refused(join(elsewhere, 'dangling'), 'link', options);
    // ensureFolder repeats the checks and creates nothing when they fail.
    assert.equal((ensureFolder(join(elsewhere, 'to-temp', 'home'), options) as any).code, 'temp');
    assert.equal(existsSync(join(tempRoot, 'inner', 'home')), false);
  }

  // Not a folder, not a full path, nothing given.
  writeFileSync(join(elsewhere, 'a-file'), 'x');
  refused(join(elsewhere, 'a-file'), 'not_directory', options);
  refused(join(elsewhere, 'a-file', 'sub'), 'not_directory', options);
  refused('relative/path', 'relative', options);
  for (const path of ['', '   ', null, undefined, 5]) refused(path, 'empty', options);
  if (process.platform !== 'win32') {
    const home = join(base, 'fake-home');
    mkdirSync(home);
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      const result: any = checkFolder('~/notes/dudu', options);
      assert.deepEqual([result.ok, result.path], [true, join(home, 'notes', 'dudu')]);
    } finally {
      if (saved === undefined) delete process.env.HOME;
      else process.env.HOME = saved;
    }
  }

  // Someone else's project: a folder with anything in it must carry the marker as the first line of AGENTS.md.
  const project = join(elsewhere, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), '{}');
  refused(project, 'not_dudu', options);
  assert.deepEqual(readdirSync(project), ['package.json']);
  assert.equal((ensureFolder(project, options) as any).code, 'not_dudu'); // and nothing is added to it
  assert.deepEqual(readdirSync(project), ['package.json']);
  writeFileSync(join(project, 'AGENTS.md'), `# Rules of another project\n${MARKER}\n`); // the marker on the second line is not the marker
  refused(project, 'not_dudu', options);
  rmSync(join(project, 'package.json'));
  writeFileSync(join(project, 'AGENTS.md'), `\uFEFF${MARKER}\r\n# 嘟嘟的规则\r\n`); // a BOM and Windows line ends do not matter
  assert.deepEqual([checkFolder(project, options).ok, (checkFolder(project, options) as any).marked], [true, true]);
  const quiet = join(elsewhere, 'quiet');
  mkdirSync(join(quiet, '.git'), { recursive: true });
  writeFileSync(join(quiet, '.DS_Store'), '');
  const clean = checkFolder(quiet, options) as any;
  assert.deepEqual([clean.ok, clean.empty, clean.marked], [true, true, false]); // what a file manager and git leave behind is not content
});

test('migrate moves a 嘟嘟 folder with its marker, by a rename or a verified copy, and refuses what could lose files', (t) => {
  const base = world(t);
  const env = ALLOW;
  const from = join(base, 'old');
  assert.equal(ensureFolder(from, { env }).ok, true);
  mkdirSync(join(from, 'notes'));
  writeFileSync(join(from, 'notes', 'mine.txt'), '我自己的笔记\n');
  const memory = createMemory({ dir: from, indexDir: join(base, 'state', 'index') });
  assert.equal(memory.remember({ text: '数据库用 Postgres', src: 'owner' }).outcome, 'success');
  memory.close();
  const before = snapshot(from);

  // What is refused moves nothing.
  const other = join(base, 'other-project');
  mkdirSync(other);
  writeFileSync(join(other, 'readme.md'), 'x');
  const stuffed = join(base, 'stuffed');
  mkdirSync(stuffed);
  writeFileSync(join(stuffed, 'file.txt'), 'x');
  const taken = join(base, 'taken');
  assert.equal(ensureFolder(taken, { env }).ok, true);
  const refusals: [any, any, string][] = [
    [from, join(from, 'inside', 'home'), 'nested'], [join(from, 'notes'), base, 'source_not_dudu'], [from, base, 'not_dudu'], [from, from, 'same'], [from, `${from}/`, 'same'],
    [other, join(base, 'target'), 'source_not_dudu'], [from, stuffed, 'not_dudu'], [from, taken, 'destination_not_empty'],
    [from, 'relative/path', 'relative'], [from, '', 'empty'], ['', join(base, 'target'), 'empty'],
  ];
  for (const [source, target, code] of refusals) {
    const result: any = migrate(source, target, { env });
    assert.deepEqual([result.ok, result.code, result.reason], [false, code, REASONS[code as keyof typeof REASONS]], `${source} -> ${target}`);
  }
  assert.equal((migrate(from, join(base, 'target'), { env: {} }) as any).code, 'temp'); // the new place is checked like any folder
  if (process.platform !== 'win32') {
    symlinkSync(from, join(base, 'link-to-old'));
    assert.equal((migrate(join(base, 'link-to-old'), join(base, 'target'), { env }) as any).code, 'source_link');
    assert.equal(lstatSync(join(base, 'link-to-old')).isSymbolicLink(), true);
  }
  assert.deepEqual(snapshot(from), before);
  assert.equal(existsSync(join(base, 'target')), false);

  // A rename when the new place does not exist yet; the marker goes with the content, and a memory finds its entries there.
  const second = join(base, 'new', 'deeper', 'home');
  const renamed: any = migrate(from, second, { env });
  assert.deepEqual([renamed.ok, renamed.method, renamed.to, renamed.moved], [true, 'rename', second, Object.keys(before).length]);
  assert.equal(existsSync(from), false);
  assert.deepEqual(snapshot(second), before);
  assert.equal(readFileSync(join(second, 'AGENTS.md'), 'utf8').split('\n')[0], MARKER);
  assert.equal(checkFolder(second, { env }).ok, true);
  const moved = createMemory({ dir: second, indexDir: join(base, 'state', 'index') });
  assert.deepEqual(moved.records().records.map((r: any) => r.text), ['数据库用 Postgres']);
  moved.close();

  // A copy (what a move to another disk is), into an existing empty folder; the old one is removed only after the copy was verified.
  const third = join(base, 'third');
  mkdirSync(third);
  writeFileSync(join(third, '.DS_Store'), '');
  const copied: any = migrate(second, third, { env, useRename: false });
  assert.deepEqual([copied.ok, copied.method, copied.moved], [true, 'copy', Object.keys(before).length]);
  assert.equal(existsSync(second), false);
  const { '/.DS_Store': _, ...arrived } = snapshot(third);
  assert.deepEqual(arrived, before);
  assert.equal(readFileSync(join(third, 'AGENTS.md'), 'utf8').split('\n')[0], MARKER);

  // A copy that cannot be completed (both folders have a .DS_Store, which the copy will not overwrite): the old folder is untouched,
  // and what the copy had already put into the new place is taken back.
  const fourth = join(base, 'fourth');
  const fifth = join(base, 'fifth');
  assert.equal(ensureFolder(fourth, { env }).ok, true);
  writeFileSync(join(fourth, '.DS_Store'), 'finder');
  mkdirSync(fifth);
  writeFileSync(join(fifth, '.DS_Store'), 'theirs');
  const keep = snapshot(fourth);
  const failed: any = migrate(fourth, fifth, { env, useRename: false });
  assert.deepEqual([failed.ok, failed.code, failed.reason], [false, 'move_failed', REASONS.move_failed]);
  assert.deepEqual(snapshot(fourth), keep);
  assert.deepEqual(snapshot(fifth), { '/.DS_Store': 'theirs' });

  // Nothing to move yet (the folder was never made): the new place just becomes the folder, with the templates.
  const fresh: any = migrate(join(base, 'never-made'), join(base, 'fresh'), { env });
  assert.deepEqual([fresh.ok, fresh.method, fresh.moved], [true, 'none', 0]);
  assert.deepEqual(readdirSync(join(base, 'fresh')).sort(), [...TEMPLATE_NAMES].sort());
});
