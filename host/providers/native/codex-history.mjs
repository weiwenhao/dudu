import { toolCallOf, toolResultOf } from '../drivers/codex.mjs';
import { settled } from './history.mjs';
import { clip, oneLine } from './text.mjs';

// A Codex thread as the conversation it holds. The app-server reports each turn as items (the same ones it streams
// while a turn runs), so the tool calls and results are read with the code that reads them live; what is added here is
// grouping them into the steps and turns that DSH's log has.

const TEXT_LIMIT = 256 * 1024;

const inputText = (content) => (Array.isArray(content) ? content : []).map((part) => {
  if (part?.type === 'text' && typeof part.text === 'string') return part.text;
  if (part?.type === 'image' || part?.type === 'localImage') return '[image]';
  return '';
}).filter(Boolean).join('\n').trim();

/** The turns of a `thread/read` reply: what the person typed, then the steps Codex took, each ending at a tool call. */
export function codexTurns(thread) {
  const turns = [];
  for (const source of Array.isArray(thread?.turns) ? thread.turns : []) {
    const items = Array.isArray(source.items) ? source.items : [];
    const opener = items.find((item) => item?.type === 'userMessage');
    const prompt = inputText(opener?.content);
    if (!prompt) continue;
    const turn = { at: Number.isFinite(source.startedAt) ? source.startedAt * 1000 : null, prompt, steps: [], results: new Map() };
    let step = { blocks: [], calls: [] };
    const close = () => { if (step.blocks.length) turn.steps.push(step); step = { blocks: [], calls: [] }; };
    for (const item of items) {
      if (item === opener) continue;
      if (item?.type === 'reasoning') {
        const text = (Array.isArray(item.summary) ? item.summary : []).filter((part) => typeof part === 'string' && part.trim()).join('\n\n');
        if (text) step.blocks.push({ type: 'reasoning', text: clip(text, TEXT_LIMIT) });
      } else if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.text) {
        step.blocks.push({ type: 'text', text: clip(item.text, TEXT_LIMIT) });
      } else {
        const call = toolCallOf(item);
        if (!call || typeof item.id !== 'string') continue;
        const result = toolResultOf(item);
        const output = clip(result.output, TEXT_LIMIT);
        step.blocks.push({ type: 'tool-call', id: item.id, name: call.name, arguments: JSON.stringify(call.input ?? {}) });
        step.calls.push({ id: item.id, name: call.name });
        turn.results.set(item.id, { output, isError: result.isError === true, ...(result.data ? { data: result.data } : {}) });
        close();
      }
    }
    close();
    turns.push(turn);
  }
  return turns;
}

/** Read a Codex thread as a conversation. */
export function codexHistory(thread) {
  const turns = settled(codexTurns(thread));
  const first = turns[0]?.prompt ?? '';
  return {
    provider: 'codex', id: thread.id, cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
    branch: thread.gitInfo?.branch ?? null, model: thread.model ?? null,
    createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt * 1000 : null,
    title: oneLine((typeof thread.name === 'string' && thread.name) || thread.preview || first), turns,
  };
}
