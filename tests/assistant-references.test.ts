import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createIssues } from '../host/assistant/issues/index.mjs';

test('each project has its own monotonic sequence; moves and Undo restore reserved references', () => {
  const issues = createIssues({ file: ':memory:' });
  const one = { name: 'Orca', path: '/work/orca' };
  const two = { name: 'Audio Book', path: '/work/audio' };
  try {
    const a = issues.add({ title: 'no project' }).issue;
    assert.equal(a.ref, null);
    assert.equal(issues.add({ title: 'other project', project: two }).issue.ref, 'AUD-1');
    const assigned = issues.update(a.id, { project: one });
    assert.equal(assigned.issue.ref, 'ORC-1');
    assert.equal(issues.add({ title: 'another', project: one }).issue.ref, 'ORC-2');
    const moved = issues.update(a.id, { project: two });
    assert.equal(moved.issue.ref, 'AUD-2');
    assert.equal(issues.get('aud-2').issue.id, a.id);
    assert.equal(issues.get('ORC-1').outcome, 'error', 'a previous project reference does not point at a different issue');
    assert.equal(issues.undo(moved.eventId).issue.ref, 'ORC-1');
    assert.equal(issues.update(a.id, { project: null }).issue.ref, null);
    assert.equal(issues.update(a.id, { project: one }).issue.ref, 'ORC-1');
    assert.equal(issues.update(a.id, { project: two }).issue.ref, 'AUD-2');
    assert.equal(issues.add({ title: 'last', project: two }).issue.ref, 'AUD-3');
  } finally { issues.close(); }
});

test('project identities follow folders, preserve keys after renaming, and disambiguate identical names', () => {
  const issues = createIssues({ file: ':memory:' });
  try {
    const a = issues.add({ title: 'a', project: { name: 'App', path: '/work/one' } }).issue;
    const b = issues.add({ title: 'b', project: { name: 'App', path: '/work/two' } }).issue;
    assert.equal(a.ref, 'APP-1');
    assert.equal(b.ref, 'APA-1');
    assert.equal(issues.update(a.id, { project: { name: 'Renamed', path: '/work/one/' } }).issue.ref, 'APP-1');
    assert.equal(issues.add({ title: 'c', project: { name: '账本', path: '/work/money' } }).issue.ref, 'MON-1');
    assert.equal(issues.search('MON-1').items.length, 1);
    assert.equal(issues.list({ tab: 'all', filter: { q: 'APA-1' } }).items[0].id, b.id);
  } finally { issues.close(); }
});

test('project keys use at most three ASCII letters, including fallback and colliding project names', () => {
  const issues = createIssues({ file: ':memory:' });
  try {
    for (const [name, path, prefix] of [
      ['Housesigma', '/work/housesigma', 'HOU'],
      ['AI', '/work/ai', 'AI'],
      ['Éclair 2026', '/work/eclair', 'ECL'],
      ['Ａｐｐ', '/work/fullwidth', 'APP'],
      ['账本', '/work/money', 'MON'],
      ['项目', '/项目', 'PRJ'],
    ]) assert.equal(issues.add({ title: name, project: { name, path } }).issue.ref, `${prefix}-1`);
    const refs = new Set<string>();
    for (let n = 0; n < 40; n++) {
      const { ref } = issues.add({ title: `collision ${n}`, project: { name: 'App', path: `/work/collision-${n}` } }).issue;
      assert.match(ref, /^[A-Z]{1,3}-1$/);
      assert.ok(!refs.has(ref));
      refs.add(ref);
    }
  } finally { issues.close(); }
});

