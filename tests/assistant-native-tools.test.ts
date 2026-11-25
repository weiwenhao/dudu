import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationToolNames, isConversationTool } from '../host/assistant/home/native-tools.mjs';

test('assistant restrictions include preset tools and can recover them after an older global-only mask', () => {
  const agent = {};
  const globalNames = ['mcp__mail__search', 'unrelated_global'];
  const presetNames = ['bash', 'read', 'skill', 'job_output', 'terminal_open', 'terminal_send', 'apply_patch', 'subagent', 'schedule'];
  const ownNames = ['issues_get', 'memory_recall'];
  let allowed = new Set(globalNames.filter(isConversationTool));
  const registry = {
    schemas(scope?: object) {
      return (scope === agent
        ? [...globalNames, ...presetNames].filter((name) => allowed.has(name)).concat(ownNames)
        : globalNames).map((name) => ({ name }));
    },
    view(scope: object) {
      assert.equal(scope, agent, 'inspect the actual assistant scope');
      return { restrictableNames: new Set([...globalNames, ...presetNames]), knownNames: new Set([...globalNames, ...presetNames, ...ownNames]) };
    },
  };
  assert.equal(registry.schemas(agent).some((tool) => tool.name === 'bash'), false, 'the old restriction hid the preset shell');
  const names = conversationToolNames(registry, agent);
  assert.deepEqual(names, ['apply_patch', 'bash', 'job_output', 'mcp__mail__search', 'read', 'schedule', 'skill', 'subagent', 'terminal_open', 'terminal_send', 'unrelated_global']);
  allowed = new Set(names);
  assert.equal(registry.schemas(agent).some((tool) => tool.name === 'bash'), true);
  assert.deepEqual(conversationToolNames(registry, agent), names, 'an installed mask must not erase tools on the next registry update');

  globalNames.splice(0, 1, 'mcp__other__list');
  presetNames.splice(presetNames.indexOf('bash'), 1, 'pwsh');
  const changed = conversationToolNames(registry, agent);
  assert.ok(changed.includes('pwsh') && changed.includes('mcp__other__list'));
  assert.ok(!changed.includes('bash') && !changed.includes('mcp__mail__search'), 'removed tools do not remain admitted');
  assert.ok(!changed.includes('issues_get'), 'never pass own registrations to restrict');
  assert.ok(changed.includes('schedule') && changed.includes('subagent'), 'inherit standard-session capabilities instead of maintaining a second list');
});

test('the assistant keeps legacy global-tool support and one explicit native filter for connectors and guards', () => {
  assert.deepEqual(conversationToolNames({
    schemas: () => ['bash', 'read', 'skill', 'mcp__mail__search', 'unrelated_global'].map((name) => ({ name })),
  }, {}), ['bash', 'mcp__mail__search', 'read', 'skill', 'unrelated_global']);
  for (const name of ['bash', 'pwsh', 'read', 'read_image', 'write', 'edit', 'apply_patch', 'glob', 'grep', 'skill', 'web_search', 'web_fetch', 'job_output', 'job_list', 'job_kill',
    'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list', 'mcp__mail__search']) {
    assert.equal(isConversationTool(name), true, name);
  }
  for (const name of ['new_host_capability', 'schedule', 'subagent', 'plugin_install']) assert.equal(isConversationTool(name), true, name);
  for (const name of ['run_code', 'cua', 'cua_run_code']) assert.equal(isConversationTool(name), false, name);
  assert.deepEqual(conversationToolNames({ view: () => ({ restrictableNames: new Set() }), schemas: () => [{ name: 'bash' }] }, {}), [],
    'an empty inherited scope must not fall back to another scope');
  assert.deepEqual(conversationToolNames({
    view: () => ({ restrictableNames: ['cua_run_code', 'cua', 'bash', 'run_code', 'plugin_install'] }),
  }, {}), ['bash', 'plugin_install'], 'Computer Use is not supported: its tools and the PTC bindings stay private while ordinary capabilities remain inherited');
  for (const name of ['schedule', 'schedule_create', 'cron_create', 'tasks_create']) assert.equal(isConversationTool(name, { scheduled: true }), false, 'a task run cannot create more tasks');
});
