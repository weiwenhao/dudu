// What the box of "add a custom connector" takes pasted text for (docs/assistant.md 3.1): a remote server, a local one, or a sentence; and that nothing is run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recognize } from '../host/assistant/connectors/recognize.mjs';

test('nothing written is nothing; prose and a command that is not one of the known ones are a sentence, never a server', async () => {
  assert.equal((await recognize('')).kind, null);
  assert.equal((await recognize('   \n ')).kind, null);
  for (const text of ['用 gws 命令行读我的 Gmail，我已经登录好了。', 'rm -rf /', 'gws gmail messages list', 'ftp://example.com/thing']) {
    const out = await recognize(text);
    assert.deepEqual([out.kind, out.count, out.entries.length], ['sentence', 0, 0], text);
  }
});

test('an address is a remote server named from its host; it is asked once what it needs, and not being able to tell is a token, not a refusal', async () => {
  const asked: string[] = [];
  const out = await recognize('https://mcp.linear.app/mcp', { probe: async (url: string) => { asked.push(url); return { auth: 'oauth' }; } });
  assert.deepEqual([out.kind, out.name, out.count, out.auth], ['remote', 'linear', 1, 'oauth']);
  assert.deepEqual(asked, ['https://mcp.linear.app/mcp']);
  assert.deepEqual(out.entries[0].spec, { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: {} });
  const none = await recognize('https://mcp.context7.com/mcp', { probe: async () => ({ auth: 'none' }) });
  assert.equal(none.auth, 'none');
  const down = await recognize('https://example.test/mcp', { probe: async () => { throw new Error('connect ECONNRESET'); } });
  assert.deepEqual([down.kind, down.auth, down.problem], ['remote', 'token', 'connect ECONNRESET']);
  assert.equal((await recognize('https://example.test/mcp')).auth, undefined, 'without a way to ask, nothing is said of it');
});

test('a launcher line, a claude mcp add line or an mcp.json is a local server; the package scope names `npx -y @drawio/mcp`; what is pasted is not run', async () => {
  const npx = await recognize('npx -y @drawio/mcp');
  assert.deepEqual([npx.kind, npx.name, npx.entries[0].spec], ['local', 'drawio', { transport: 'stdio', command: 'npx', args: ['-y', '@drawio/mcp'], env: {} }]);
  const add = await recognize('claude mcp add -e API_KEY=abc pencil -- npx -y some-server');
  assert.deepEqual([add.kind, add.name, add.env], ['local', 'pencil', ['API_KEY']]);
  const json = await recognize(JSON.stringify({ mcpServers: { a: { command: 'npx', args: ['x'] }, b: { url: 'https://b.test/mcp' } } }));
  assert.deepEqual([json.count, json.entries.map((e: any) => e.name), json.auth], [2, ['a', 'b'], undefined], 'several servers: no question is asked of any of them');
  const hosted = await recognize('claude mcp add --transport http notion https://mcp.notion.com/mcp');
  assert.deepEqual([hosted.kind, hosted.name], ['remote', 'notion']);
});

test('the path of a program that is there is a local server named from the app it sits in; one that is not there is a sentence', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-recognize-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const program = join(dir, 'Pencil.app', 'Contents', 'mcp-server');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, 'Pencil.app', 'Contents'), { recursive: true });
  writeFileSync(program, '#!/bin/sh\n');
  chmodSync(program, 0o755);
  const out = await recognize(`${program} --stdio`);
  assert.deepEqual([out.kind, out.name, out.entries[0].spec.command, out.entries[0].spec.args], ['local', 'pencil', program, ['--stdio']]);
  assert.equal((await recognize(`${dir}/nothing-here`)).kind, 'sentence');
});

test('an address that holds a secret is said to: it is kept whole elsewhere and only its host is shown', async () => {
  assert.equal((await recognize('https://example.test/mcp?key=abc123')).secretInUrl, true);
  assert.equal((await recognize('https://example.test/mcp')).secretInUrl, false);
});
