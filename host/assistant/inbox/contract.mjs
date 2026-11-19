import { ISSUE_ID } from '../issues/contract.mjs';

const text = { type: 'string' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const RECORD_ID = { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'string', pattern: '^[rR]?[1-9][0-9]*$' }] };
const selection = { id: RECORD_ID, ids: { type: 'array', items: RECORD_ID, minItems: 1, maxItems: 200 } };

/** One contract for the inbox's interface and assistant, including the owner's marks, never collector judgements. */
export const INBOX_REQUESTS = Object.freeze({
  list: object({
    tab: { type: 'string', enum: ['todo', 'done'] },
    filter: object({
      connector: { type: 'array', items: text },
      date: { type: 'array', items: { type: 'string', enum: ['day', 'week', 'month'] }, maxItems: 1 },
    }),
    limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: { type: ['string', 'null'] },
  }),
  get: object({ id: RECORD_ID }, ['id']),
  ...Object.fromEntries(['done', 'delete', 'restore'].map((action) => [action, object(selection)])),
  share: object({ ...selection, issue: ISSUE_ID, to: { type: 'string', enum: ['issue', 'session'] } }, ['issue']),
  link: object({ id: RECORD_ID, issue: ISSUE_ID }, ['id', 'issue']),
  complete: object({ id: RECORD_ID }, ['id']),
  update: object({
    id: RECORD_ID,
    patch: object({ title: { ...text, minLength: 1, maxLength: 300 }, text: { ...text, maxLength: 60_000 } }),
  }, ['id', 'patch']),
});
