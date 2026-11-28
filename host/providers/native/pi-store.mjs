import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { join } from 'node:path';
import { createInterface } from 'node:readline';
import { turnsOf } from './claude-history.mjs';
import { environmentValue } from './environment.mjs';
import { settled } from './history.mjs';
import { imageFromBase64, SESSION_IMAGE_BUDGET } from './images.mjs';
import { clip, oneLine } from './text.mjs';
import { mirrorName } from '../drivers/pi-tools.mjs';

// The conversations Pi keeps for itself (`~/.pi/agent/sessions/<folder>/<time>_<id>.jsonl`, format 3), read so that a DSH session that runs on Pi can be brought up to date with
// what its own store says (see sync.mjs). Pi cannot be asked for its sessions through OAR, so the file is read here. A file is a tree of entries (`id`, `parentId`); what the
// person sees is the branch that ends at the last entry, and only that branch is read.

const TEXT_LIMIT = 256 * 1024;

const parse = (line) => { try { return JSON.parse(line); } catch { return undefined; } };
const blocksOf = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []);

/**
 * The folder the Pi sessions of DSH are in: `<agent folder>/sessions`, with one folder per working directory inside it, whose names are not rebuilt here (on Windows they hold the drive and
 * the backslashes of the path as `-`, and a session is found by its id in all of them). The agent folder is the one OAR starts Pi with, which also passes `--session-dir`, so that what the person
 * set in Pi's own settings does not move the sessions: `OAR_PI_AGENT_DIR`, else `PI_CODING_AGENT_DIR`, else `.pi/agent` in the home folder (`HOME`, else `USERPROFILE`).
 */
export function piSessionsRoot(env = process.env, { platform = process.platform, home = homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const named = environmentValue(env, 'OAR_PI_AGENT_DIR', platform) ?? environmentValue(env, 'PI_CODING_AGENT_DIR', platform);
  const base = environmentValue(env, 'HOME', platform) ?? environmentValue(env, 'USERPROFILE', platform) ?? home;
  return paths.join(paths.resolve(named ?? paths.join(base, '.pi', 'agent')), 'sessions');
}

const found = new Map(); // `${root}\n${id}` -> its file, so that a session that was found is not looked for in every folder again

/** The file of the Pi session `id`, or undefined when this computer does not have it. */
async function fileOf(id, root) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return undefined;
  const key = `${root}\n${id}`;
  const known = found.get(key);
  if (known) {
    try { if ((await stat(known)).isFile()) return known; } catch { found.delete(key); }
  }
  let folders;
  try { folders = await readdir(root); } catch { return undefined; }
  for (const folder of folders) {
    let names;
    try { names = await readdir(join(root, folder)); } catch { continue; }
    const name = names.find((candidate) => candidate.endsWith(`_${id}.jsonl`));
    if (name) { found.set(key, join(root, folder, name)); return found.get(key); }
  }
  return undefined;
}

async function firstLine(file) {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try { for await (const line of lines) return parse(line); } finally { lines.close(); }
  return undefined;
}

/** What the plugin knows of a Pi session without reading all of it: where it is, how big it is, the folder it ran in. */
async function summaryOf(id, { env } = {}) {
  const file = await fileOf(id, piSessionsRoot(env));
  if (!file) return undefined;
  const [info, header] = await Promise.all([stat(file), firstLine(file)]);
  if (header?.type !== 'session') return undefined;
  const createdAt = Date.parse(header.timestamp);
  return {
    provider: 'pi', id, title: '', cwd: typeof header.cwd === 'string' ? header.cwd : undefined, file,
    size: info.size, mtimeMs: info.mtimeMs, updatedAt: Math.trunc(info.mtimeMs), ...(Number.isNaN(createdAt) ? {} : { createdAt }),
  };
}

// What a tool answered, as text: its words, and a marker where it sent a picture.
const resultText = (content) => clip(blocksOf(content).map((block) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : block?.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n'), TEXT_LIMIT);

function boundedInput(input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return JSON.stringify(value).length <= TEXT_LIMIT ? value : { _truncated: clip(JSON.stringify(value), 2000) };
}

/** The parts of an assistant message that a conversation shows, in the shape `turnsOf` reads (a tool call is `tool_use`, named the way DSH's own Pi sessions name it). */
function assistantBlocks(content) {
  const blocks = [];
  for (const block of blocksOf(content)) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text) blocks.push({ type: 'text', text: clip(block.text, TEXT_LIMIT) });
    else if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) blocks.push({ type: 'reasoning', text: clip(block.thinking, TEXT_LIMIT) });
    else if (block?.type === 'toolCall' && typeof block.id === 'string') blocks.push({ type: 'tool_use', id: block.id, name: mirrorName(block.name ?? 'unknown'), input: boundedInput(block.arguments) });
  }
  return blocks;
}

