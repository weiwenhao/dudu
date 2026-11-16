import { ISSUE_SESSION_STATES } from '../sessions/session-state.mjs';
import { LABEL_COLORS } from './labels.mjs';
import { STATUS_ICON_PROGRESS } from './workflow.mjs';

const text = { type: 'string' };
const time = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const list = (items) => ({ type: 'array', items, maxItems: 100 });
const choice = (values) => ({ type: 'string', enum: values });
const statusId = { ...text, minLength: 1, maxLength: 100, description: 'Stable workflow status id from issues/statuses, including custom statuses.' };
const statusCategory = choice(['backlog', 'unstarted', 'started', 'completed', 'canceled']);
const statusFields = {
  name: { ...text, minLength: 1, maxLength: 80 }, color: nullable({ ...text, pattern: '^#[0-9a-fA-F]{6}$' }),
  iconProgress: { type: 'number', enum: STATUS_ICON_PROGRESS, description: 'Icon fill for a started status; does not change issue workflow.' },
  description: { ...text, maxLength: 500 },
};
const groups = ['status', 'priority', 'agent', 'sessionState', 'project'];
export const ISSUE_ID = { anyOf: [{ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, { type: 'string', pattern: '^#?(?:[1-9][0-9]{0,14}|[A-Za-z]{1,3}-[1-9][0-9]{0,14})$' }] };
export const ISSUE_PROJECT = nullable(object({ name: { ...text, minLength: 1, maxLength: 200 }, path: nullable({ ...text, maxLength: 1000 }) }, ['name']));
export const ISSUE_FIELDS = object({
  title: { ...text, minLength: 1, maxLength: 300 }, brief: { ...text, maxLength: 20000 },
  status: statusId, ask: { ...text, maxLength: 2000 }, priority: choice(['none', 'urgent', 'high', 'medium', 'low']),
  impact: nullable({ type: 'integer', minimum: 1, maximum: 3 }), effort: nullable(choice(['s', 'm', 'l'])),
  kind: { ...text, maxLength: 100 }, project: ISSUE_PROJECT, dueAt: nullable(time), snoozeUntil: nullable(time),
  agent: nullable({ ...text, maxLength: 100 }), session: nullable({ ...text, maxLength: 300 }), outcome: nullable({ ...text, maxLength: 4000 }),
  source: choice(['owner', 'dudu', 'connector', 'session']), sourceRef: { ...text, maxLength: 2000 },
  labels: list({ type: 'integer', minimum: 1 }), // ids of labels (issues/labels), each once
  parent: nullable({ type: 'integer', minimum: 1 }), // the issue this one is a sub-issue of
});
const filter = {
  label: list({ type: 'integer', minimum: 1 }),
  status: list(ISSUE_FIELDS.properties.status), priority: list(ISSUE_FIELDS.properties.priority),
  project: list(nullable(text)), agent: list(nullable(text)), sessionState: list(choice(ISSUE_SESSION_STATES)),
  source: list(ISSUE_FIELDS.properties.source), q: text,
  hasQuestion: { type: 'boolean' },
  ...Object.fromEntries(['dueFrom', 'dueTo', 'createdFrom', 'createdTo', 'updatedFrom', 'updatedTo', 'receivedFrom', 'receivedTo', 'completedFrom'].map((name) => [name, time])),
};
const view = object({
  tab: choice(['active', 'backlog', 'all']), filter: object(filter), group: nullable(choice(groups)), subGroup: nullable(choice(groups)),
  order: choice(['priority', 'status', 'due', 'updated', 'received', 'created']), reverse: { type: 'boolean' }, completedLast: { type: 'boolean' },
  pinnedFirst: { type: 'boolean' },
  limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: nullable(text), groupFilter: nullable(object({ key: nullable(text), subKey: nullable(text) }, ['key'])),
});
const meta = { reason: { ...text, maxLength: 2000 }, groupId: nullable(text) };
const promptAttachment = { anyOf: [
  object({ type: { const: 'image' }, mediaType: choice(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), data: { ...text, minLength: 1 }, name: text }, ['type', 'mediaType', 'data']),
  object({ type: { const: 'file' }, receiptId: { ...text, pattern: '^[\\x21-\\x7e]{1,512}$' } }, ['type', 'receiptId']),
] };
export const ISSUE_REQUESTS = {
  statuses: object({}),
  labels: object({}),
  'label-add': object({ fields: object({ name: { ...text, minLength: 1, maxLength: 50 }, color: choice(LABEL_COLORS) }, ['name']) }, ['fields']),
  'label-update': object({ id: { type: 'integer', minimum: 1 }, patch: object({ name: { ...text, minLength: 1, maxLength: 50 }, color: choice(LABEL_COLORS) }) }, ['id', 'patch']),
  'label-remove': object({ id: { type: 'integer', minimum: 1 } }, ['id']),
  'link-add': object({ id: ISSUE_ID, fields: object({ url: { ...text, minLength: 1, maxLength: 2000 }, title: { ...text, maxLength: 200 }, kind: choice(['link', 'pull_request', 'document']) }, ['url']), ...meta }, ['id', 'fields']),
  'link-remove': object({ id: ISSUE_ID, linkId: { type: 'integer', minimum: 1 }, ...meta }, ['id', 'linkId']),
  'status-add': object({ fields: object({ ...statusFields, category: statusCategory }, ['name', 'category']) }, ['fields']),
  'status-update': object({ id: statusId, patch: object({ ...statusFields, isDefault: { const: true } }) }, ['id', 'patch']),
  'status-remove': object({ id: statusId, replacement: statusId }, ['id']),
  'status-order': object({ category: statusCategory, ids: list(statusId) }, ['category', 'ids']),
  schema: object({}),
  office: object({}), list: view, facets: view, counts: object({}), export: object({}),
  get: object({ id: ISSUE_ID, logLimit: { type: 'integer', minimum: 1, maximum: 200 }, logCursor: { type: 'integer', minimum: 1 } }, ['id']),
  add: object({ fields: { ...ISSUE_FIELDS, required: ['title'] }, ...meta }, ['fields']),
  update: object({ id: ISSUE_ID, patch: ISSUE_FIELDS, ...meta }, ['id', 'patch']),
  assign: object({ id: ISSUE_ID, agent: ISSUE_FIELDS.properties.agent, session: ISSUE_FIELDS.properties.session, project: ISSUE_PROJECT, ...meta }, ['id', 'agent']),
  log: object({ id: ISSUE_ID, kind: choice(['source', 'priority', 'due', 'assign', 'status', 'progress', 'decision', 'blocked', 'session', 'result', 'note']), text, data: {}, ...meta }, ['id', 'kind', 'text']),
  message: object({ id: ISSUE_ID, text: { ...text, maxLength: 20000 },
    attachmentIds: list({ ...text, minLength: 1, maxLength: 100 }), requestId: { ...text, minLength: 1, maxLength: 100 } }, ['id', 'text']),
  forward: object({ id: ISSUE_ID, session: text, text: { ...text, minLength: 1, maxLength: 20000 }, attachments: list(promptAttachment), retryEntry: { type: 'integer', minimum: 1 }, chat: { type: 'boolean' } }, ['id', 'text']),
  recipients: object({ q: { ...text, maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }),
  reply: object({ id: ISSUE_ID, text, ...meta }, ['id', 'text']),
  complete: object({ id: ISSUE_ID, outcome: text, ...meta }, ['id']),
  cancel: object({ id: ISSUE_ID, ...meta }, ['id']),
  snooze: object({ id: ISSUE_ID, until: nullable(time), ...meta }, ['id', 'until']),
  resume: object({ id: ISSUE_ID, session: text }),
  forget: object({ id: ISSUE_ID, token: text }, ['id']),
  delete: object({ id: ISSUE_ID, token: text }, ['id']),
  session: object({ id: ISSUE_ID }, ['id']),
  source: object({ id: ISSUE_ID }, ['id']),
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
        createdAt: time, updatedAt: time, receivedAt: { ...time, readOnly: true, description: 'Last completed incoming reply, from the shared session activity projection; 0 before any completed reply.' }, resolvedAt: nullable(time),
        statusType: choice(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled']),
        progressSummary: { ...text, maxLength: 20000, readOnly: true },
        sessionState: { ...choice(ISSUE_SESSION_STATES), readOnly: true },
        pinned: { type: 'boolean', readOnly: true },
        labels: { type: 'array', readOnly: true, items: object({ id: { type: 'integer' }, name: text, color: choice(LABEL_COLORS) }) }, // `labels` as written are ids; as read, these
        parent: nullable(object({ id: { type: 'integer' }, ref: nullable(text), title: text, status: text, statusType: text })),
        subIssues: object({ total: { type: 'integer' }, done: { type: 'integer' } }), // only on an issue that has sub-issues
        children: { type: 'array', readOnly: true, items: { type: 'object' } }, // `get` only: the sub-issues
        deepSleep: { type: 'boolean', readOnly: true }, // idle after 30 minutes or unread after an hour; live work/dialogs stay protected
        sessions: { type: 'array', items: object({
          key: text, agent: text, openedAt: time, closedAt: nullable(time),
          closeReason: nullable(choice(['auto', 'switch', 'done'])), open: { type: 'boolean' }, state: nullable(text),
        }) },
      }, required: ['id', 'ref', 'title', 'status', 'sessionState', 'createdAt', 'updatedAt'] },
      Result: { type: 'object', properties: { outcome: choice(['success', 'no_op', 'needs_clarification', 'error']), issue: { $ref: '#/components/schemas/Issue' }, code: text, message: text }, additionalProperties: true },
    } },
  };
}
