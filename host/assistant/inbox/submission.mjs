// The collector's tool arguments: the schema shown to the model and the check at the write boundary come from the same definition.
import * as z from 'zod/v4';
import { KINDS, RECORD_LIMITS as L } from './records.mjs';
import { redact } from '../memory/secrets.mjs';

export const COLLECTOR_SUBMIT = 'collector_submit';
const text = (max) => z.string().max(max).describe(`At most ${max} characters.`);
const time = z.union([text(100), z.number().positive()]).refine((value) =>
  typeof value === 'number' || value === '' || Number.isFinite(Date.parse(value)), 'Use a source timestamp or an ISO date.');
const context = z.strictObject({
  from: text(L.from).optional(), at: time.optional(), text: text(L.contextText),
  mine: z.boolean().optional(),
});
const record = z.strictObject({
  id: z.union([text(L.id).min(1), z.number().int()]),
  version: text(L.version).optional(), kind: z.enum(KINDS).optional(),
  title: text(L.title).optional(), from: text(L.from).optional(), at: time.optional(),
  url: text(L.url).refine((value) => {
    if (!value) return true;
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }, 'Use an http or https source link.').optional(),
  thread: text(L.thread).optional(), text: text(L.text).optional(),
  context: z.array(context).max(L.context).describe(`At most ${L.context} context messages.`).optional(), more: text(L.more).optional(),
  update: z.boolean().optional(), to_me: z.boolean().optional(), handled: z.boolean().optional(),
});
const result = z.strictObject({
  ok: z.boolean(),
  records: z.array(record).max(L.records).describe(`At most ${L.records} source records; required when ok is true.`).optional(),
  error: text(300).min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.ok && (!value.records || value.error !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['records'], message: 'Success needs records (an empty list when nothing is new), and no error.' });
  }
  if (!value.ok && (!value.error?.trim() || value.records !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['error'], message: 'Failure needs the source error, and no records.' });
  }
});

// DSH's enforced schema subset supports shapes and oneOf, not numeric/length bounds or anyOf. These unions have disjoint types;
// project them as oneOf and keep all bounds/date checks in Zod at execution, with the limits also described for the model.
export const COLLECTOR_RESULT_SCHEMA = z.toJSONSchema(result, {
  override: ({ jsonSchema }) => {
    if (jsonSchema.anyOf) {
      jsonSchema.oneOf = jsonSchema.anyOf;
      delete jsonSchema.anyOf;
    }
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) delete jsonSchema[key];
  },
});
delete COLLECTOR_RESULT_SCHEMA.$schema;

/** A malformed tool call is feedback to the model; never repair or execute text as if it were an object. Diagnostics contain paths, never source values. */
export function checkCollectorResult(value) {
  const checked = result.safeParse(value);
  return checked.success ? { ok: true, value: checked.data } : {
    ok: false, code: 'invalid_arguments',
    errors: checked.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.map(String).join('.') || '$', message: redact(issue.message),
    })),
  };
}
