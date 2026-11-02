import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHumanPrompt, listClaudeSessions, promptText } from '../host/providers/native/claude-store.mjs';
import { readClaudeHistory } from '../host/providers/native/claude-history.mjs';

// Claude Code's transcripts, written the way it writes them: one record per line, an assistant message as one record
// per content block, the results of tool calls in user records, titles appended as the conversation grows.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lines = (records: unknown[]) => records.map((record) => `${JSON.stringify(record)}\n`).join('');
let clock = Date.parse('2026-10-01T10:00:00.000Z');
const stamp = () => new Date((clock += 1000)).toISOString();
const user = (uuid: string, parentUuid: string | null, content: unknown, extra: Record<string, unknown> = {}) => ({
  parentUuid, isSidechain: false, type: 'user', message: { role: 'user', content }, uuid, timestamp: stamp(),
  entrypoint: 'cli', cwd: '/work/app', sessionId: 's', gitBranch: 'main', ...extra,
});
const assistant = (uuid: string, parentUuid: string, messageId: string, block: Record<string, unknown>) => ({
  parentUuid, isSidechain: false, type: 'assistant', uuid, timestamp: stamp(), cwd: '/work/app',
  message: { role: 'assistant', id: messageId, model: 'claude-sonnet-5-5', content: [block] },
});

async function folder(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'dudu-claude-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'project'));
  return root;
}

test('what the person typed is told apart from what Claude Code writes as the user', () => {
  assert.equal(promptText('fix the build'), 'fix the build');
  assert.equal(promptText([{ type: 'text', text: '  hello  ' }, { type: 'image' }]), 'hello');
  assert.equal(promptText('<system-reminder>Today is a Tuesday.</system-reminder>'), '');
  assert.equal(promptText('<local-command-stdout>ok</local-command-stdout>'), '');
  assert.equal(promptText('[Request interrupted by user]'), '');
  assert.equal(promptText('<command-name>/model</command-name><command-args>opus</command-args>'), '/model opus');
  assert.equal(isHumanPrompt({ type: 'user', message: { content: 'hi' } }), true);
  assert.equal(isHumanPrompt({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }), false);
  assert.equal(isHumanPrompt({ type: 'user', isMeta: true, message: { content: 'hi' } }), false);
  assert.equal(isHumanPrompt({ type: 'assistant', message: { content: 'hi' } }), false);
});

test('a session is named by its custom title, else its generated one, else the first thing said', async (t) => {
  const root = await folder(t);
  const write = (n: number, records: unknown[]) => writeFile(join(root, 'project', `${id(n)}.jsonl`), lines(records));
  await write(1, [user('a', null, 'first prompt one'), { type: 'ai-title', aiTitle: 'Generated one' }, { type: 'custom-title', customTitle: 'Mine' }]);
  await write(2, [user('a', null, 'first prompt two'), { type: 'ai-title', aiTitle: 'Generated two' }]);
  await write(3, [user('a', null, 'first prompt three')]);
  // A session opened with a command is better named by what was asked next.
  await write(4, [user('a', null, '<command-name>/clear</command-name>'), user('b', 'a', 'the real question')]);
  // Reminders are not the person's words; a file that is not a session is not listed; an empty one has nothing to show.
  await write(5, [user('a', null, '<system-reminder>x</system-reminder>'), user('b', 'a', 'after the reminder')]);
  await writeFile(join(root, 'project', 'notes.jsonl'), lines([user('a', null, 'not a session')]));
  await write(6, [{ type: 'mode', mode: 'normal' }]);
  const sessions = await listClaudeSessions({ root });
  const byId = Object.fromEntries(sessions.map((session) => [session.id, session]));
  assert.equal(sessions.length, 5);
  assert.equal(byId[id(1)].title, 'Mine');
  assert.equal(byId[id(2)].title, 'Generated two');
  assert.equal(byId[id(3)].title, 'first prompt three');
  assert.equal(byId[id(4)].title, 'the real question');
  assert.equal(byId[id(5)].title, 'after the reminder');
  assert.equal(byId[id(1)].preview, 'first prompt one');
  assert.deepEqual([byId[id(1)].provider, byId[id(1)].cwd, byId[id(1)].branch, byId[id(1)].entrypoint], ['claude', '/work/app', 'main', 'cli']);
  assert.equal(typeof byId[id(1)].updatedAt, 'number');
});

test('a long transcript is named from its end, where a title written later sits, without reading it all', async (t) => {
  const root = await folder(t);
  const filler = (n: number) => ({ type: 'api-request-blob', sessionId: 's', hash: String(n), message: { content: 'x'.repeat(90_000) } });
  const records: unknown[] = [user('a', null, 'opening prompt')];
  for (let i = 0; i < 40; i++) records.push(filler(i));
  records.push({ type: 'custom-title', customTitle: 'Renamed late' });
  await writeFile(join(root, 'project', `${id(1)}.jsonl`), lines(records));
  const [session] = await listClaudeSessions({ root });
  assert.equal(session.title, 'Renamed late');
  assert.equal(session.preview, 'opening prompt');
});

