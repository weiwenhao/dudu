import assert from 'node:assert/strict';
import test from 'node:test';
import { createMirrorTool } from '../host/providers/mirror-tools.mjs';
import { CLAUDE_TOOLS } from '../host/providers/drivers/claude-tools.mjs';
import { CODEX_TOOLS } from '../host/providers/drivers/codex-tools.mjs';

test('mirror results store text once and present both compact and legacy tool records with their structured data', async () => {
  const output = '     7→actual file contents';
  const bridge = {
    driver: { name: 'Claude' },
    runOf: () => ({ waitTool: async () => ({ output, data: { exitCode: 3 } }) }),
  };
  const spec = CLAUDE_TOOLS.find((tool: any) => tool.name === 'Read');
  const read = createMirrorTool({ bridge, spec });
  const value = await read.execute({}, { agent: { id: 'one' } });
  const content = read.output.render({}, value);
  const meta = read.output.presentationMeta({}, value);
  assert.deepEqual(content, [{ type: 'text', text: output }]);
  assert.deepEqual(meta, { data: { exitCode: 3 } });
  const result = { content, meta, isError: false };
  assert.deepEqual(read.presentResult({ file_path: '/work/a.ts' }, result), {
    card: 'read', path: '/work/a.ts', offset: 7, lines: [{ number: 7, text: 'actual file contents' }], totalLines: 7,
  });
  assert.deepEqual(read.presentResult({ file_path: '/work/a.ts' }, { meta: { ...meta, output } }),
    read.presentResult({ file_path: '/work/a.ts' }, result), 'old metadata-only tool records remain readable');
  const shell = createMirrorTool({ bridge, spec: CODEX_TOOLS.find((tool: any) => tool.name === 'shell') });
  assert.deepEqual(shell.presentResult({}, { content, meta }), { card: 'terminal', output, exitCode: 3 });
  assert.equal(read.presentResult({}, { content, meta, isError: true }), undefined);
  assert.deepEqual(read.output.presentationMeta({}, { output }), {});
});
