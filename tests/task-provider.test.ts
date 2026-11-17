import assert from 'node:assert/strict';
import test from 'node:test';
import { canRunIn, chooseProvider, followSession, providerDefaults, targetModes } from '../host/dudu-plugin/ui/tasks/format.js';

// The 定时任务 window's provider rule (owner, 2026-11-11): 嘟嘟 is one more provider and works in its own folder, so a task of its own has no workspace and no existing conversation to take over.
// Choosing 嘟嘟 or leaving it must never keep a place it cannot have, or leave a task of the others without a workspace.

const options = { projects: [{ id: 'w1', name: 'one', path: '/work/one' }, { id: 'w2', name: 'two', path: '/work/two' }] };
const claude = { title: 't', prompt: 'p', agent: 'claude', model: 'opus', project: options.projects[1], target: { mode: 'existing', sessionId: 's1' }, schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } };

test('a task of 嘟嘟 has no workspace and may only run in a new conversation or one that is kept; the others keep all three places and start in the first workspace', () => {
  assert.deepEqual(providerDefaults('dudu', options), { project: null, target: { mode: 'new' } });
  assert.deepEqual(providerDefaults('claude', options), { project: options.projects[0], target: { mode: 'reuse' } });
  assert.deepEqual(providerDefaults('claude', {}), { project: null, target: { mode: 'reuse' } }, 'no workspace listed yet: the form fills it in when the options come');
  assert.deepEqual(targetModes('dudu'), ['new', 'reuse']);
  assert.deepEqual(targetModes('claude'), ['reuse', 'new', 'existing']);
});

test('choosing 嘟嘟 drops the workspace and the existing conversation, leaving it brings the first workspace back; between the others only the model starts over', () => {
  const toDudu = chooseProvider(claude, 'dudu', options);
  assert.deepEqual([toDudu.agent, toDudu.model, toDudu.project, toDudu.target], ['dudu', null, null, { mode: 'new' }]);
  const back = chooseProvider({ ...toDudu, target: { mode: 'reuse' } }, 'codex', options);
  assert.deepEqual([back.agent, back.model, back.project, back.target], ['codex', null, options.projects[0], { mode: 'reuse' }]);
  const other = chooseProvider(claude, 'codex', options);
  assert.deepEqual([other.agent, other.model, other.project, other.target], ['codex', null, claude.project, claude.target], 'the workspace and the place chosen for Claude stay for ChatGPT');
  assert.equal(chooseProvider(claude, 'claude', options), claude, 'choosing the provider the draft has changes nothing');
  assert.deepEqual(Object.keys(toDudu), Object.keys(claude), 'the draft keeps its keys in their order: the window compares drafts as text');
});

test('choosing the conversation a task goes into makes its agent, model and workspace the task\'s; only a conversation the plugin can run is one to choose', () => {
  const session = { key: 'dsh:s9', id: 's9', provider: 'dsh', dshSessionId: 's9', agent: 'codex', model: 'gpt-x', workspaceId: 'w2', project: { name: 'two', path: '/work/two' } };
  const draft = { ...claude, target: { mode: 'existing', sessionId: '' } };
  const followed = followSession(draft, session, options);
  assert.deepEqual([followed.agent, followed.model, followed.project, followed.target], ['codex', 'gpt-x', options.projects[1], { mode: 'existing', sessionId: 's9' }]);
  assert.deepEqual(Object.keys(followed), Object.keys(draft), 'the draft keeps its keys in their order');
  assert.equal(followSession(draft, { ...session, model: undefined }, options).model, null, 'a conversation whose model is not known takes the default');
  const can = { providers: [{ id: 'codex', available: true, models: ['gpt-x'] }, { id: 'claude', available: false, models: ['opus'] }] };
  assert.equal(canRunIn(session, can), true);
  assert.equal(canRunIn({ ...session, model: 'gone' }, can), false, 'a model the plugin does not list');
  assert.equal(canRunIn({ ...session, agent: 'claude', model: 'opus' }, can), false, 'a provider that is not available');
  assert.equal(canRunIn({ ...session, workspaceId: undefined }, can), false, 'a conversation that is in no workspace');
  assert.equal(canRunIn(session, {}), true, 'the plugin has not said what it can run yet: it has the last word when the task is saved');
});