test('an unchanged transcript is not read again, a changed one is', async (t) => {
  const root = await folder(t);
  const file = join(root, 'project', `${id(1)}.jsonl`);
  await writeFile(file, lines([user('a', null, 'before')]));
  const cache = new Map();
  const [first] = await listClaudeSessions({ root, cache });
  const [again] = await listClaudeSessions({ root, cache });
  assert.equal(again, first, 'the same summary comes back while the file is the same');
  await writeFile(file, lines([user('a', null, 'before'), { type: 'ai-title', aiTitle: 'After' }]));
  await utimes(file, new Date(), new Date(Date.now() + 5000));
  const [changed] = await listClaudeSessions({ root, cache });
  assert.equal(changed.title, 'After');
  assert.deepEqual(await listClaudeSessions({ root: join(root, 'missing') }), []);
});

test('session activity comes from conversation records, independent of file touches and metadata writes', async (t) => {
  const root = await folder(t);
  const file = join(root, 'project', `${id(1)}.jsonl`);
  const prompt = user('u1', null, 'An old task');
  const answer = assistant('a1', 'u1', 'm1', { type: 'text', text: 'An old answer' });
  const at = Date.parse(answer.timestamp);
  await writeFile(file, lines([prompt, answer]));
  const cache = new Map();
  assert.equal((await listClaudeSessions({ root, cache }))[0].updatedAt, at);
  const touched = new Date('2026-11-02T02:00:00Z');
  await utimes(file, touched, touched);
  assert.equal((await listClaudeSessions({ root, cache }))[0].updatedAt, at);
  await appendFile(file, lines([
    { type: 'ai-title', aiTitle: 'Renamed task', timestamp: touched.toISOString() },
    { type: 'file-history-snapshot', timestamp: touched.toISOString() },
    { type: 'user', isMeta: true, timestamp: touched.toISOString(), message: { content: 'Injected context' } },
    { type: 'assistant', isSidechain: true, timestamp: touched.toISOString(), message: { content: 'Subagent metadata' } },
  ]));
  const [renamed] = await listClaudeSessions({ root, cache });
  assert.equal(renamed.updatedAt, at);
  assert.equal(renamed.title, 'Renamed task');
  const next = user('u2', 'a1', 'A new message');
  await appendFile(file, lines([next]));
  assert.equal((await listClaudeSessions({ root, cache }))[0].updatedAt, Date.parse(next.timestamp));
});

test('activity is found behind large trailing metadata and sessions sort by conversation time', async (t) => {
  const root = await folder(t);
  const old = join(root, 'project', `${id(1)}.jsonl`);
  const recent = join(root, 'project', `${id(2)}.jsonl`);
  const before = user('u1', null, 'Older task');
  const after = user('u2', null, 'Newer task');
  await writeFile(old, lines([before, { type: 'api-request', body: 'x'.repeat(2 * 1024 * 1024) }]));
  await writeFile(recent, lines([after]));
  await utimes(old, new Date(), new Date());
  await utimes(recent, new Date('2026-10-01'), new Date('2026-10-01'));
  const sessions = await listClaudeSessions({ root });
  assert.deepEqual(sessions.map((session) => session.id), [id(2), id(1)]);
  assert.equal(sessions[1].updatedAt, Date.parse(before.timestamp));
});

test('missing conversation timestamps remain unknown instead of taking the file time', async (t) => {
  const root = await folder(t);
  await writeFile(join(root, 'project', `${id(1)}.jsonl`), lines([
    { type: 'user', message: { content: 'Undated conversation' } },
    { type: 'ai-title', aiTitle: 'Undated task', timestamp: '2026-11-02T00:00:00Z' },
  ]));
  assert.equal((await listClaudeSessions({ root }))[0].updatedAt, 0);
});

async function transcript(t: { after: (cleanup: () => Promise<void>) => void }, records: unknown[]) {
  const root = await folder(t);
  const file = join(root, 'project', `${id(1)}.jsonl`);
  await writeFile(file, lines(records));
  return { file, id: id(1) };
}

test('a conversation is turns of steps: an assistant message is one step however many records it took', async (t) => {
  const source = await transcript(t, [
    user('u1', null, 'list the files'),
    { parentUuid: 'u1', type: 'attachment', uuid: 'att', attachment: { type: 'noise' } },
    assistant('a1', 'u1', 'm1', { type: 'thinking', thinking: '' }),
    assistant('a2', 'a1', 'm1', { type: 'text', text: 'Let me look.' }),
    assistant('a3', 'a2', 'm1', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }),
    user('r1', 'a3', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt\nb.txt' }], { toolUseResult: { stdout: 'a.txt\nb.txt' } }),
    assistant('a4', 'r1', 'm2', { type: 'text', text: 'Two files.' }),
    { type: 'ai-title', aiTitle: 'File listing' },
    user('u2', 'a4', 'thanks'),
    assistant('a5', 'u2', 'm3', { type: 'text', text: 'You are welcome.' }),
  ]);
  const history = await readClaudeHistory(source);
  assert.deepEqual([history.provider, history.id, history.cwd, history.branch, history.model, history.title], ['claude', source.id, '/work/app', 'main', 'claude-sonnet-5-5', 'File listing']);
  assert.equal(history.turns.length, 2);
  const [first, second] = history.turns;
  assert.equal(first.prompt, 'list the files');
  assert.equal(first.steps.length, 2, 'the call and the answer after it are two steps; the empty thinking block is not content');
  assert.deepEqual(first.steps[0].blocks.map((block: { type: string }) => block.type), ['text', 'tool-call']);
  assert.equal(first.steps[0].blocks[1].arguments, JSON.stringify({ command: 'ls' }));
  assert.deepEqual(first.steps[0].calls.map((call: { id: string }) => call.id), ['toolu_1']);
  assert.deepEqual(first.results.get('toolu_1'), { output: 'a.txt\nb.txt', isError: false });
  assert.deepEqual(first.steps[1].blocks, [{ type: 'text', text: 'Two files.' }]);
  assert.equal(second.prompt, 'thanks');
});

