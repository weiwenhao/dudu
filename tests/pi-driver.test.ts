import assert from 'node:assert/strict';
import { test } from 'node:test';
import { providerFamily, sessionProviders } from '../host/providers/catalog.mjs';
import { AGENTS, modelFor } from '../host/assistant/home/agent-sessions.mjs';
import { PiNormalizer, PI_MINIMUM_VERSION, createPiInstallation, piExecutableCandidates, piRuntimeFor, piSession, versionAtLeast } from '../host/providers/drivers/pi.mjs';
import { PI_TOOLS, fallbackSpec, mirrorName, readLines } from '../host/providers/drivers/pi-tools.mjs';

// Pi is a route and an agent like Claude and Codex: what each list says about it.
test('Pi is a harness route and an agent of an issue, named Pi', () => {
  assert.equal(providerFamily('pi'), 'pi');
  assert.deepEqual(Object.keys(AGENTS), ['claude', 'codex', 'pi', 'deepseek']);
  const catalog = { default: { provider: 'deepseek', model: 'flash' }, groups: [{ id: 'deepseek', models: [{ id: 'flash' }] }, { id: 'pi', models: [{ id: 'deepseek/deepseek-flash' }, { id: 'deepseek/deepseek-v4-pro' }] }] };
  assert.deepEqual(modelFor('pi', catalog), { provider: 'pi', model: 'deepseek/deepseek-flash' });
  assert.equal(modelFor('pi', { groups: [{ id: 'deepseek', models: [{ id: 'flash' }] }] }), null, 'a Pi that is switched off has no model, so the issue cannot be given to it');
  assert.deepEqual(modelFor('deepseek', catalog), { provider: 'deepseek', model: 'flash' }, 'the Pi models are never the conversation model');
  assert.deepEqual(sessionProviders(catalog).map((provider: any) => [provider.id, provider.name]), [['deepseek', 'DeepSeek'], ['pi', 'Pi']]);
});

// OAR starts Pi in its RPC mode from 1.4.0 and verified plain releases only: the settings page must say so before a session fails.
test('only a plain Pi release of 1.4.0 or newer is usable', () => {
  assert.equal(PI_MINIMUM_VERSION, '1.4.0');
  for (const version of ['1.4.0', '1.4.1', '1.5.2', '2.0.0', ' 1.10.0\n']) assert.equal(versionAtLeast(version), true, version);
  for (const version of ['1.3.9', '0.99.2', '1.4.0-beta.1', '1.4', 'pi', '', undefined]) assert.equal(versionAtLeast(version as any), false, String(version));
});

test('the probe reports an old Pi as unsupported and leaves the other answers as OAR gave them', async () => {
  const probe = (snapshot: any) => createPiInstallation({ probe: async () => snapshot });
  assert.deepEqual(await probe({ kind: 'available', via: 'executable', command: '/bin/pi', version: '1.4.0' })({}), { kind: 'available', via: 'executable', command: '/bin/pi', version: '1.4.0' });
  const old: any = await probe({ kind: 'available', via: 'executable', command: '/bin/pi', version: '1.3.0' })({});
  assert.equal(old.kind, 'unsupported');
  assert.match(old.reason, /1\.4\.0 or newer.*1\.3\.0/);
  assert.equal(((await probe({ kind: 'available', via: 'executable', command: '/bin/pi' })({})) as any).kind, 'unsupported', 'a version that cannot be read is not trusted');
  assert.deepEqual(await probe({ kind: 'not_found' })({}), { kind: 'not_found' });
});

test('Pi is looked for where npm, Homebrew, Bun, Volta, pnpm and every nvm Node put it', () => {
  const found = piExecutableCandidates('/Users/me', (folder: string) => (folder.endsWith('.nvm/versions/node') ? ['v20.1.0', 'v22.3.0'] : []));
  assert.ok(found.includes('/Users/me/.npm-global/bin/pi'));
  assert.ok(found.includes('/opt/homebrew/bin/pi') && found.includes('/Users/me/.bun/bin/pi') && found.includes('/Users/me/.volta/bin/pi'));
  assert.ok(found.indexOf('/Users/me/.nvm/versions/node/v22.3.0/bin/pi') < found.indexOf('/Users/me/.nvm/versions/node/v20.1.0/bin/pi'), 'the newest Node first');
});

