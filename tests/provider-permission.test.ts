import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionOf, permissionOfState } from '../host/providers/permission.mjs';

test('the settings a session runs with decide its access mode, and the preset name fills in only when there are none', () => {
  assert.equal(permissionOfState({ preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' }), 'danger-full-access');
  assert.equal(permissionOfState({ preset: 'my-own-name', sandbox: 'danger-full-access', approval: 'never' }), 'danger-full-access');
  assert.equal(permissionOfState({ preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' }), 'workspace-write');
  assert.equal(permissionOfState({ preset: 'read-only', sandbox: 'read-only', approval: 'ask' }), 'read-only');
  assert.equal(permissionOfState({ preset: 'auto', sandbox: 'danger-full-access', approval: 'ask' }), 'auto');
  assert.equal(permissionOfState({ preset: 'custom', sandbox: null, approval: null }), 'custom');
  assert.equal(permissionOfState({ preset: null, sandbox: null, approval: null }), undefined);
  assert.equal(permissionOfState(undefined), undefined);
});

test('reading it from a session never throws', () => {
  const projections = { stateOf: (_session: unknown, key: string) => (key === 'permissions' ? { preset: null, sandbox: 'read-only', approval: 'ask' } : undefined) };
  assert.equal(permissionOf(projections, { session: {} }), 'read-only');
  assert.equal(permissionOf({ stateOf: () => { throw new Error('closed'); } }, { session: {} }), undefined);
  assert.equal(permissionOf(undefined, { session: {} }), undefined);
});
