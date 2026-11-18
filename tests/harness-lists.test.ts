import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HARNESS_IDS, harnessName } from '../host/providers/catalog.mjs';
import { AGENT_COLORS, AGENT_LOGOS, agentLogo } from '../host/dudu-plugin/ui/issues/agent-logos.js';
import { AGENT_NAMES, HARNESS_AGENTS } from '../host/dudu-plugin/ui/issues/model.js';

// The harness ids are written in more than one place that cannot import each other (the host's catalog, the client shell, the interface's list).
test('the lists of harness ids agree, and each agent has a name, a mark and a colour', () => {
  const shell = /const HARNESS = new Set\(\[([^\]]*)\]\)/.exec(readFileSync(new URL('../host/dudu-plugin/client.js', import.meta.url), 'utf8'));
  assert.ok(shell, 'client.js declares HARNESS');
  const inShell = [...shell[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...inShell].sort(), [...HARNESS_IDS].sort(), 'client.js and providers/catalog.mjs');
  // The same order too: it is the order the menus offer the agents in, on the computer and on the phones.
  assert.deepEqual(HARNESS_AGENTS, [...HARNESS_IDS], 'ui/issues/model.js and providers/catalog.mjs');
  for (const id of [...HARNESS_IDS, 'deepseek']) {
    assert.ok(AGENT_NAMES[id as keyof typeof AGENT_NAMES], `${id} has a name`);
    if (id !== 'deepseek') assert.equal(harnessName(id), AGENT_NAMES[id as keyof typeof AGENT_NAMES], `${id} is named the same in the host and in the interface`);
    assert.ok(Object.hasOwn(AGENT_LOGOS, id) && agentLogo(id), `${id} has a mark`);
    assert.match(AGENT_COLORS[id as keyof typeof AGENT_COLORS], /^#[0-9A-Fa-f]{6}$/, `${id} has a colour`);
  }
});