// OAR's Pi runtime refuses any installation that is not its bundled SDK, whatever executable it is told to launch.
test('the Pi runtime is opened on first use, launches the executable that was found and is handed OAR\'s own installation', async () => {
  const calls: any[] = [];
  let created = 0;
  const load = async () => ({ createPiRuntime: (options: any) => { created += 1; calls.push(['create', options]); return {
    listModels: async (installation: any, options: any) => { calls.push(['listModels', installation, options.cwd]); return { kind: 'ok', models: [] }; },
    session: async (installation: any, options: any) => { calls.push(['session', installation, options.cwd]); return { id: 's1' }; },
  }; } });
  const runtime = piRuntimeFor({ kind: 'available', via: 'executable', command: '/Users/me/.npm-global/bin/pi' } as any, load as any);
  assert.equal(created, 0, 'nothing is loaded for a Pi that is only found');
  await runtime.listModels({ kind: 'available', via: 'executable' } as any, { cwd: '/w' } as any);
  await runtime.session({ kind: 'available', via: 'executable' } as any, { cwd: '/w' } as any);
  assert.equal(created, 1);
  assert.deepEqual(calls[0], ['create', { execution: 'subprocess', command: '/Users/me/.npm-global/bin/pi' }]);
  assert.deepEqual(calls[1].slice(0, 2), ['listModels', { kind: 'available', via: 'bundled' }]);
  assert.deepEqual(calls[2].slice(0, 2), ['session', { kind: 'available', via: 'bundled' }]);
});

test('a read-only Pi session has no tool that writes; other modes change nothing', () => {
  assert.deepEqual(piSession({ permission: 'read-only' }), { disallowedTools: ['bash', 'edit', 'write'] });
  assert.deepEqual(piSession({ permission: 'danger-full-access' }), {});
  assert.deepEqual(piSession({ permission: 'workspace-write' }), {});
});

// DSH's own tools are called bash, read, write, edit, grep and glob; a mirror tool with one of those names would collide with them.
test('Pi\'s tools are mirrored under names of their own and drawn with the cards DSH has', () => {
  for (const tool of PI_TOOLS) assert.match(tool.name, /^pi_[a-z]+$/);
  assert.equal(mirrorName('bash'), 'pi_bash');
  assert.equal(mirrorName('mcp server/tool'), 'pi_mcp_server_tool');
  const by = (name: string) => (PI_TOOLS as any[]).find((tool) => tool.name === name);
  assert.deepEqual(by('pi_bash').presentCall({ command: 'ls -la' }), { card: 'terminal', title: 'ls -la' });
  assert.deepEqual(by('pi_bash').presentResult({}, { output: 'x', data: { exitCode: 3 } }), { card: 'terminal', output: 'x', exitCode: 3 });
  const edit = by('pi_edit').presentCall({ path: 'a.txt', edits: [{ oldText: 'beta', newText: 'gamma' }] });
  assert.deepEqual(edit.diffs, [{ path: 'a.txt', oldText: 'beta', newText: 'gamma' }]);
  assert.deepEqual(by('pi_write').presentCall({ path: 'n.txt', content: 'hi' }).diffs, [{ path: 'n.txt', oldText: null, newText: 'hi' }]);
  assert.equal(fallbackSpec('pi_subagent').name, 'pi_subagent');
  assert.equal(fallbackSpec('pi_subagent').presentCall({ name: 'scout' }).title, 'subagent: scout', 'the card names the tool as Pi does');
});

test('a Pi read shows the lines with their numbers and not the note about the rest of the file', () => {
  assert.deepEqual(readLines('line 5\nline 6\nline 7\n\n[24 more lines in file. Use offset=8 to continue.]', 5), { lines: [{ number: 5, text: 'line 5' }, { number: 6, text: 'line 6' }, { number: 7, text: 'line 7' }], rest: 24 });
  assert.deepEqual(readLines('alpha\nbeta\n', undefined), { lines: [{ number: 1, text: 'alpha' }, { number: 2, text: 'beta' }], rest: 0 });
  assert.deepEqual(readLines('', 1), { lines: [], rest: 0 });
  const read = (PI_TOOLS as any[]).find((tool) => tool.name === 'pi_read');
  const card = read.presentResult({ path: 'big.txt', offset: 5 }, { output: 'a\nb\n\n[10 more lines in file. Use offset=7 to continue.]', isError: false });
  assert.deepEqual([card.offset, card.totalLines], [5, 16]);
  assert.equal(read.presentResult({ path: 'x' }, { output: 'ENOENT', isError: true }), undefined);
});

