import { createHash } from 'node:crypto';

export const NATIVE_ASSISTANT_METHODS = Object.freeze([
  'assistant.skills', 'assistant.recipients', 'assistant.forward',
]);

// These are the desktop assistant's own actions, reached only through authenticated native RPC.
// No caller-selected route, arbitrary command or general DSH proxy is exposed.
export function createNativeAssistant({ assistant, remote, fail, attachments, fileBytes }) {
  const deliveries = new Map();
  const isSession = (id) => typeof id === 'string' && id.length > 0 && assistant?.state?.()?.sessionId === id;
  const requireSession = (id) => {
    if (!assistant) fail('UNSUPPORTED');
    if (!isSession(id)) fail('NOT_FOUND');
  };
  const result = (value) => ({
    outcome: value?.outcome ?? 'error',
    ...(value?.code ? { code: value.code } : {}),
    ...(value?.saved ? { saved: true } : {}),
    ...(value?.entry?.id ? { entryId: value.entry.id } : {}),
    ...(value?.issue ? { issue: { id: value.issue.id, ref: value.issue.ref ?? null, title: value.issue.title } } : {}),
  });

  async function forward(params) {
    if (typeof params.text !== 'string' || !params.text.trim() || params.text.length > 20_000
      || !/^(?:#?[1-9]\d{0,14}|[A-Za-z]{1,3}-[1-9]\d{0,14})$/u.test(String(params.id ?? ''))
      || typeof params.requestId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/u.test(params.requestId)
      || params.session !== undefined && typeof params.session !== 'string'
      || params.retryEntry !== undefined && (!Number.isSafeInteger(params.retryEntry) || params.retryEntry < 1)) fail('BAD_REQUEST');
    const content = attachments(params.attachments);
    const files = params.files ?? [];
    if (!Array.isArray(files) || files.length > 5) fail('INVALID_ATTACHMENT');
    // Validate all bytes before putting back a folded session or uploading anything.
    for (const file of files) {
      if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 255
        || fileBytes(file.data).length === 0) fail('INVALID_ATTACHMENT');
    }
    if (Buffer.byteLength(JSON.stringify({ content, files }), 'utf8') > 28 * 1024 * 1024) fail('LIMIT_EXCEEDED');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      id: params.id, session: params.session, text: params.text, content, files, retryEntry: params.retryEntry,
    })).digest('hex');
    const previous = deliveries.get(params.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('BAD_REQUEST');
      return previous.pending;
    }
    // Never evict an in-flight delivery: a duplicate must join it rather than send another message.
    while (deliveries.size >= 128) {
      const retired = [...deliveries].find(([, entry]) => entry.settled);
      if (!retired) fail('BUSY');
      deliveries.delete(retired[0]);
    }
    const entry = { fingerprint, settled: false };
    entry.pending = (async () => {
      let session = params.session;
      if (files.length || content.length) {
        const target = await assistant.issues('resume', { id: params.id });
        if (!['success', 'no_op'].includes(target?.outcome) || !target.sessionId
          || session !== undefined && session !== target.issue?.session) {
          return { outcome: 'needs_clarification', code: 'recipient_unavailable' };
        }
        session = `dsh:${target.sessionId}`;
        for (const file of files) {
          const uploaded = await remote.call('fileUploads/upload', target.sessionId, { name: file.name, data: file.data });
          if (typeof uploaded?.receiptId !== 'string' || !/^[\x21-\x7e]{1,512}$/u.test(uploaded.receiptId)) fail('UPSTREAM_UNAVAILABLE');
          content.push({ type: 'file', receiptId: uploaded.receiptId });
        }
      }
      return result(await assistant.issues('forward', {
        id: params.id, text: params.text, ...(session === undefined ? {} : { session }),
        attachments: content, ...(params.retryEntry === undefined ? {} : { retryEntry: params.retryEntry }),
      }));
    })().finally(() => { entry.settled = true; });
    deliveries.set(params.requestId, entry);
    return entry.pending;
  }

  return {
    isSession,
    async context(id, where) {
      requireSession(id);
      if (where !== null && where !== undefined
        && (where?.page !== 'dashboard' && !(where?.page === 'issue' && Number.isSafeInteger(where.id) && where.id > 0))) fail('BAD_REQUEST');
      return assistant.context(where ?? null);
    },
    async dispatch(method, params) {
      requireSession(params.sessionId);
      switch (method) {
        case 'assistant.skills': {
          const value = await remote.call('skills/list', { sessionId: params.sessionId });
          return { skills: (value?.skills ?? []).filter((skill) => typeof skill.name === 'string'
            && skill.userInvocable !== false && skill['user-invocable'] !== false)
            .slice(0, 500).map(({ name, description }) => ({ name, description: typeof description === 'string' ? description : '' })) };
        }
        case 'assistant.recipients': {
          if (typeof params.q !== 'string' || params.q.length > 300) fail('BAD_REQUEST');
          const value = await assistant.issues('recipients', { q: params.q, limit: 50 });
          return {
            outcome: value?.outcome ?? 'error',
            items: (value?.items ?? []).slice(0, 50).map(({ id, ref, title, agent, project, session }) => ({
              id, ref, title, agent, session, project: project?.name ? { name: project.name } : null,
            })),
          };
        }
        case 'assistant.forward': return forward(params);
        default: fail('METHOD_NOT_ALLOWED');
      }
    },
  };
}
