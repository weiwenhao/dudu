// A conversation read from a harness's own store, whichever harness it is:
//   { provider, id, title, cwd, branch, createdAt, model, turns }
// and a turn is `{ at, prompt, steps, results }`: what the person typed, the steps the harness took in answer (each a list
// of `reasoning`, `text` and `tool-call` blocks, with the calls it made), and a map from a call's id to its result
// `{ output, isError, data? }`. DSH's log is built from this.

/**
 * Make a conversation end the way a finished one does: steps without content go, and a last step that ends in tool calls
 * keeps its words but loses the calls (the harness never went on from them), so the next message starts a new turn instead of
 * looking like the middle of this one. A turn nothing is left of is dropped.
 */
export function settled(turns) {
  for (const turn of turns) turn.steps = turn.steps.filter((step) => step.blocks.length > 0);
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const last = turn.steps.at(-1);
    if (last?.calls.length) {
      last.blocks = last.blocks.filter((block) => block.type !== 'tool-call');
      last.calls = [];
      if (!last.blocks.length) turn.steps.pop();
    }
    if (turn.steps.length) break;
    turns.pop();
  }
  return turns;
}
