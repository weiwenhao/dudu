import { toolCallOf, toolResultOf } from '../drivers/codex.mjs';
import { settled } from './history.mjs';
import { IMAGE_MARKER, imageFromUrl, SESSION_IMAGE_BUDGET } from './images.mjs';
import { clip, oneLine } from './text.mjs';

// A Codex thread as the conversation it holds. The app-server reports each turn as items (the same ones it streams
// while a turn runs), so the tool calls and results are read with the code that reads them live; what is added here is
// grouping them into the steps and turns that DSH's log has.

const TEXT_LIMIT = 256 * 1024;

const isPicture = (part) => part?.type === 'image' || part?.type === 'localImage';

/** What the person typed as one text, for lists, searches and previews: a run of pictures is one marker, nothing more. */
const inputText = (content) => {
  const pieces = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === 'text' && typeof part.text === 'string') { if (part.text) pieces.push(part.text); }
    else if (isPicture(part) && pieces.at(-1) !== IMAGE_MARKER) pieces.push(IMAGE_MARKER);
  }
  return pieces.join('\n').trim();
};

/**
 * What the person sent as the parts of the message, in its own order (Codex puts the pictures first): their words, and each
 * picture as the path of the file the app-server wrote it to (a path costs nothing to keep; the file is read when a session is
 * loaded). A picture that comes as a link is decoded only with `images: true`: its bytes are big. Undefined when there is no picture.
 */
function inputParts(content, images, budget) {
  const list = Array.isArray(content) ? content : [];
  if (!list.some(isPicture)) return undefined;
  const parts = [];
  for (const part of list) {
    if (part?.type === 'text' && typeof part.text === 'string') parts.push({ type: 'text', text: part.text });
    else if (part?.type === 'localImage') parts.push(typeof part.path === 'string' && part.path ? { type: 'image', path: part.path } : { type: 'image', skipped: true });
    else if (part?.type === 'image') parts.push(images ? imageFromUrl(part.url, budget) : { type: 'image', skipped: true });
  }
  return parts;
}

/**
 * The turns of a `thread/read` reply: what the person typed (with the pictures they pasted, as `parts`), then the steps Codex
 * took, each ending at a tool call.
 */
export function codexTurns(thread, { images = false, metrics } = {}) {
  const budget = { left: SESSION_IMAGE_BUDGET };
  const turns = [];
  for (const source of Array.isArray(thread?.turns) ? thread.turns : []) {
    const items = Array.isArray(source.items) ? source.items : [];
    const opener = items.find((item) => item?.type === 'userMessage');
    const prompt = inputText(opener?.content);
    if (!prompt) continue;
    const parts = inputParts(opener.content, images, budget);
    const measured = metrics?.get(source.id);
    const complete = !Object.hasOwn(source, 'completedAt') || source.completedAt !== null || Number.isFinite(measured?.endedAt);
    const turn = {
      id: source.id,
      at: Number.isFinite(source.startedAt) ? source.startedAt * 1000 : null,
      endedAt: Number.isFinite(source.completedAt) ? source.completedAt * 1000 : measured?.endedAt ?? null,
      complete,
      ...(complete && (source.status === 'interrupted' || measured?.interrupted) ? { interrupted: true } : {}),
      prompt, ...(parts ? { parts } : {}), steps: [], results: new Map(),
    };
    let step = { blocks: [], calls: [] };
    const close = () => { if (step.input || step.blocks.length) turn.steps.push(step); step = { blocks: [], calls: [] }; };
    for (const item of items) {
      if (item === opener) continue;
      const timing = measured?.items.get(item.id);
      if (item?.type === 'userMessage') {
        const prompt = inputText(item.content);
        if (!prompt) continue;
        close();
        const parts = inputParts(item.content, images, budget);
        step.input = { id: item.id, prompt, ...(parts ? { parts } : {}) };
      } else if (item?.type === 'reasoning') {
        if (Number.isFinite(timing?.end)) step.at = Math.max(step.at ?? 0, timing.end);
        const parts = item.summary?.some((part) => typeof part === 'string' && part.trim()) ? item.summary : item.content;
        const text = (Array.isArray(parts) ? parts : []).filter((part) => typeof part === 'string' && part.trim()).join('\n\n');
        if (text) step.blocks.push({ type: 'reasoning', text: clip(text, TEXT_LIMIT) });
      } else if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.text) {
        if (Number.isFinite(timing?.end)) step.at = Math.max(step.at ?? 0, timing.end);
        step.blocks.push({ type: 'text', text: clip(item.text, TEXT_LIMIT) });
      } else {
        const call = toolCallOf(item);
        if (!call || typeof item.id !== 'string') continue;
        // Another app-server can observe the call before its final output exists.
        if (item.status === 'inProgress') { close(); break; }
        const result = toolResultOf(item);
        const output = clip(result.output, TEXT_LIMIT);
        if (Number.isFinite(timing?.start)) step.at = Math.max(step.at ?? 0, timing.start);
        step.blocks.push({ type: 'tool-call', id: item.id, name: call.name, arguments: JSON.stringify(call.input ?? {}) });
        step.calls.push({ id: item.id, name: call.name });
        turn.results.set(item.id, { output, isError: result.isError === true, ...(result.data ? { data: result.data } : {}), ...(Number.isFinite(timing?.end) ? { at: timing.end } : {}) });
        close();
      }
    }
    close();
    if (turn.steps.length) {
      const usage = measured?.usage ?? measured?.fallbackUsage;
      if (usage) turn.steps.at(-1).usage = usage;
    }
    turns.push(turn);
  }
  return turns;
}

/** Read a Codex thread as a conversation (`images: true` also decodes a picture that comes as a link). */
export function codexHistory(thread, options) {
  const turns = settled(codexTurns(thread, options));
  const first = turns[0]?.prompt ?? '';
  return {
    provider: 'codex', id: thread.id, cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
    branch: thread.gitInfo?.branch ?? null, model: thread.model ?? null,
    createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt * 1000 : null,
    title: oneLine((typeof thread.name === 'string' && thread.name) || thread.preview || first), turns,
  };
}
