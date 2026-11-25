const text = { type: 'string' };
const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const id = object({ id: text }, ['id']);
const model = object({ provider: text, model: text, reasoningEffort: text }, ['provider', 'model']);
const collector = {
  name: text, connector: text, prompt: text, frequency: { type: ['string', 'null'] }, notify: { type: 'boolean' },
};
const customConnector = { text, name: text, token: text, env: { type: 'object', additionalProperties: text } };

/** Owner operations share their handlers with Dudu. Credentials stay in the existing connection/credential services. */
export const ASSISTANT_REQUESTS = Object.freeze({
  'assistant/state': object(),
  'assistant/settings': object({ patch: object({
    pet: object({ enabled: { type: 'boolean' }, doubleSpace: { type: 'boolean' }, voice: { type: 'boolean' } }),
    deepSleep: { type: 'boolean' }, widgets: object({ developer: { type: 'boolean' } }),
    needsYouColor: text, views: { type: 'object', additionalProperties: { type: 'object' } },
  }) }),
  'assistant/folder': object({ path: text, move: { type: 'boolean' } }, ['path']),
  'assistant/open': object({ name: { type: 'string', enum: ['folder', 'TRIAGE.md', 'ASSIGN.md'] } }, ['name']),
  'rules/get': object(),
  'rules/update': object({
    name: { type: 'string', enum: ['TRIAGE.md', 'ASSIGN.md'] }, text,
    previous: { type: ['string', 'null'] }, projectFolder: text,
  }, ['name', 'text', 'previous', 'projectFolder']),
  'memory/records': object({ file: { type: 'string', enum: ['USER', 'MEMORY'] }, status: { type: 'string', enum: ['active', 'superseded'] }, q: text }),
  'memory/update': object({ id: text, text, status: { type: 'string', enum: ['active', 'superseded'] } }, ['id']),
  'memory/forget': object({ source: { anyOf: [text, { type: 'array', items: text, maxItems: 100 }] }, preview: { type: 'boolean' } }, ['source']),
  'memory/reviews': object({ limit: { type: 'integer', minimum: 1, maximum: 100 } }),
  'skills/list': object(),
  'skills/read': object({ name: text }, ['name']),
  'skills/remove': object({ name: text }, ['name']),
  'connectors/catalog': object(),
  'connectors/list': object(),
  ...Object.fromEntries(['connect', 'authorize', 'retry', 'cancel', 'remove'].map((action) => [`connectors/${action}`, id])),
  // The phone's sign-in (2026-11-23): the page opens on the phone, and the address its browser view stopped at comes back here.
  'connectors/signin': id,
  'connectors/signin-finish': object({ id: text, url: { type: 'string', minLength: 1, maxLength: 8192 } }, ['id', 'url']),
  'connectors/recognize': object({ text }, ['text']),
  'connectors/add': object(customConnector, ['text']),
  'connectors/update': object({ id: text, text, name: text, token: text }, ['id']),
  'collectors/list': object(),
  'collectors/add': object(collector, ['name', 'connector', 'prompt']),
  'collectors/update': object({ id: text, ...collector }, ['id']),
  'collectors/remove': id,
});

export const CONVERSATION_MODEL = model;
