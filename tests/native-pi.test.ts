import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piSessionsRoot, piStore, readPiHistory } from '../host/providers/native/pi-store.mjs';
import { nativeUpdates } from '../host/providers/native/sync.mjs';

// Pi's session files (format 3), written the way Pi writes them: a header, then one entry per line, each pointing at the entry before it (`parentId`). A message is an entry
// whose `message` has a role: `user`, `assistant` (with `stopReason`) or `toolResult`.

const SESSION = '01a1e899-2fc3-73a4-a96f-6ffb55cd4a3a';
const lines = (records: unknown[]) => records.map((record) => `${JSON.stringify(record)}\n`).join('');
let tick = 0;
const time = () => new Date(Date.parse('2026-11-01T10:00:00.000Z') + (tick += 1000)).toISOString();

/** Entries chained one after the other, as a session that was not branched is. */
function chain(entries: any[]) {
  let parent: string | null = null;
  return entries.map((entry, index) => {
    const id = `e${String(index).padStart(3, '0')}`;
    const record = { id, parentId: parent, timestamp: time(), ...entry };
    parent = id;
    return record;
  });
}
const header = { type: 'session', version: 3, id: SESSION, timestamp: '2026-11-01T10:00:00.000Z', cwd: '/work/app' };
const say = (text: string) => ({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } });
const reply = (content: any[], stopReason: string) => ({ type: 'message', message: { role: 'assistant', content, stopReason, model: 'deepseek-flash', provider: 'deepseek' } });
const call = (id: string, name: string, args: any = {}) => ({ type: 'toolCall', id, name, arguments: args });
const result = (toolCallId: string, text: string, isError = false) => ({ type: 'message', message: { role: 'toolResult', toolCallId, toolName: 'bash', content: [{ type: 'text', text }], isError } });