/** The words of a message the person sent, and the pictures in it (as parts, with their bytes, when `images` asks for them). */
function promptOf(content, { images, budget }) {
  const blocks = blocksOf(content);
  const prompt = blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').trim();
  const pictures = blocks.filter((block) => block?.type === 'image');
  const parts = !images || !pictures.length ? undefined : [
    ...(prompt ? [{ type: 'text', text: prompt }] : []),
    ...pictures.map((picture) => imageFromBase64(picture.data, picture.mimeType, budget)),
  ];
  return { prompt, ...(pictures.length ? { pictures: pictures.length } : {}), ...(parts ? { parts } : {}) };
}

/** The entries from the root to the last one: the branch the person is on (a rewind or a branch leaves the other entries in the file). */
function activeBranch(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch = [];
  for (let entry = entries.at(-1), guard = 0; entry && guard <= entries.length; entry = byId.get(entry.parentId), guard++) branch.push(entry);
  return branch.reverse();
}

/**
 * Read a Pi session as a conversation (history.mjs). A turn begins with what the person typed; what they typed while Pi was working (Pi hands it over once the tool calls of
 * the step are answered) belongs to the step that follows. `images: true` also keeps the pictures they sent.
 */
export async function readPiHistory({ file, id, images = false }) {
  const entries = [];
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header;
  for await (const line of lines) {
    if (!line) continue;
    const entry = parse(line);
    if (!entry || typeof entry.type !== 'string') continue;
    if (entry.type === 'session') header = entry;
    else if (typeof entry.id === 'string') entries.push(entry);
  }
  const budget = { left: SESSION_IMAGE_BUDGET };
  const created = Date.parse(header?.timestamp);
  const at = (entry) => { const time = Date.parse(entry.timestamp); return Number.isNaN(time) ? (Number.isNaN(created) ? Date.now() : created) : time; };
  const kept = [];
  let model = null;
  let waiting = new Set(); // the calls of the last assistant message that have no answer yet
  let working = false;     // the last assistant message ended in tool calls: Pi is in the middle of an answer
  for (const entry of activeBranch(entries)) {
    if (entry.type === 'model_change' && typeof entry.modelId === 'string') { model = entry.modelId; continue; }
    if (entry.type !== 'message' || !entry.message) continue;
    const message = entry.message;
    if (message.role === 'user') {
      const { prompt, pictures, parts } = promptOf(message.content, { images, budget });
      if (!prompt && !pictures) continue;
      const record = { uuid: entry.id, at: at(entry), prompt, ...(pictures ? { pictures } : {}), ...(parts ? { parts } : {}) };
      if (working && waiting.size === 0) kept.push({ ...record, type: 'input' });
      else { kept.push({ ...record, type: 'user', blocks: [] }); working = false; }
    } else if (message.role === 'assistant') {
      const blocks = assistantBlocks(message.content);
      waiting = new Set(blocks.filter((block) => block.type === 'tool_use').map((block) => block.id));
      working = message.stopReason === 'toolUse';
      if (typeof message.model === 'string') model = message.model;
      kept.push({
        uuid: entry.id, type: 'assistant', at: at(entry), messageId: entry.id, model: typeof message.model === 'string' ? message.model : undefined,
        stopReason: message.stopReason === 'toolUse' ? 'tool_use' : (message.stopReason ?? 'end_turn'), blocks,
      });
    } else if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
      waiting.delete(message.toolCallId);
      kept.push({ uuid: entry.id, type: 'user', at: at(entry), blocks: [{ type: 'tool_result', id: message.toolCallId, output: resultText(message.content), isError: message.isError === true }] });
    }
  }
  const turns = settled(turnsOf(kept));
  return {
    provider: 'pi', id, cwd: typeof header?.cwd === 'string' ? header.cwd : null, branch: null, createdAt: Number.isNaN(created) ? null : created, model,
    title: oneLine(turns[0]?.prompt ?? ''), turns,
  };
}

/** Pi, for the synchronization of a DSH session that runs on it (native/index.mjs): where a session is, and what it holds. */
export const piStore = {
  id: 'pi',
  summary: (id, options) => summaryOf(id, options),
  history: (summary, { images = false } = {}) => readPiHistory({ file: summary.file, id: summary.id, images }),
};