test('what Claude Code wrote itself, sidechains and a branch the person rewound from are not in the conversation', async (t) => {
  const source = await transcript(t, [
    user('u1', null, 'first question'),
    assistant('a1', 'u1', 'm1', { type: 'text', text: 'first answer' }),
    user('u2', 'a1', 'second question, later rewound'),
    assistant('a2', 'u2', 'm2', { type: 'text', text: 'answer on the abandoned branch' }),
    // The person went back to the first answer and asked something else.
    user('u2b', 'a1', 'second question, reworded'),
    assistant('a2b', 'u2b', 'm3', { type: 'text', text: 'answer on the kept branch' }),
    user('meta', 'a2b', '<system-reminder>injected</system-reminder>'),
    user('sum', 'a2b', 'This session is being continued...', { isCompactSummary: true }),
    { ...assistant('side', 'a2b', 'm4', { type: 'text', text: 'subagent chatter' }), isSidechain: true },
    user('u3', 'a2b', 'third question'),
    assistant('a3', 'u3', 'm5', { type: 'text', text: 'third answer' }),
  ]);
  const history = await readClaudeHistory(source);
  assert.deepEqual(history.turns.map((turn: { prompt: string }) => turn.prompt), ['first question', 'second question, reworded', 'third question']);
  const said = history.turns.flatMap((turn: { steps: { blocks: { text?: string }[] }[] }) => turn.steps.flatMap((step) => step.blocks.map((block) => block.text)));
  assert.deepEqual(said, ['first answer', 'answer on the kept branch', 'third answer']);
});

test('unanswered Claude input stays visible as an open turn', async (t) => {
  const source = await transcript(t, [
    user('u1', null, 'one'),
    assistant('a1', 'u1', 'm1', { type: 'text', text: 'done' }),
    user('u2', 'a1', 'two'),
    assistant('a2', 'u2', 'm2', { type: 'text', text: 'working' }),
    assistant('a3', 'a2', 'm2', { type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'sleep 600' } }),
    user('u3', 'a3', 'three, never answered'),
  ]);
  const history = await readClaudeHistory(source);
  assert.deepEqual(history.turns.map((turn: { prompt: string }) => turn.prompt), ['one', 'two', 'three, never answered']);
  assert.equal(history.turns[2].complete, false);
  assert.deepEqual(history.turns[2].steps, []);
});

test('the results of tool calls can be left out when only the words are wanted', async (t) => {
  const source = await transcript(t, [
    user('u1', null, 'read it'),
    assistant('a1', 'u1', 'm1', { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/x' } }),
    user('r1', 'a1', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x'.repeat(5000) }]),
    assistant('a2', 'r1', 'm2', { type: 'text', text: 'read' }),
  ]);
  const full = await readClaudeHistory(source);
  const light = await readClaudeHistory({ ...source, results: false });
  assert.equal(full.turns[0].results.get('toolu_1').output.length, 5000);
  assert.equal(light.turns[0].results.get('toolu_1').output, '');
});

test('a Claude tool loop is not imported as completed turns while it is still growing', async (t) => {
  const working = assistant('a2', 'u2', 'm2', { type: 'text', text: 'Working.' });
  Object.assign(working.message, { stop_reason: 'tool_use' });
  const source = await transcript(t, [
    user('u1', null, 'first'), assistant('a1', 'u1', 'm1', { type: 'text', text: 'Done.' }),
    user('u2', 'a1', 'next'), working,
  ]);
  const pending = await readClaudeHistory(source);
  assert.equal(pending.turns.length, 2);
  assert.equal(pending.turns[1].complete, false);
  const finished = assistant('a3', 'a2', 'm3', { type: 'text', text: 'Finished.' });
  Object.assign(finished.message, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20 } });
  await appendFile(source.file, lines([finished]));
  const history = await readClaudeHistory(source);
  assert.equal(history.turns.length, 2);
  assert.deepEqual(history.turns[1].steps[1].usage, { inputTokens: 10, outputTokens: 5, totalTokens: 35, cacheReadTokens: 20 });
});