// What OAR records of one Pi turn (checked against the real `pi` 1.4.0): usage rides each assistant message and is cumulative, a tool is
// announced with its complete input after the message that asked for it, text comes last.
test('one Pi turn becomes steps of a call each, with the usage of each message counted once', () => {
  const frame = (...events: any[]) => ({ kind: 'frame', agentPath: [], body: { events } });
  const tokens = (input: number, output: number) => ({ kind: 'usage', usage: { tokens: { input, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 } } });
  const normalizer = new PiNormalizer({ name: 'Pi', login: 'login' } as any);
  const out = [
    frame(tokens(20, 5)),
    frame({ kind: 'tool_call_started', callId: 'c1', tool: 'bash', input: '{"command":"ls"}' }),
    frame({ kind: 'tool_call_ended', callId: 'c1', content: [{ type: 'text', text: 'a\n' }], result: 'ok', exitCode: 0 }),
    frame(tokens(40, 10)),
    frame({ kind: 'text_delta', text: 'done' }),
    frame(tokens(60, 15), { kind: 'turn_ended', outcome: { kind: 'completed' } }),
  ].flatMap((record) => normalizer.feed(record as any));
  assert.deepEqual(out.map((event: any) => event.type), ['usage', 'tool-call', 'step-end', 'tool-result', 'usage', 'text-delta', 'usage', 'step-end', 'turn-end']);
  assert.deepEqual(out[1], { type: 'tool-call', id: 'c1', name: 'pi_bash', input: { command: 'ls' } });
  assert.deepEqual(out[3], { type: 'tool-result', id: 'c1', output: 'a\n', isError: false, data: { exitCode: 0 } });
  assert.deepEqual(out.filter((event: any) => event.type === 'usage').map((event: any) => [event.usage.inputTokens, event.usage.outputTokens]), [[20, 5], [20, 5], [20, 5]]);
  assert.equal(out.at(-1)?.ok, true);
});

// The menus of New issue, of an issue and of its right-click: what they offer follows Settings > Providers.
test('the agent menus offer a harness only while it is found and switched on', async () => {
  const { agentIds } = await import('../host/dudu-plugin/ui/issues/model.js');
  const state = (pi: Partial<{ enabled: boolean; state: string }>) => [{ id: 'claude', enabled: true, state: 'ready' }, { id: 'codex', enabled: true, state: 'missing' }, { id: 'pi', enabled: true, state: 'ready', ...pi }];
  assert.deepEqual(agentIds(state({})), ['claude', 'pi', 'deepseek'], 'a harness that was not found is not offered');
  assert.deepEqual(agentIds(state({ enabled: false })), ['claude', 'deepseek'], 'nor one that is switched off');
  assert.deepEqual(agentIds(state({ state: 'unsupported' })), ['claude', 'deepseek']);
  assert.deepEqual(agentIds(state({ enabled: false }), 'pi'), ['claude', 'pi', 'deepseek'], 'the agent an issue has stays in the list');
  assert.deepEqual(agentIds(null), ['claude', 'codex', 'pi', 'deepseek'], 'until the providers are read, or when they cannot be, all are offered');
});

test('a Pi session is found again by its harness id and resumes in a terminal with pi --session', async () => {
  const { nativeIdentity, sessionInfo } = await import('../host/providers/native/session-info.mjs');
  assert.deepEqual(await sessionInfo({ key: 'pi:0193abc-1' } as any), { sessionId: '0193abc-1', provider: 'pi', command: 'pi --session 0193abc-1' });
  const assistant = (harness: string) => ({ type: 'assistant/message', data: { message: { source: { provider: harness, replayState: { harness, nativeSessionId: 'n-1' } } } } });
  assert.deepEqual(nativeIdentity([assistant('pi')] as any), { provider: 'pi', id: 'n-1' });
  assert.equal(nativeIdentity([assistant('other')] as any), null);
});
