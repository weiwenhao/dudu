import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { antigravityConversationsRoot, antigravityStore, readAntigravityHistory } from '../host/providers/native/antigravity-store.mjs';
import { fieldsOf, messageOf, stringOf } from '../host/providers/native/protobuf.mjs';
import { nativeUpdates } from '../host/providers/native/sync.mjs';

// Antigravity keeps a conversation as a SQLite database with a table of steps, and a step as a protobuf message that has no published definition (antigravity-store.mjs says which fields
// are read). The steps here are built field by field from what was found in real conversations, with made-up words.

const varint = (value: number) => { const bytes: number[] = []; for (; value > 127; value = Math.floor(value / 128)) bytes.push((value % 128) | 128); bytes.push(value); return Buffer.from(bytes); };
const num = (field: number, value: number) => Buffer.concat([varint(field * 8), varint(value)]);
const bytes = (field: number, value: Buffer | string) => { const body = typeof value === 'string' ? Buffer.from(value) : value; return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]); };
const message = (...fields: Buffer[]) => Buffer.concat(fields);
let second = 1_790_000_000;
const stamp = () => bytes(1, message(num(1, second++), num(2, 500_000_000)));
const header = (type: number) => message(num(1, type), num(4, 3), bytes(5, message(stamp(), bytes(12, 'one-request-for-the-whole-turn'))));

const userStep = (text: string) => message(header(14), bytes(19, message(bytes(2, text), bytes(3, `\n${String.fromCharCode(text.length)}${text}`))));
const call = (id: string, name: string, args: unknown) => bytes(7, message(bytes(1, id), bytes(2, name), bytes(3, JSON.stringify(args))));
const answerStep = ({ reasoning = '', words = '', calls = [] as Buffer[] }) => message(header(15), bytes(20, message(...(words ? [bytes(1, words)] : []), ...(reasoning ? [bytes(3, reasoning)] : []), ...calls)));
const resultStep = (id: string, name: string, output: string) => message(
  num(1, 132), num(4, 3), bytes(5, message(stamp(), bytes(4, message(bytes(1, id), bytes(2, name), bytes(3, '{}'))))),
  bytes(140, message(bytes(2, message(bytes(1, `Created At: 2026-11-27T10:00:00+08:00\nCompleted At: 2026-11-27T10:00:01+08:00\n${output}`))))),
);
const bookkeeping = () => message(header(101), bytes(114, message(bytes(1, '[Message] from another agent'))));

