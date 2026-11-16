import { stripVTControlCharacters } from 'node:util';
import { sessionChildren } from './dsh-subagents.mjs';
import { mapLimit } from './providers/async.mjs';

export const NATIVE_SESSION_ACTIVITY_METHODS = Object.freeze([
  'session.team', 'session.jobs', 'session.job.output', 'session.job.stop',
]);

const MAX_MEMBERS = 200;
const OUTPUT_LIMIT = 64 * 1024;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
const modes = new Set(['one-shot', 'continuable', 'unknown']);

/** Native, session-scoped views over DSH's existing projections and non-consuming job observations. */
export function createNativeSessionActivity({ remote, rowOf, summaryOf, streamHandle, fail }) {
  const idOf = (value) => {
    if (typeof value !== 'string' || !value || value.length > 256 || /[\u0000-\u001f]/u.test(value)) fail('BAD_REQUEST');
    return value;
  };
  const projectionOf = async (id) => {
    const projection = await remote.call('session/projections', { sessionId: id });
    if (!record(projection?.values)) fail('NOT_FOUND');
    return projection.values;
  };

  async function childRowOf(id, addressable) {
    const row = await rowOf(id);
    if (row || !addressable) return row;
    // Some DSH children are absent from the ordinary list. Its passive state read does not activate an agent.
    const state = await remote.call('session/state', { sessionId: id });
    if (typeof state?.running !== 'boolean') fail('UPSTREAM_UNAVAILABLE');
    return { sessionId: id, running: state.running };
  }

  function memberOf(id, row, values, entry, subagent) {
    const source = { ...row, sessionId: id, projections: { values: { ...row?.projections?.values, ...values } } };
    if (entry) source.title = entry.label || entry.description || entry.name || source.title;
    const session = { ...summaryOf(source), ...(subagent ? { subagent } : {}) };
    const selection = values.modelSelection?.next ?? values.modelSelection?.lastUsed;
    const completed = values.subagentTiming?.lastTurnCompleted === true;
    return {
      id, session,
      name: text(entry?.label || entry?.description || entry?.name || session.title),
      ...(selection?.provider && selection?.model ? { modelId: `${selection.provider}:${selection.model}` } : {}),
      state: session.status === 'running' ? 'working' : entry?.phase === 'failed' ? 'failed'
        : completed ? 'completed' : session.status === 'waiting' ? 'blocked' : 'idle',
      canOpen: Boolean(subagent && entry?.mode !== 'external' && entry?.phase !== 'failed' && entry?.phase !== 'provisioning'),
    };
  }

  /** Resolve a child only from its parent's authoritative catalog. Never trust a phone-supplied mode. */
  async function resolveChild(id, descriptor) {
    idOf(id);
    if (!record(descriptor) || Object.keys(descriptor).some((key) => !['parentSessionId', 'mode'].includes(key))) fail('BAD_REQUEST');
    const parentSessionId = idOf(descriptor.parentSessionId);
    if (parentSessionId === id) fail('BAD_REQUEST');
    const entry = sessionChildren(await projectionOf(parentSessionId)).find((child) => child.id === id);
    if (!entry) fail('NOT_FOUND');
    if (entry.mode === 'external') fail('UNSUPPORTED');
    const values = await projectionOf(id);
    const mode = values.subagent?.mode ?? entry.mode;
    if (!modes.has(mode)) fail('UNSUPPORTED');
    const subagent = { parentSessionId, mode };
    const member = memberOf(id, await childRowOf(id, true), values, entry, subagent);
    return { address: { kind: 'subagent', parentSessionId, childSessionId: id, mode }, session: member.session };
  }

  async function team(params) {
    const id = idOf(params.id);
    const [values, row] = await Promise.all([projectionOf(id), rowOf(id, { fresh: true })]);
    if (!row && !params.subagent) fail('NOT_FOUND');
    const resolved = params.subagent ? await resolveChild(id, params.subagent) : undefined;
    const root = memberOf(id, row ?? resolved?.session, values, undefined, resolved?.session.subagent);
    root.canOpen = false;
    const children = sessionChildren(values).filter((child) => child.id !== id).slice(0, MAX_MEMBERS);
    const members = await mapLimit(children, 4, async (entry) => {
      const childId = entry.id;
      idOf(childId);
      // External and provisioning entries have no addressable DSH conversation.
      const addressable = entry.mode !== 'external' && !['failed', 'provisioning'].includes(entry.phase);
      const [childRow, childValues] = await Promise.all([
        childRowOf(childId, addressable), addressable ? projectionOf(childId) : {},
      ]);
      const mode = childValues.subagent?.mode ?? entry.mode;
      const subagent = addressable && modes.has(mode) ? { parentSessionId: id, mode } : undefined;
      return memberOf(childId, childRow, childValues, entry, subagent);
    });
    return { members: [root, ...members] };
  }

  async function firstFrame(endpoint, request, read) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15_000);
    timeout.unref?.();
    let stream;
    try {
      stream = streamHandle(await remote.open(endpoint, request, abort.signal));
      return await read(stream);
    } finally {
      clearTimeout(timeout);
      abort.abort();
      await stream?.close();
    }
  }

  async function jobs(id) {
    idOf(id);
    return firstFrame('job/list', { sessionId: id }, async (stream) => {
      const first = await stream.next();
      if (first.done || first.value?.type !== 'rows' || !Array.isArray(first.value.jobs)) fail('UPSTREAM_UNAVAILABLE');
      return first.value.jobs.filter((job) => record(job) && (job.owner === undefined || job.owner === id));
    });
  }

  function jobView(job) {
    if (typeof job.id !== 'string' || !['running', 'stopping', 'completed', 'killed', 'failed'].includes(job.status)
      || !Number.isFinite(job.startedAt)) fail('UPSTREAM_UNAVAILABLE');
    return {
      id: job.id, title: text(job.label, 2000), status: job.status, startedAt: job.startedAt,
      ...(Number.isFinite(job.finishedAt) ? { finishedAt: job.finishedAt } : {}),
      ...(job.progress || job.detail ? { detail: text(job.progress || job.detail, 4000) } : {}),
    };
  }

  async function jobFor(params) {
    idOf(params.id);
    idOf(params.jobId);
    const job = (await jobs(params.id)).find((item) => item.id === params.jobId);
    if (!job) fail('NOT_FOUND');
    return job;
  }

  async function output(params) {
    const job = await jobFor(params);
    const total = job.output?.total;
    if (!Number.isSafeInteger(total) || total < 0) fail('UPSTREAM_UNAVAILABLE');
    const earliest = job.output.earliest;
    if (!Number.isSafeInteger(earliest) || earliest < 0 || earliest > total) fail('UPSTREAM_UNAVAILABLE');
    const from = Math.max(0, total - OUTPUT_LIMIT, earliest);
    return firstFrame('job/follow', { sessionId: params.id, jobId: job.id, from }, async (stream) => {
      const opened = await stream.next();
      if (opened.done || opened.value?.type !== 'opened' || opened.value.job?.id !== job.id) fail('UPSTREAM_UNAVAILABLE');
      const anchor = opened.value.job;
      if (anchor.owner !== undefined && anchor.owner !== params.id
        || !Number.isSafeInteger(anchor.output?.total) || anchor.output.total < 0
        || !Number.isSafeInteger(opened.value.from) || opened.value.from < 0) fail('UPSTREAM_UNAVAILABLE');
      let result = '';
      let next = opened.value.from;
      // Drain only the retained snapshot. Closing this observer never consumes model output or kills work.
      for (let frames = 0; next < anchor.output.total; frames++) {
        if (frames >= 128) fail('LIMIT_EXCEEDED');
        const item = await stream.next();
        if (item.done || item.value?.type !== 'output' || !Array.isArray(item.value.chunks)
          || !Number.isSafeInteger(item.value.next) || item.value.next <= next) fail('UPSTREAM_UNAVAILABLE');
        for (const chunk of item.value.chunks) {
          if (typeof chunk?.text !== 'string') fail('UPSTREAM_UNAVAILABLE');
          result = (result + chunk.text.slice(-OUTPUT_LIMIT)).slice(-OUTPUT_LIMIT);
        }
        next = item.value.next;
      }
      return { job: jobView(anchor), text: stripVTControlCharacters(result) };
    });
  }

  return {
    resolveChild,
    async dispatch(method, params) {
      const keys = method === 'session.team' ? ['id', 'subagent']
        : method === 'session.jobs' ? ['id'] : ['id', 'jobId'];
      if (Object.keys(params).some((key) => !keys.includes(key))) fail('BAD_REQUEST');
      switch (method) {
        case 'session.team': return team(params);
        case 'session.jobs': return { jobs: (await jobs(params.id)).map(jobView) };
        case 'session.job.output': return output(params);
        case 'session.job.stop':
          await jobFor(params);
          await remote.call('job/kill', { sessionId: params.id, jobId: params.jobId });
          return {};
        default: fail('UNSUPPORTED');
      }
    },
  };
}