/** Pi's home (the folder that holds `sessions`, which `PI_CODING_AGENT_DIR` names) with one session in it: `records`, or the text of the file as it is. */
async function store(t: { after: (cleanup: () => Promise<void>) => void }, records: unknown[] | string, id = SESSION) {
  const home = await mkdtemp(join(tmpdir(), 'dudu-pi-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const folder = join(home, 'sessions', '--work-app--');
  await mkdir(folder, { recursive: true });
  const file = join(folder, `2026-11-01T10-00-00-000Z_${id}.jsonl`);
  await writeFile(file, typeof records === 'string' ? records : lines(records));
  return { home, file };
}

test('a Pi session is read as turns, with the calls named the way DSH names them and what the person typed meanwhile at the step that took it up', async (t) => {
  const { file } = await store(t, [header, ...chain([
    { type: 'model_change', provider: 'deepseek', modelId: 'deepseek-flash' },
    { type: 'thinking_level_change', thinkingLevel: 'off' },
    { type: 'message', message: { role: 'system', content: '' } },
    say('list the files'),
    reply([{ type: 'thinking', thinking: 'I should look.' }, { type: 'text', text: 'Looking.' }, call('c1', 'bash', { command: 'ls' }), call('c2', 'read', { path: 'a.txt' })], 'toolUse'),
    result('c1', 'a.txt'),
    result('c2', 'hello', true),
    say('and the hidden ones'),
    reply([{ type: 'text', text: 'Both done.' }], 'stop'),
    { type: 'compaction', summary: 'earlier', firstKeptEntryId: 'e004' },
    say('thanks'),
    reply([{ type: 'text', text: 'You are welcome.' }], 'stop'),
  ])]);
  const history = await readPiHistory({ file, id: SESSION });
  assert.equal(history.provider, 'pi');
  assert.equal(history.cwd, '/work/app');
  assert.equal(history.model, 'deepseek-flash');
  assert.equal(history.title, 'list the files');
  assert.deepEqual(history.turns.map((turn: any) => turn.prompt), ['list the files', 'thanks']);
  const [first, second] = history.turns;
  assert.equal(first.steps.length, 2);
  assert.deepEqual(first.steps[0].blocks.map((block: any) => block.type), ['reasoning', 'text', 'tool-call', 'tool-call']);
  assert.deepEqual(first.steps[0].blocks.filter((block: any) => block.type === 'tool-call').map((block: any) => [block.id, block.name, block.arguments]), [['c1', 'pi_bash', '{"command":"ls"}'], ['c2', 'pi_read', '{"path":"a.txt"}']]);
  assert.deepEqual(first.results.get('c1'), { output: 'a.txt', isError: false });
  assert.deepEqual(first.results.get('c2'), { output: 'hello', isError: true });
  assert.equal(first.steps[1].input.prompt, 'and the hidden ones', 'typed while Pi worked: it belongs to the step that followed');
  assert.deepEqual(first.steps[1].blocks, [{ type: 'text', text: 'Both done.' }]);
  assert.equal(first.complete, true);
  assert.equal(second.steps.length, 1);
});

test('only the branch that ends at the last entry is read, and what cannot be read is skipped', async (t) => {
  const entries = chain([
    say('first'), reply([{ type: 'text', text: 'one' }], 'stop'),
    say('abandoned'), reply([{ type: 'text', text: 'abandoned answer' }], 'stop'),
  ]);
  // The person went back to the first answer and asked something else: the new entry points at it, so the other two are another branch.
  const branch = { id: 'b1', parentId: entries[1].id, timestamp: time(), ...say('the other question') };
  const answer = { id: 'b2', parentId: 'b1', timestamp: time(), ...reply([{ type: 'text', text: 'the other answer' }], 'stop') };
  const edit = { type: 'context_edit', id: 'b3', parentId: 'b1', targetId: 'e000', replacement: 'x' };
  // A line that is not JSON is simply a line.
  const { file } = await store(t, `${lines([header, ...entries, branch])}this is not json\n${lines([edit, answer])}`);
  const history = await readPiHistory({ file, id: SESSION });
  assert.deepEqual(history.turns.map((turn: any) => turn.prompt), ['first', 'the other question']);
  assert.deepEqual(history.turns.map((turn: any) => turn.steps[0].blocks[0].text), ['one', 'the other answer']);
});

test('a message after calls that were never answered is a new turn, and a turn that Pi stopped or failed is over', async (t) => {
  const { file } = await store(t, [header, ...chain([
    say('start'), reply([call('c1', 'bash', { command: 'sleep 9' })], 'toolUse'),
    say('never mind, do this instead'), reply([{ type: 'text', text: 'Stopped.' }], 'aborted'),
    say('and this'), reply([], 'error'),
    say('last one'), reply([call('c9', 'bash')], 'toolUse'),
  ])]);
  const history = await readPiHistory({ file, id: SESSION });
  assert.deepEqual(history.turns.map((turn: any) => turn.prompt), ['start', 'never mind, do this instead', 'and this', 'last one']);
  assert.deepEqual(history.turns.map((turn: any) => turn.complete), [true, true, true, false], 'the turn that waits for a tool result is still open');
});

test('pictures a person sent are counted, and kept as parts only when they are asked for', async (t) => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  const { file } = await store(t, [header, ...chain([
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image', data: png, mimeType: 'image/png' }] } },
    reply([{ type: 'text', text: 'A picture.' }], 'stop'),
  ])]);
  const plain = await readPiHistory({ file, id: SESSION });
  assert.equal(plain.turns[0].pictures, 1);
  assert.equal(plain.turns[0].parts, undefined);
  const full = await readPiHistory({ file, id: SESSION, images: true });
  assert.deepEqual(full.turns[0].parts.map((part: any) => part.type), ['text', 'image']);
});

test('the folder of the sessions is the one OAR starts Pi with, on every system', () => {
  const root = piSessionsRoot;
  assert.equal(root({ HOME: '/Users/me' }, { platform: 'darwin' }), '/Users/me/.pi/agent/sessions');
  assert.equal(root({ HOME: '/Users/me', PI_CODING_AGENT_DIR: '/data/pi' }, { platform: 'linux' }), '/data/pi/sessions');
  assert.equal(root({ PI_CODING_AGENT_DIR: '/data/pi', OAR_PI_AGENT_DIR: '/pinned' }, { platform: 'linux' }), '/pinned/sessions', 'the folder OAR pins comes first');
  assert.equal(root({ PI_CODING_AGENT_DIR: '' }, { platform: 'linux', home: '/home/fallback' }), '/home/fallback/.pi/agent/sessions', 'empty is unset');
  assert.equal(root({ USERPROFILE: 'C:\\Users\\me' }, { platform: 'win32' }), 'C:\\Users\\me\\.pi\\agent\\sessions');
  assert.equal(root({ USERPROFILE: 'C:\\Users\\me', pi_coding_agent_dir: 'D:\\pi' }, { platform: 'win32' }), 'D:\\pi\\sessions', 'names ignore case on Windows');
});

test('a session is found by its id in whichever folder Pi put it, and nothing else is opened', async (t) => {
  const { home, file } = await store(t, [header, ...chain([say('hi'), reply([{ type: 'text', text: 'hello' }], 'stop')])]);
  const env = { PI_CODING_AGENT_DIR: home };
  const found = await piStore.summary(SESSION, { env });
  assert.equal(found?.file, file);
  assert.equal(found?.cwd, '/work/app');
  assert.equal(found?.provider, 'pi');
  assert.equal(await piStore.summary('01a1e899-0000-0000-0000-000000000000', { env }), undefined);
  for (const bad of ['../../etc/passwd', '', 'a/b', '*']) assert.equal(await piStore.summary(bad, { env }), undefined);
});

// The case this exists for (2026-11-27): a DSH session on a harness lost the end of a turn, and the harness's own store still has it. DSH's loop records each tool call of a Pi message as a
// message of its own, so the two sides do not group the blocks alike; the synchronization has to bring back only what DSH lacks.
test('the answer that DSH lost is brought back from Pi\'s store, once', async (t) => {
  const { file } = await store(t, [header, ...chain([
    say('check the build'),
    reply([{ type: 'text', text: 'Checking.' }, call('c1', 'bash', { command: 'make' }), call('c2', 'bash', { command: 'make test' })], 'toolUse'),
    result('c1', 'ok'), result('c2', 'ok'),
    reply([{ type: 'text', text: 'The build passes.' }], 'stop'),
  ])]);
  const history = await readPiHistory({ file, id: SESSION });
  const events: any[] = [];
  const push = (type: string, data: any, extra: any = {}) => events.push({ seq: events.length, time: 1000 + events.length, type, data, ...extra });
  const model = (content: any[]) => ({ role: 'assistant', content, source: { kind: 'model', provider: 'pi', model: 'deepseek-flash', replayState: { harness: 'pi', nativeSessionId: SESSION } } });
  push('turn/start', { turn: 1 });
  push('step/start', { turn: 1, step: 1 });
  push('user/message', { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'check the build' }] }, { surfaceOp: 'append' });
  push('user/message', { id: 't1', role: 'user', source: { kind: 'time-context' }, content: [{ type: 'text', text: 'Time sampled while preparing turn 1.' }] }, { surfaceOp: 'append' });
  push('assistant/message', { turn: 1, step: 1, message: model([{ type: 'text', text: 'Checking.' }, call('c1', 'pi_bash')]) }, { surfaceOp: 'append' });
  push('step/start', { turn: 1, step: 2 });
  push('assistant/message', { turn: 1, step: 2, message: model([call('c2', 'pi_bash')]) }, { surfaceOp: 'append' });
  // DSH was cut off here: its turn is closed as an interrupted one and the last answer was never written.
  push('turn/end', { turn: 1, reason: { kind: 'interrupted' } });
  const added = nativeUpdates({ events, history, route: 'pi', sessionId: 'dsh-1' });
  const texts = (list: any[]) => list.filter((event) => event.type === 'assistant/message').flatMap((event) => event.data.message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text));
  assert.deepEqual(texts(added), ['The build passes.']);
  assert.equal(added.some((event: any) => event.type === 'user/message'), false, 'what the person said is not said twice');
  assert.deepEqual(nativeUpdates({ events: [...events, ...added], history, route: 'pi', sessionId: 'dsh-1' }), [], 'and once it is back there is nothing more to add');
});
