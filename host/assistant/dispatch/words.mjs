// Every sentence dispatch writes for a person or for the model that calls it, in one place so that the owner can review them at once
// (docs/assistant.md: wording is the owner's to review). NEW: everything below waits for the owner's review, except 交给谁处理？, which is the
// design's own (1.2 step 3, 1.5 scene 5, 3.3).
//
//   log      lines that end up in an issue's log. Activity shows them after "嘟嘟 …" (host/dudu-plugin/ui/issues/activity.js writes the sentence
//            from the kind of the entry and shows these as the detail), so they are short and carry only what the sentence does not say.
//            Fixed words are English, as in the rest of the Activity; the model's reasons, which come next to them, are content.
//   ask      the question an unassigned issue puts to the owner
//   message  answers of the operations (the model that calls them reads them and tells the owner)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const WORDS = Object.freeze({
  // --- the log of an issue
  whoShouldTake: '交给谁处理？',
  source: (connector, operation, ref) => `${connector} · ${operation} · ${ref}`,
  urgentNeedsRule: 'Urgent needs a rule in TRIAGE.md; the priority comes from impact and effort.',
  notAssigned: (why) => `No agent chosen: ${why}`,
  sessionDropped: 'the session it named was not offered, so a new one starts',
  access: (access, requested, allowed) => (requested && requested !== access ? `access: ${access} (asked for ${requested}; ASSIGN.md allows ${allowed})` : `access: ${access}`),

  // --- what an operation answers
  disposed: 'The dispatch was shut down.',
  needsModel: (what) => `${what} needs a model, and none was given.`,
  giveModel: 'Create the dispatch with an llm function.',
  noConnectors: 'There are no connectors to read.',
  cannotList: 'The connectors could not be listed.',
  noneEnabled: 'No connector is turned on, so there is nothing to read. The owner turns them on in the connections page.',
  noSuchConnector: (ids) => `No connector that is turned on is called ${ids.join(', ')}.`,
  busy: 'An intake run is already in progress.',
  nothingToRead: 'Nothing was read: the operations that can be read all need a value the code cannot give.',
  needsValue: (name) => `It needs a value for "${name}", which the code cannot give.`,
  readFailed: 'The read failed.',
  callLimit: (n) => `At most ${n} model calls are made in one run; this output waits for the next run.`,
  modelTimeout: (seconds) => `The model did not answer in ${seconds} seconds.`,
  modelFailed: (why) => `The model call failed: ${why}`,
  unusable: (why) => `The model's answer could not be used: ${why}`,
  someUnusable: (n) => `${plural(n, 'item', 'items')} of the model's answer could not be used.`,
  notOpen: (id) => `DUDU-${id} is not open any more.`,
  failed: (why) => `Intake failed: ${why}`,
  tryAgain: 'Look at what was written, then run it again.',
  untouched: 'Nothing was changed.',
  summary: ({ created, noted, unchanged, failed, deferred, skipped, waiting }) => {
    const parts = [plural(created, 'issue', 'issues') + ' created'];
    if (noted) parts.push(`${plural(noted, 'note', 'notes')} added`);
    if (unchanged) parts.push(`${plural(unchanged, 'output', 'outputs')} unchanged`);
    if (failed) parts.push(`${plural(failed, 'output', 'outputs')} failed`);
    if (skipped) parts.push(`${plural(skipped, 'operation', 'operations')} skipped`);
    if (waiting) parts.push(`${plural(waiting.outputs, 'output', 'outputs')} and ${plural(waiting.items, 'issue', 'issues')} wait for the next run`);
    else if (deferred) parts.push(`${plural(deferred, 'output', 'outputs')} wait for the next run`);
    return `${parts.join(', ')}.`;
  },

  // --- assignment
  noAgentOn: 'No agent is turned on.',
  unavailable: (agent, why) => `The model chose "${agent}", which cannot take issues now. ${why}`,
  changedMeanwhile: (ref) => `${ref} changed while the model was choosing, so it was left as it is.`,
  assigned: (ref, agent, session, access) => `${ref} was given to ${agent}${session ? ` (continuing ${session})` : ''}, ${access}.`,
  notAssignedMessage: (ref, why) => `${ref} was not given to anyone: ${why} It stays in Todo and asks the owner.`,
  ownerDecides: 'The owner gives the issue to an agent, or tells 嘟嘟 which one.',
  finished: (ref, status) => `${ref} is ${status}; nothing to hand out.`,
  hasAgent: (ref, agent) => `${ref} already has an agent (${agent}).`,
  notTodo: (ref, status) => `${ref} is ${status}, not Todo; only a Todo issue is handed out.`,
  assigning: (ref) => `${ref} is being handed out already.`,
});
