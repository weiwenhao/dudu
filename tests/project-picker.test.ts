import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickProject } from '../host/dudu-plugin/ui/issues/pick-project.js';

test('project picking registers only the selected directory; cancel, picker failure and disposal do not write', async () => {
  const calls: any[] = [];
  const signal = new AbortController().signal;
  const request = async (action: string, body: any, options: any) => {
    calls.push([action, body, options.signal]);
    return { outcome: 'success', project: { id: 'workspace', name: 'Folder name', path: '/canonical/work' } };
  };
  assert.deepEqual(await pickProject({ pickDirectory: async () => '/selected/work', request, signal }), { name: 'Folder name', path: '/canonical/work' });
  assert.deepEqual(calls, [['projects/create', { path: '/selected/work' }, signal]], 'only the selected path is submitted; no manual name or directory creation');
  assert.equal(await pickProject({ pickDirectory: async () => null, request, signal }), null);
  await assert.rejects(pickProject({ pickDirectory: async () => { throw new Error('picker failed'); }, request, signal }), /picker failed/);
  await assert.rejects(pickProject({ pickDirectory: async () => '', request, signal }));
  const canceled = new AbortController();
  await assert.rejects(pickProject({
    pickDirectory: async () => { canceled.abort(); return '/selected/late'; }, request, signal: canceled.signal,
  }), { name: 'AbortError' });
  assert.equal(calls.length, 1, 'none of the canceled or failed selections registers a project');
  await assert.rejects(pickProject({
    pickDirectory: async () => '/selected/rejected', signal,
    request: async () => ({ outcome: 'needs_clarification' }),
  }), /could not be added/);
});
