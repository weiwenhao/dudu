import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { NATIVE_METHODS } from '../host/native-bridge.mjs';
import { sampleResponses, shapeOf } from './support/app-contract-cases.mjs';

// What each released phone app asks the computer for. The plugin installs as the newest version while an iPhone app waits days for review, so a plugin change that drops or renames one of
// these breaks every phone that has not updated (owner, 2026-11-21). Keep one fixture per app that is out there (`app-contract-<app>.json`), and never take a name out of it while that build is in use.
const fixtures = new URL('./fixtures/', import.meta.url);
const files = readdirSync(fixtures).filter((name) => name.startsWith('app-contract-'));
const read = (name: string) => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'));

for (const name of files.filter((file) => !file.includes('-shapes'))) {
  const contract = read(name);
  test(`the plugin still answers every request of ${contract.app}`, () => {
    const known = new Set<string>(NATIVE_METHODS);
    assert.deepEqual(contract.methods.filter((method: string) => !known.has(method)), []);
  });
}

// The answers themselves: every key an old app decodes, with the type it decodes. Recorded from the plugin of that build's commit (scripts/record-app-contract.mjs), never edited
// (a later case of the same build goes in a file of its own): the plugin of today may answer with more, not with less or with another type. `null` there means "optional, it was
// absent or empty": any type, or none, is fine.
test('the plugin of today still answers the way the plugin of every released app did, key for key', async () => {
  const now = await sampleResponses(new URL('..', import.meta.url).pathname);
  const lost: string[] = [];
  for (const name of files.filter((file) => file.includes('-shapes'))) {
    const recorded = read(name);
    for (const [answer, paths] of Object.entries<string[]>(recorded.shapes)) {
      const have = shapeOf(now[answer]);
      for (const entry of paths) if (!entry.endsWith(':null') && !have.has(entry)) lost.push(`${recorded.app} · ${answer}: ${entry}`);
    }
  }
  assert.deepEqual(lost, [], 'a key an app in use decodes is gone or has another type: keep it, or give the new shape only to apps that declared they understand it');
});
