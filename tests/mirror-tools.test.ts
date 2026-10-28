import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorTool } from '../host/providers/mirror-tools.mjs';

function fakeRun() {
  return {
    async waitTool() { return this.outcome; },
    outcome: { type: 'tool-result', id: 'c1', output: 'done', isError: false } as any,
  };
}

function setup(run: any) {
  const bridge = { driver: { name: 'Fake Harness' }, runOf: (id: string) => (id === 's1' ? run : undefined) };
  const spec = {
    name: 'Bash',
    presentCall: (args: any) => ({ card: 'terminal', title: args.command }),
    presentResult: (_args: any, outcome: any) => ({ card: 'terminal', output: outcome.output, exitCode: outcome.data?.exitCode }),
  };
  return createMirrorTool({ bridge, spec }) as any;
}

const exec = (extra: any = {}) => ({ agent: { id: 's1' }, callId: 'c1', signal: new AbortController().signal, ...extra });

test('a mirror tool returns what the harness reported, with structured data kept for its card', async () => {
  const run = fakeRun();
  run.outcome = { output: 'a.txt', isError: false, data: { exitCode: 0 } };
  const tool = setup(run);
  const value = await tool.execute({ command: 'ls' }, exec());
  assert.deepEqual(value, { output: 'a.txt', data: '{"exitCode":0}' });
  assert.deepEqual(tool.output.presentationMeta({}, value), { output: 'a.txt', data: { exitCode: 0 } });
  assert.deepEqual(tool.output.render({}, value), [{ type: 'text', text: 'a.txt' }]);
  assert.deepEqual(tool.presentCall({ command: 'ls' }), { card: 'terminal', title: 'ls' });
  assert.deepEqual(tool.presentResult({}, { isError: false, meta: { output: 'a.txt', data: { exitCode: 0 } } }), { card: 'terminal', output: 'a.txt', exitCode: 0 });
});

test('a failed harness tool fails the DSH tool call with the harness message', async () => {
  const run = fakeRun();
  run.outcome = { output: 'File not found', isError: true };
  await assert.rejects(setup(run).execute({}, exec()), /File not found/);
});

test('a mirror tool outside a running harness turn fails clearly', async () => {
  await assert.rejects(setup(fakeRun()).execute({}, exec({ agent: { id: 'other' } })), /not running this turn/);
});
