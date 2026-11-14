import { createHash } from 'node:crypto';

export const NATIVE_ASSISTANT_METHODS = Object.freeze([
  'assistant.skills', 'assistant.recipients', 'assistant.forward', 'assistant.card', 'assistant.hide',
  'assistant.todos', 'assistant.reply.read', 'assistant.reply.image',
]);

// The quick buttons of the chat: what a card can list. The card itself comes back in the thread, as the command's two events (assistant/home/cards.mjs).
const CARD_KINDS = new Set(['todo', 'info', 'task']);

// These are the desktop assistant's own actions, reached only through authenticated native RPC.
// No caller-selected route, arbitrary command or general DSH proxy is exposed.
export function createNativeAssistant({ assistant, remote, fail, attachments, fileBytes, readSession, readImage }) {
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
      // Written in 嘟嘟's chat: the line comes into that thread too, and its answer after it (home/group.mjs).
      return result(await assistant.issues('forward', {
        id: params.id, text: params.text, chat: true, ...(session === undefined ? {} : { session }),
        attachments: content, ...(params.retryEntry === undefined ? {} : { retryEntry: params.retryEntry }),
      }));
    })().finally(() => { entry.settled = true; });
    deliveries.set(params.requestId, entry);
    return entry.pending;
  }

  return {
    isSession,
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
        case 'assistant.todos': {
          if (params.cursor !== undefined && (typeof params.cursor !== 'string' || !params.cursor || params.cursor.length > 200)) fail('BAD_REQUEST');
          if (typeof assistant.todos !== 'function') fail('UNSUPPORTED');
          const list = await assistant.todos(params.cursor);
          if (!Array.isArray(list?.rows)) fail('UPSTREAM_UNAVAILABLE');
          return { outcome: 'success', total: list.total, rows: list.rows, nextCursor: list.nextCursor ?? null };
        }
        case 'assistant.reply.read':
        case 'assistant.reply.image': {
          // A sheet may read only the issue/session pair it opened. It neither changes the selected session nor replaces its watch.
          if (!Number.isSafeInteger(params.id) || params.id < 1 || typeof params.session !== 'string'
            || !/^dsh:.{1,256}$/u.test(params.session)) fail('BAD_REQUEST');
          const found = await assistant.issues('get', { id: params.id, logLimit: 1 });
          if (found?.outcome !== 'success' || found.issue?.session !== params.session) fail('NOT_FOUND');
          const readingImage = method === 'assistant.reply.image';
          const read = readingImage ? readImage : readSession;
          if (typeof read !== 'function') fail('UNSUPPORTED');
          const detail = await read(params.session.slice(4), {
            attachmentId: params.attachmentId, seq: params.seq, source: params.source,
          });
          const current = await assistant.issues('get', { id: params.id, logLimit: 1 });
          if (current?.outcome !== 'success' || current.issue?.session !== params.session) fail('NOT_FOUND');
          if (readingImage) return detail;
          return {
            session: detail.session, messages: detail.messages.filter((message) => ['user', 'assistant'].includes(message.role)),
            queuedMessages: detail.queuedMessages,
            acceptedRequestIds: detail.acceptedRequestIds ?? [],
            canceledRequestIds: detail.canceledRequestIds ?? [],
          };
        }
        case 'assistant.card': {
          if (!CARD_KINDS.has(params.kind)) fail('BAD_REQUEST');
          // `since`: the card the phone sees at the end of the thread (nothing but cards after it); a tap that would only repeat it makes nothing new.
          if (params.since != null && (typeof params.since !== 'string' || !params.since || params.since.length > 128)) fail('BAD_REQUEST');
          if (typeof assistant.card !== 'function') fail('UNSUPPORTED');
          const made = await assistant.card(params.kind, params.since ?? undefined);
          return {
            outcome: made?.outcome ?? 'error',
            ...(made?.code ? { code: made.code } : {}),
            ...(typeof made?.commandId === 'string' ? { commandId: made.commandId } : {}),
            ...(made?.unchanged === true ? { unchanged: true } : {}),
          };
        }
        case 'assistant.hide': {
          // Lines of the thread, by the sequence number of their event: only what the interface shows is hidden (the session's log and what 嘟嘟 was told stay).
          if (!Array.isArray(params.seqs) || !params.seqs.length || params.seqs.length > 50 || !params.seqs.every((seq) => Number.isSafeInteger(seq) && seq >= 0)) fail('BAD_REQUEST');
          if (typeof assistant.hide !== 'function') fail('UNSUPPORTED');
          const hidden = await assistant.hide(params.seqs);
          return { outcome: hidden?.outcome ?? 'error' };
        }
        default: fail('METHOD_NOT_ALLOWED');
      }
    },
  };
}