const SCHEMA = 'create table steps (idx integer, step_type integer not null default 0, status integer not null default 0, has_subtrajectory numeric not null default false, metadata blob, error_details blob, permissions blob, task_details blob, render_info blob, step_payload blob, step_format integer not null default 0, primary key (idx))';
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** A gemini folder with one conversation in it: `steps` are [type, payload, status?, failed?]. */
async function conversation(t: { after: (cleanup: () => Promise<void>) => void }, steps: [number, Buffer, number?, boolean?][], id = ID) {
  const home = await mkdtemp(join(tmpdir(), 'dudu-agy-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const folder = join(home, 'antigravity-cli', 'conversations');
  await mkdir(folder, { recursive: true });
  const file = join(folder, `${id}.db`);
  const database = new DatabaseSync(file);
  database.exec('pragma journal_mode = wal');
  database.exec(SCHEMA);
  const insert = database.prepare('insert into steps (idx, step_type, status, error_details, step_payload) values (?, ?, ?, ?, ?)');
  steps.forEach(([type, payload, status = 3, failed = false], index) => insert.run(index, type, status, failed ? Buffer.from('boom') : null, payload));
  database.close();
  return { home, file };
}

test('the protobuf reader gives the fields of a message, and nothing at all for bytes that are not one', () => {
  const nested = message(num(1, 300), bytes(2, 'héllo'), bytes(3, message(bytes(1, 'inner'))));
  const fields = fieldsOf(nested);
  assert.deepEqual(fields.map((field: any) => [field.number, field.wire]), [[1, 0], [2, 2], [3, 2]]);
  assert.equal(fields[0].value, 300);
  assert.equal(stringOf(fields, 2), 'héllo');
  assert.equal(stringOf(messageOf(fields, 3), 1), 'inner');
  assert.deepEqual(fieldsOf(Buffer.from([0xff, 0xff, 0xff])), []);
  assert.deepEqual(fieldsOf(Buffer.from([0x0a, 0x05, 0x61])), [], 'a length that runs past the end');
  assert.equal(stringOf(fieldsOf(bytes(1, Buffer.from([0xff, 0xfe]))), 1), '', 'text that is not UTF-8');
});

test('the folder of the conversations is found as OAR starts agy, on every system', () => {
  const root = antigravityConversationsRoot;
  assert.equal(root({ HOME: '/Users/me' }, { platform: 'darwin' }), '/Users/me/.gemini/antigravity-cli/conversations');
  assert.equal(root({ HOME: '/Users/me', GEMINI_HOME: '/data/gemini' }, { platform: 'linux' }), '/data/gemini/antigravity-cli/conversations');
  assert.equal(root({ GEMINI_HOME: '' }, { platform: 'linux', home: '/home/fallback' }), '/home/fallback/.gemini/antigravity-cli/conversations');
  assert.equal(root({ USERPROFILE: 'C:\\Users\\me' }, { platform: 'win32' }), 'C:\\Users\\me\\.gemini\\antigravity-cli\\conversations');
  assert.equal(root({ USERPROFILE: 'C:\\Users\\me', gemini_home: 'D:\\gemini' }, { platform: 'win32' }), 'D:\\gemini\\antigravity-cli\\conversations', 'names ignore case on Windows');
  assert.equal(root({ HOME: '/c/Users/me', USERPROFILE: 'C:\\Users\\me' }, { platform: 'win32' }), 'C:\\Users\\me\\.gemini\\antigravity-cli\\conversations', 'and Windows has its own home variable');
});

test('a conversation is read as turns, with the calls named the way DSH names them and the output without the lines that say when it ran', async (t) => {
  const { file } = await conversation(t, [
    [14, userStep('list the files')],
    [15, answerStep({ reasoning: 'I should look.', words: 'Looking.', calls: [call('c1', 'search_web', { query: 'files' }), call('c2', 'run_command', { CommandLine: 'ls', toolSummary: 'List them' })] })],
    [132, resultStep('c1', 'search_web', 'found it')],
    [132, resultStep('c2', 'run_command', 'Command exited with code 1'), 7, true],
    [14, userStep('and the hidden ones')],
    [15, answerStep({ words: 'Done.' })],
    [101, bookkeeping()],
    [14, userStep('thanks')],
    [15, answerStep({ words: 'You are welcome.' })],
    [15, Buffer.from([0xff, 0xff, 0xff, 0xff])],
  ]);
  const history = readAntigravityHistory({ file, id: ID });
  assert.equal(history.provider, 'antigravity');
  assert.equal(history.title, 'list the files');
  assert.deepEqual(history.turns.map((turn: any) => turn.prompt), ['list the files', 'thanks']);
  const [first, second] = history.turns;
  assert.deepEqual(first.steps[0].blocks.map((block: any) => block.type), ['reasoning', 'text', 'tool-call', 'tool-call']);
  const calls = first.steps[0].blocks.filter((block: any) => block.type === 'tool-call');
  assert.deepEqual(calls.map((block: any) => [block.id, block.name]), [['c1', 'antigravity_search'], ['c2', 'antigravity_run_command']]);
  assert.equal(JSON.parse(calls[0].arguments).pattern, 'files');
  assert.equal(JSON.parse(calls[1].arguments).command, 'ls');
  assert.equal(JSON.parse(calls[1].arguments).description, 'List them');
  assert.deepEqual(first.results.get('c1'), { output: 'found it', isError: false });
  assert.deepEqual(first.results.get('c2'), { output: 'Command exited with code 1', isError: true });
  assert.equal(first.steps[1].input.prompt, 'and the hidden ones', 'typed while the model worked: it belongs to the step that followed');
  assert.deepEqual(first.steps[1].blocks, [{ type: 'text', text: 'Done.' }]);
  assert.equal(second.steps.length, 1, 'a step that cannot be read is not a step');
  assert.equal(first.complete, true);
});

test('a conversation is found by its id, its stamp counts what is still in the log file, and nothing else is opened', async (t) => {
  const { home, file } = await conversation(t, [[14, userStep('hi')], [15, answerStep({ words: 'hello' })]]);
  const env = { GEMINI_HOME: home };
  const found = await antigravityStore.summary(ID, { env });
  assert.equal(found?.file, file);
  assert.equal(found?.provider, 'antigravity');
  await writeFile(`${file}-wal`, Buffer.alloc(4096));
  const logged = await antigravityStore.summary(ID, { env });
  assert.equal((logged?.size ?? 0) - (found?.size ?? 0), 4096);
  assert.equal(await antigravityStore.summary('00000000-0000-4000-8000-000000000000', { env }), undefined);
  for (const bad of ['../../etc/passwd', '', 'a/b', '*']) assert.equal(await antigravityStore.summary(bad, { env }), undefined);
});

// The case this exists for (2026-11-27): the answer that DSH lost is in agy's store. DSH records each call of a step as a message of its own and what the model thought as it streamed, which is not
// the summary the store keeps, and a turn that DSH resumed has a paragraph break in front of its next answer: none of these may keep the synchronization from bringing the answer back.
test('the answer that DSH lost is brought back from agy\'s store, whatever DSH wrote of the model\'s thoughts', async (t) => {
  const { file } = await conversation(t, [
    [14, userStep('check the build')],
    [15, answerStep({ reasoning: 'A summary of the thought.', words: 'Checking.', calls: [call('c1', 'run_command', { CommandLine: 'make' })] })],
    [132, resultStep('c1', 'run_command', 'ok')],
    [15, answerStep({ words: 'The build passes.' })],
  ]);
  const history = readAntigravityHistory({ file, id: ID });
  const events: any[] = [];
  const push = (type: string, data: any, extra: any = {}) => events.push({ seq: events.length, time: 1000 + events.length, type, data, ...extra });
  const model = (content: any[]) => ({ role: 'assistant', content, source: { kind: 'model', provider: 'antigravity', model: 'm', replayState: { harness: 'antigravity', nativeSessionId: ID } } });
  push('turn/start', { turn: 1 });
  push('step/start', { turn: 1, step: 1 });
  push('user/message', { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'check the build' }] }, { surfaceOp: 'append' });
  push('assistant/message', { turn: 1, step: 1, message: model([{ type: 'reasoning', text: 'What streamed while it thought.' }, { type: 'text', text: '\n\nChecking.' }, { type: 'tool-call', id: 'c1', name: 'antigravity_run_command', arguments: '{}' }]) }, { surfaceOp: 'append' });
  push('turn/end', { turn: 1, reason: { kind: 'interrupted' } });
  const added = nativeUpdates({ events, history, route: 'antigravity', sessionId: 'dsh-1' });
  const texts = (list: any[]) => list.filter((event) => event.type === 'assistant/message').flatMap((event) => event.data.message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text));
  assert.deepEqual(texts(added), ['The build passes.']);
  assert.equal(added.some((event: any) => event.type === 'user/message'), false, 'what the person said is not said twice');
  assert.deepEqual(nativeUpdates({ events: [...events, ...added], history, route: 'antigravity', sessionId: 'dsh-1' }), [], 'and once it is back there is nothing more to add');
});
