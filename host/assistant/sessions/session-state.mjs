// Presentation only. Execution lifecycle (states.mjs) owns stopping, resuming and sleep safety.
export const SESSION_ACTIVITY_STATES = Object.freeze(['idle', 'processing', 'unread']);
export const ISSUE_SESSION_STATES = Object.freeze([...SESSION_ACTIVITY_STATES, 'unassigned']);

export function sessionStateForActivity(live, activity) {
  const derived = SESSION_ACTIVITY_STATES.includes(activity?.sessionState);
  const pending = live?.pendingInteraction || (!derived && activity?.state === 'waiting_owner');
  const running = live?.running || (derived ? activity.sessionState === 'processing' : activity?.state === 'running');
  if (running && !pending) return 'processing';
  return activity?.sessionState === 'unread' ? 'unread' : 'idle';
}

// A content fingerprint, not authentication. The event sequence is the durable position.
// Shared with the desktop's transient stream fold.
export function contentDigest(content) {
  const value = (content ?? []).flatMap((block) => {
    if (block?.type === 'text' && block.text) return [block.text];
    if (block?.type === 'image') return [`\uFFFC${block.source?.attachmentId ?? block.url ?? ''}`];
    return [];
  }).join('');
  if (!value) return null;
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return `${value.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

export const EMPTY_ATTENTION = Object.freeze({ seq: -1, at: 0, kind: 'none', turn: -1, step: -1, digest: '' });

/** Ordering of projection observations, independent of the published unread/message boundary. */
export const activityRevision = (value) => Math.max(value?.seq ?? -1, value?.through ?? -1, value?.pending?.seq ?? -1);

/** Only owner-visible incoming content moves the unread boundary. Tool/usage/compaction events do not. */
export function attentionForEvent(event) {
  if (!Number.isSafeInteger(event?.seq) || event.seq < 0) return null;
  const data = event.data ?? {};
  let kind;
  let digest = '';
  if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
    digest = contentDigest(data.message?.content);
    if (!digest) return null;
    kind = 'message';
  } else if (event.type === 'turn/end' && ['error', 'failed'].includes(data.reason?.kind)) {
    kind = 'error';
  } else if (event.type === 'approval/asked' || (event.type === 'tool/call' && data.name === 'ask_user_question')) {
    kind = 'question';
  } else return null;
  return {
    seq: event.seq, at: Number.isFinite(event.time) ? event.time : 0, kind,
    turn: Number.isSafeInteger(data.turn) ? data.turn : -1,
    step: Number.isSafeInteger(data.step) ? data.step : -1,
    digest,
  };
}

export function streamWasRead(attention, stream) {
  return attention?.kind === 'message' && attention.turn >= 0 && attention.step >= 0
    && attention.turn === stream?.turn && attention.step === stream?.step
    && Boolean(attention.digest) && attention.digest === stream.digest;
}

export function hasUnread(attention, read) {
  return Boolean(attention && attention.seq > (read?.seq ?? -1) && !streamWasRead(attention, read?.stream));
}
