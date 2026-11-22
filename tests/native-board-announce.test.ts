import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardAnnounce } from '../host/native-board-announce.mjs';

const message = (over: any = {}) => ({ id: 'dsh-1', unread: true, attention: { kind: 'message', at: 1_000, preview: 'Done.\n\nThe  shadow is in.' }, ...over });

test('only a reply or a question that nobody has read is announced, as the conversation’s name and what it said', () => {
  const sent: any[] = [];
  const announce = createBoardAnnounce({
    announce: (event: any) => sent.push(event), now: () => 2_000,
    conversationOf: (id: string) => (id === 'dsh-1' ? { id: 'issue:12', title: 'nature main' } : id === 'dsh-assistant' ? { id: 'assistant', title: '嘟嘟' } : null),
  });
  announce.content(message());
  assert.deepEqual(sent.splice(0), [{ conversationId: 'issue:12', title: 'nature main', body: 'Done. The shadow is in.' }]);
  announce.content(message({ unread: false }));
  announce.content(message({ attention: { kind: 'error', at: 1_000, preview: 'x' } }));
  announce.content(message({ id: 'a-collector-session' }));
  assert.deepEqual(sent, [], 'read, failed and unknown sessions say nothing');
  announce.content(message({ attention: { kind: 'question', at: 1_000, preview: 'an older answer' } }));
  assert.deepEqual(sent.splice(0).map((event: any) => [event.title, event.body]), [['nature main', '']], 'a question is the conversation’s name alone: the preview would be an old answer');
  announce.content(message({ id: 'dsh-assistant' }));
  assert.equal(sent.splice(0)[0].conversationId, 'assistant');
  announce.content(message({ baseline: true, attention: { kind: 'message', at: 2_000 - 61_000, preview: 'old' } }));
  assert.deepEqual(sent, [], 'the first thing seen of a session, if it is old, is not news');
  announce.content(message({ baseline: true, attention: { kind: 'message', at: 2_000 - 5_000, preview: 'just now' } }));
  assert.equal(sent.splice(0)[0].body, 'just now', 'but an answer that came while the plugin was starting is');
});
