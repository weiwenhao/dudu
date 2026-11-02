const text = { type: 'string' };
const time = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const list = (items) => ({ type: 'array', items, maxItems: 100 });
const choice = (values) => ({ type: 'string', enum: values });
const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
const groups = ['status', 'priority', 'agent', 'agentState', 'project'];
export const ISSUE_ID = { anyOf: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: 'string', pattern: '^#?(?:[1-9][0-9]{0,14}|[A-Za-z]{1,3}-[1-9][0-9]{0,14})$' }] };
export const ISSUE_PROJECT = nullable(object({ name: { ...text, minLength: 1, maxLength: 200 }, path: nullable({ ...text, maxLength: 1000 }) }, ['name']));
export const ISSUE_FIELDS = object({
  title: { ...text, minLength: 1, maxLength: 300 }, brief: { ...text, maxLength: 20000 },
  status: choice(statuses), ask: { ...text, maxLength: 2000 }, priority: choice(['none', 'urgent', 'high', 'medium', 'low']),
  impact: nullable({ type: 'integer', minimum: 1, maximum: 3 }), effort: nullable(choice(['s', 'm', 'l'])),
  kind: { ...text, maxLength: 100 }, project: ISSUE_PROJECT, dueAt: nullable(time), snoozeUntil: nullable(time),
  agent: nullable({ ...text, maxLength: 100 }), session: nullable({ ...text, maxLength: 300 }), outcome: nullable({ ...text, maxLength: 4000 }),
  source: choice(['owner', 'dudu', 'connector', 'session']), sourceRef: { ...text, maxLength: 2000 },
});
const filter = {
  status: list(ISSUE_FIELDS.properties.status), priority: list(ISSUE_FIELDS.properties.priority),
  project: list(nullable(text)), agent: list(nullable(text)), agentState: list(choice(['working', 'needs_you', 'stuck', 'idle'])),
  source: list(ISSUE_FIELDS.properties.source), q: text,
  ...Object.fromEntries(['dueFrom', 'dueTo', 'createdFrom', 'createdTo', 'updatedFrom', 'updatedTo', 'completedFrom'].map((name) => [name, time])),
};
const view = object({
  tab: choice(['active', 'backlog', 'all']), filter: object(filter), group: nullable(choice(groups)), subGroup: nullable(choice(groups)),
  order: choice(['priority', 'status', 'due', 'updated', 'created']), reverse: { type: 'boolean' }, completedLast: { type: 'boolean' },
  limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: nullable(text), groupFilter: nullable(object({ key: nullable(text), subKey: nullable(text) }, ['key'])),
});
const meta = { reason: { ...text, maxLength: 2000 }, groupId: nullable(text) };
const target = { anyOf: [{ type: 'integer', minimum: 1 }, object({ eventId: { type: 'integer', minimum: 1 }, groupId: text })] };
export const ISSUE_REQUESTS = {
  schema: object({}),
  office: object({}), list: view, facets: view, counts: object({}), export: object({}),
  get: object({ id: ISSUE_ID, logLimit: { type: 'integer', minimum: 1, maximum: 200 }, logCursor: { type: 'integer', minimum: 1 } }, ['id']),
  add: object({ fields: { ...ISSUE_FIELDS, required: ['title'] }, ...meta }, ['fields']),
  update: object({ id: ISSUE_ID, patch: ISSUE_FIELDS, ...meta }, ['id', 'patch']),
  assign: object({ id: ISSUE_ID, agent: ISSUE_FIELDS.properties.agent, session: ISSUE_FIELDS.properties.session, project: ISSUE_PROJECT, ...meta }, ['id', 'agent']),
  log: object({ id: ISSUE_ID, kind: choice(['source', 'priority', 'due', 'assign', 'status', 'progress', 'decision', 'blocked', 'session', 'result', 'note']), text, data: {}, ...meta }, ['id', 'kind', 'text']),
  message: object({ id: ISSUE_ID, text: { ...text, minLength: 1, maxLength: 20000 } }, ['id', 'text']),
  reply: object({ id: ISSUE_ID, text, ...meta }, ['id', 'text']),
  complete: object({ id: ISSUE_ID, outcome: text, ...meta }, ['id']),
  cancel: object({ id: ISSUE_ID, ...meta }, ['id']),
  snooze: object({ id: ISSUE_ID, until: nullable(time), ...meta }, ['id', 'until']),
  undo: object({ target }), resume: object({ id: ISSUE_ID, session: text }),
  forget: object({ id: ISSUE_ID, token: text }, ['id']),
  delete: object({ id: ISSUE_ID, token: text }, ['id']),
  session: object({ id: ISSUE_ID }, ['id']),
  search: object({ q: text, limit: { type: 'integer', minimum: 1, maximum: 200 }, tab: choice(['active', 'backlog', 'all']) }, ['q']),
  events: object({ issueId: ISSUE_ID, limit: { type: 'integer', minimum: 1, maximum: 500 }, cursor: { type: 'integer', minimum: 1 } }),
};

/** The authenticated HTTP face and dudu tool schemas are generated from this contract. */
export function issueApiDocument() {
  return {
    openapi: '3.1.0', info: { title: 'dudu Issues API', version: '1.0.0', description: 'Requires the authenticated DSH connection. Business validation is performed by the issue store; inspect outcome even on HTTP 200.' },
    paths: Object.fromEntries(Object.entries(ISSUE_REQUESTS).map(([action, schema]) => [`/api/dudu/issues/${action}`, {
      post: {
        operationId: `issues_${action}`,
        requestBody: { required: true, content: { 'application/json': { schema } } },
        responses: {
          200: { description: 'Operation result; inspect outcome.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Result' } } } },
          400: { description: 'Request is not a JSON object.' },
        },
      },
    }])),
    components: { schemas: {
      Issue: { ...ISSUE_FIELDS, properties: {
        ...ISSUE_FIELDS.properties, id: { type: 'integer', minimum: 1 }, ref: nullable({ ...text, pattern: '^[A-Z]{1,3}-[1-9][0-9]{0,14}$' }),
        createdAt: time, updatedAt: time, resolvedAt: nullable(time),
        agentState: choice(['working', 'needs_you', 'stuck', 'idle']),
        sessions: { type: 'array', items: object({
          key: text, agent: text, openedAt: time, closedAt: nullable(time),
          closeReason: nullable(choice(['auto', 'switch', 'done'])), open: { type: 'boolean' }, state: nullable(text),
        }) },
      }, required: ['id', 'ref', 'title', 'status', 'agentState', 'createdAt', 'updatedAt'] },
      Result: { type: 'object', properties: { outcome: choice(['success', 'no_op', 'needs_clarification', 'error']), issue: { $ref: '#/components/schemas/Issue' }, code: text, message: text }, additionalProperties: true },
    } },
  };
}