test('version 3 keys shorten without renumbering or losing moves, forgotten reservations, sessions and activity', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-short-keys-'));
  const file = join(folder, 'issues.db');
  const long = { name: 'Housesigma', path: '/work/housesigma' };
  const short = { name: 'HOU', path: '/work/short' };
  const other = { name: 'Housesigma', path: '/work/other' };
  let issues = createIssues({ file });
  try {
    const first = issues.add({ title: 'original task', project: long, session: 'dsh:existing' }).issue;
    const second = issues.add({ title: 'moved task', project: long }).issue;
    const moved = issues.update(second.id, { project: short });
    const third = issues.add({ title: 'same name, other folder', project: other }).issue;
    const forgotten = issues.add({ title: 'forgotten task', project: long }).issue;
    issues.forget(forgotten.id, { token: issues.forget(forgotten.id).token });
    issues.log(first.id, { kind: 'note', text: 'keep the original activity' });
    const before = issues.export();
    issues.close();
    const raw = new DatabaseSync(file);
    const legacy = new Map([[`path:${long.path}`, 'HOUSESIGMA'], [`path:${short.path}`, 'HOU'], [`path:${other.path}`, 'HOUSESIGMA2']]);
    const rows = raw.prepare('SELECT rowid, identity, key FROM issue_projects').all() as any[];
    for (const row of rows) {
      raw.prepare('UPDATE issue_projects SET key = ? WHERE identity = ?').run(`@old-${row.rowid}`, row.identity);
      raw.prepare('UPDATE issues SET project_key = ? WHERE project_key = ?').run(`@old-${row.rowid}`, row.key);
    }
    for (const row of rows) {
      raw.prepare('UPDATE issue_projects SET key = ? WHERE identity = ?').run(legacy.get(row.identity)!, row.identity);
      raw.prepare('UPDATE issues SET project_key = ? WHERE project_key = ?').run(legacy.get(row.identity)!, `@old-${row.rowid}`);
    }
    raw.exec('PRAGMA user_version = 3');
    raw.close();
    issues = createIssues({ file });
    assert.equal(issues.get(first.id).issue.ref, 'HOA-1', 'the existing short key is reserved before shortening a long one');
    assert.equal(issues.get(second.id).issue.ref, 'HOU-1');
    assert.equal(issues.get(third.id).issue.ref, 'HOB-1');
    assert.equal(issues.get(first.id).issue.session, 'dsh:existing');
    const after = issues.export();
    for (const key of ['events', 'log', 'sessions', 'references'] as const) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(after.projects.map(({ identity, next_number }: any) => [identity, next_number]), before.projects.map(({ identity, next_number }: any) => [identity, next_number]));
    assert.equal(issues.undo(moved.eventId).issue.ref, 'HOA-2');
    assert.equal(issues.add({ title: 'later task', project: long }).issue.ref, 'HOA-4');
    assert.equal(issues.get('hoa-1').issue.id, first.id);
    issues.close();
    issues = createIssues({ file });
    assert.equal(issues.get(first.id).issue.ref, 'HOA-1', 'reopening does not choose new keys');
  } finally { issues.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('a version 2 database migrates in order without changing internal ids, logs or sessions', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-reference-migration-'));
  const file = join(folder, 'issues.db');
  let issues = createIssues({ file });
  try {
    const first = issues.add({ title: 'old one', project: { name: 'App', path: '/work/app' }, session: 'dsh:existing' }).issue;
    const second = issues.add({ title: 'old two', project: { name: 'App', path: '/work/app' } }).issue;
    const bare = issues.add({ title: 'unplanned' }).issue;
    issues.log(first.id, { kind: 'note', text: 'keep me' });
    issues.close();
    const raw = new DatabaseSync(file);
    raw.exec(`DROP INDEX issues_reference;
      ALTER TABLE issues DROP COLUMN project_key;
      ALTER TABLE issues DROP COLUMN project_number;
      DROP TABLE issue_project_numbers;
      DROP TABLE issue_projects;
      PRAGMA user_version = 2;`);
    raw.close();
    issues = createIssues({ file });
    assert.equal(issues.get(first.id).issue.ref, 'APP-1');
    assert.equal(issues.get(second.id).issue.ref, 'APP-2');
    assert.equal(issues.get(bare.id).issue.ref, null);
    assert.equal(issues.get(first.id).log[0].text, 'keep me');
    assert.equal(issues.get(first.id).issue.session, 'dsh:existing');
    const other = createIssues({ file });
    try { assert.equal(other.add({ title: 'concurrent', project: { name: 'App', path: '/work/app' } }).issue.ref, 'APP-3'); }
    finally { other.close(); }
    assert.equal(issues.add({ title: 'later', project: { name: 'App', path: '/work/app' } }).issue.ref, 'APP-4');
  } finally { issues.close(); rmSync(folder, { recursive: true, force: true }); }
});
