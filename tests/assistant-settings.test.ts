// The permission default (host/assistant/settings.mjs): full access, and a read only that an older file holds is the program's old default, not the owner's choice.
// It hurt: for days every collection ran read only while the owner saw full access everywhere, and a lark-cli login could not be renewed in that sandbox.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettings } from '../host/assistant/settings.mjs';
import { DEFAULT_NEEDS_YOU_COLOR, NEEDS_YOU_COLORS } from '../host/assistant/needs-you-color.mjs';

function folder(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'settings.json');
}
const permission = (file: string) => createSettings({ file }).get().settings.conversation.permission;

test('nothing saved: full access; a file the program wrote before the marker with read-only in it: full access too', (t) => {
  const file = folder(t);
  assert.equal(permission(file), 'danger-full-access');
  writeFileSync(file, JSON.stringify({ conversation: { model: { provider: 'p', model: 'm' }, permission: 'read-only' }, deepSleep: true }));
  const settings = createSettings({ file });
  assert.equal(settings.get().settings.conversation.permission, 'danger-full-access');
  assert.deepEqual(settings.get().settings.conversation.model, { provider: 'p', model: 'm' }, 'what else was chosen stays');
  assert.equal('settingsVersion' in settings.get().settings, false, 'the marker is the file\'s own');
});

test('read-only chosen after that is kept, also by a file that was first written by the program', (t) => {
  const file = folder(t);
  const first = createSettings({ file });
  assert.equal(first.set({ conversation: { permission: 'read-only' } }).outcome, 'success');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).settingsVersion, 2);
  assert.equal(permission(file), 'read-only', 'a choice survives a restart');
  assert.equal(createSettings({ file }).set({ pet: { enabled: false, doubleSpace: true, voice: true } }).outcome, 'success');
  assert.equal(permission(file), 'read-only', 'and the next save of something else');
});

test('the computer color preference survives restart and rejects values outside the shared palette without rewriting settings', (t) => {
  const file = folder(t);
  const settings = createSettings({ file });
  assert.equal(settings.get().settings.needsYouColor, DEFAULT_NEEDS_YOU_COLOR);
  settings.set({ pet: { enabled: false } });
  for (const { color } of NEEDS_YOU_COLORS) {
    assert.equal(settings.set({ needsYouColor: color.toUpperCase() }).outcome, 'success');
    const saved = createSettings({ file }).get().settings;
    assert.equal(saved.needsYouColor, color);
    assert.equal(saved.pet.enabled, false);
  }
  const before = readFileSync(file, 'utf8');
  for (const value of ['#123456', 'mist', null, {}, '#fff', 'red']) {
    assert.equal(settings.set({ needsYouColor: value }).outcome, 'needs_clarification');
  }
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('invalid saved settings fail intact instead of resetting an unrelated model or permission', (t) => {
  const file = folder(t);
  const chosen = { model: { provider: 'claude', model: 'chosen' }, permission: 'read-only' };
  const saved = { settingsVersion: 2, conversation: chosen, needsYouColor: DEFAULT_NEEDS_YOU_COLOR };
  const inputs = [
    JSON.stringify({ ...saved, needsYouColor: '#123456' }),
    JSON.stringify({ ...saved, widgets: { developer: 'invalid' } }),
    JSON.stringify({ ...saved, conversation: { ...chosen, permission: null } }),
    '{', '[]',
  ];
  for (const text of inputs) {
    writeFileSync(file, text);
    const settings = createSettings({ file });
    assert.throws(() => settings.get());
    assert.throws(() => settings.value('conversation'));
    assert.throws(() => settings.set({ pet: { enabled: false } }));
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.deepEqual(readdirSync(join(file, '..')), ['settings.json'], 'no silent rename or replacement');
    writeFileSync(file, JSON.stringify({ ...saved, futureSetting: { keep: true } }));
    assert.deepEqual(settings.get().settings.conversation, chosen, 'a failed read must not cache defaults');
    settings.set({ pet: { enabled: false } });
    assert.deepEqual(createSettings({ file }).get().settings.conversation, chosen);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).futureSetting, { keep: true });
  }
});

test('a settings read error is not mistaken for a new installation', (t) => {
  const file = folder(t);
  mkdirSync(file);
  const settings = createSettings({ file });
  assert.throws(() => settings.get(), { code: 'EISDIR' });
  assert.throws(() => settings.set({ pet: { enabled: false } }), { code: 'EISDIR' });
  assert.deepEqual(readdirSync(file), []);
});
