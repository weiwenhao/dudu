import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openAssistant } from '../host/assistant/assistant.mjs';
import { updateOwnerRule } from '../host/assistant/rules.mjs';

function world(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'dudu-rules-'));
  const assistant = openAssistant({
    dshHome: root, stateFolder: join(root, 'state'), env: { DUDU_ALLOW_TEMP_HOME: '1' },
  });
  t.after(async () => { await assistant.close(); rmSync(root, { recursive: true, force: true }); });
  const folder = assistant.folder!;
  const read = (name: string) => readFileSync(join(folder, name), 'utf8');
  const call = async (name: string, body: any = {}) => (await assistant.handle(name, new Request('http://test/', {
    method: 'POST', body: JSON.stringify(body),
  }))).json();
  return { root, assistant, folder, read, call };
}

test('rule saves reject stale revisions, changed project folders and non-rule paths without overwriting files', async (t) => {
  const w = world(t);
  const previous = w.read('TRIAGE.md');
  const request = { name: 'TRIAGE.md', text: 'settings draft', previous, projectFolder: w.folder };
  writeFileSync(join(w.folder, 'TRIAGE.md'), 'external edit');
  assert.equal((await w.call('rules/update', request)).code, 'CONFLICT');
  assert.equal(w.read('TRIAGE.md'), 'external edit');
  assert.equal((await w.call('rules/update', { ...request, previous: 'external edit', projectFolder: join(w.root, 'elsewhere') })).code, 'FOLDER_CHANGED');
  for (const name of ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'CONNECTORS.md', '../TRIAGE.md', './TRIAGE.md', 'triage.md']) {
    assert.equal((await w.call('rules/update', { ...request, name })).code, 'INVALID_RULE');
  }
  assert.equal((await w.call('rules/update', { ...request, previous: undefined })).code, 'INVALID_RULE');
  assert.equal((await w.call('rules/update', { ...request, text: '字'.repeat(700_000) })).code, 'INVALID_RULE');
  assert.equal(w.read('TRIAGE.md'), 'external edit');
});

test('a missing rule can be created empty, while failed atomic writes preserve the old file and its mode', (t) => {
  const w = world(t);
  rmSync(join(w.folder, 'ASSIGN.md'));
  assert.equal(updateOwnerRule(w.folder, { name: 'ASSIGN.md', text: '', previous: null, projectFolder: w.folder }).outcome, 'success');
  assert.equal(w.read('ASSIGN.md'), '');
  const previous = w.read('TRIAGE.md');
  const request = { name: 'TRIAGE.md', text: '# New rules\n', previous, projectFolder: w.folder };
  const failed = updateOwnerRule(w.folder, request, { rename: () => { throw new Error('disk failure'); } });
  assert.equal(failed.code, 'WRITE_FAILED');
  assert.equal(w.read('TRIAGE.md'), previous);
  assert.deepEqual(readdirSync(w.folder).filter((name) => name.endsWith('.tmp')), []);
  chmodSync(join(w.folder, 'TRIAGE.md'), 0o640);
  assert.equal(updateOwnerRule(w.folder, request).outcome, 'success');
  assert.equal(statSync(join(w.folder, 'TRIAGE.md')).mode & 0o777, 0o640);
});
