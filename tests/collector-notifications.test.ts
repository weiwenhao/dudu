import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollectorNotifications } from '../host/assistant/collectors/notifications.mjs';
import { LONG_POLL_MS } from '../host/long-poll.mjs';
import { allowCollectorNotifications, installCollectorNotifications } from '../host/dudu-plugin/ui/collector/notifications.js';
import { allowedAction } from '../host/phone-pages.mjs';

const decoder = new TextDecoder();
const collector = { id: 'mentions', name: '飞书 @我', notify: true };
const record = { id: 1, title: '发布确认', text: '请确认生产配置。' };

test('the notification feed is opt-in, live-only and sanitized, with the final version of each row', async () => {
  const feed = createCollectorNotifications();
  feed.publish(collector, [{ ...record, title: '历史记录' }]);
  const response = feed.follow();
  const reader = response.body!.getReader();
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  const header = JSON.parse(decoder.decode((await reader.read()).value));
  assert.deepEqual([typeof header.epoch, header.head], ['string', 1], 'it says where the feed is, and subscribing never replays history');
  feed.publish({ ...collector, notify: false }, [{ ...record, title: '关闭通知' }]);
  feed.publish(collector, []);
  feed.publish(collector, [record, { ...record, title: '已确认', text: 'token sk-test-0123456789abcdefghijklmnop' }]);
  const event = JSON.parse(decoder.decode((await reader.read()).value));
  assert.equal(event.title, collector.name);
  assert.equal(event.collector, collector.id);
  assert.ok(event.body.startsWith('已确认\n'));
  assert.ok(!event.body.includes(record.title));
  assert.ok(!event.body.includes('sk-test-0123456789abcdefghijklmnop'));
  assert.deepEqual(Object.keys(event).sort(), ['body', 'collector', 'id', 'title'], 'no severity or attachment');
  await reader.cancel();
  assert.doesNotThrow(() => feed.publish(collector, [record]));
  feed.close();
  assert.equal(feed.follow().status, 503);
  assert.equal(allowedAction('inbox/notifications'), false, 'phone settings cannot subscribe to desktop notifications');
});

test('request cancellation and plugin disposal finish notification streams', async () => {
  const feed = createCollectorNotifications();
  const controller = new AbortController();
  const first = feed.follow(controller.signal).body!.getReader();
  const second = feed.follow().body!.getReader();
  await first.read();
  await second.read();
  const aborted = first.read();
  controller.abort();
  assert.equal((await aborted).done, true);
  const ended = second.read();
  feed.close();
  feed.close();
  assert.equal((await ended).done, true);
  assert.doesNotThrow(() => feed.publish(collector, [record]));
});

// 2026-11-19: DSH installs an update of itself only when no /api request is in flight, and waits 10 s for them. A stream that stays open as long as the page made every attempt fail.
test('a stream ends by itself after a few seconds, and the next one goes on from where the page stopped', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const lines = async (response: Response) => {
    const reader = response.body!.getReader();
    const found: any[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return found;
      found.push(...decoder.decode(value).split('\n').filter(Boolean).map((line) => JSON.parse(line)));
    }
  };
  const feed = createCollectorNotifications();
  const first = lines(feed.follow());
  await settle();
  feed.publish(collector, [record]);
  context.mock.timers.tick(LONG_POLL_MS);
  const [header, live] = await first;
  assert.equal(live.body, `${record.title}\n${record.text}`, 'what comes while a stream is open is sent at once');

  // Between two streams nothing is open: what is collected then waits for the page's next stream.
  feed.publish(collector, [{ ...record, id: 2, title: '第二条', text: '第二条正文' }]);
  const next = lines(feed.follow(undefined, { epoch: header.epoch, after: live.id }));
  await settle();
  context.mock.timers.tick(LONG_POLL_MS);
  const [again, missed, ...more] = await next;
  assert.deepEqual([again.epoch, missed.body, more.length], [header.epoch, '第二条\n第二条正文', 0]);

  // A page that was asking an earlier run of the plugin, or that never asked, gets nothing of the past.
  for (const where of [{ epoch: 'an-earlier-run', after: 0 }, {}, undefined]) {
    const answer = lines(feed.follow(undefined, where));
    await settle();
    context.mock.timers.tick(LONG_POLL_MS);
    assert.equal((await answer).length, 1, 'only the line saying where the feed is');
  }
  feed.close();
});

function notificationClass() {
  class Notice {
    static permission = 'granted';
    static permissionRequests = 0;
    static async requestPermission() { this.permissionRequests++; return this.permission; }
    static shown: Notice[] = [];
    static receive: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onclick: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    title: string;
    options: any;
    constructor(title: string, options: any) {
      this.title = title;
      this.options = options;
      Notice.shown.push(this);
      Notice.receive?.();
    }
    close() { this.closed = true; this.onclose?.(); }
  }
  return Notice;
}

test('the desktop listener does not request permission; enabling is explicit and a denied permission stays off', async () => {
  const target = new EventTarget();
  const Notice = notificationClass();
  Notice.permission = 'default';
  let connections = 0;
  const feed = createCollectorNotifications();
  const stop = installCollectorNotifications({
    target, NotificationClass: Notice, baseURI: 'https://desktop.test/',
    fetchFn: async (_url: any, options: any) => { connections++; return feed.follow(options.signal); },
  });
  assert.equal(connections, 0);
  assert.equal(Notice.permissionRequests, 0);
  Notice.requestPermission = async () => { Notice.permissionRequests++; Notice.permission = 'granted'; return 'granted'; };
  assert.equal(await allowCollectorNotifications({ target, NotificationClass: Notice }), true);
  assert.equal(connections, 1);
  target.dispatchEvent(new Event('focus'));
  target.dispatchEvent(new Event('online'));
  assert.equal(connections, 1, 'one stream per plugin lifetime');
  stop();
  feed.close();
  Notice.permission = 'denied';
  assert.equal(await allowCollectorNotifications({ target, NotificationClass: Notice }), false);
  assert.equal(Notice.permissionRequests, 1, 'denied permission is not requested again automatically');
});

test('the desktop listener decodes split UTF-8 events, opens the dashboard on click and stops on disposal', async () => {
  const target = Object.assign(new EventTarget(), { focus: () => { focused++; } });
  const Notice = notificationClass();
  let focused = 0;
  let opened = 0;
  let signal: AbortSignal;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const stop = installCollectorNotifications({
    target, NotificationClass: Notice, baseURI: 'https://desktop.test/base/',
    fetchFn: async (url: any, options: any) => {
      assert.equal(url, '/base/api/dudu/inbox/notifications');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.method, 'POST');
      signal = options.signal;
      signal.addEventListener('abort', () => controller.close(), { once: true });
      return new Response(stream);
    },
    onOpen: () => { opened++; },
  });
  const received = new Promise<void>((resolve) => { Notice.receive = resolve; });
  const bytes = new TextEncoder().encode(`${JSON.stringify({ collector: collector.id, title: collector.name, body: record.text })}\n`);
  const split = bytes.findIndex((byte) => byte > 127) + 1;
  controller!.enqueue(bytes.slice(0, split));
  controller!.enqueue(bytes.slice(split));
  await received;
  const notice = Notice.shown[0];
  assert.equal(notice.title, collector.name);
  assert.deepEqual(notice.options, { body: record.text, tag: 'dudu:collector:mentions' });
  notice.onclick!();
  assert.deepEqual([focused, opened, notice.closed], [1, 1, true]);
  stop();
  assert.equal(signal!.aborted, true);
  target.dispatchEvent(new Event('focus'));
  notice.onclick!();
  assert.deepEqual([focused, opened], [1, 1], 'disposed plugins cannot navigate');
});

test('the desktop listener asks again when a stream ends, from where the last one stopped, and shows each event once', async () => {
  const target = new EventTarget();
  const Notice = notificationClass();
  const asked: string[] = [];
  const encoder = new TextEncoder();
  const answer = (...messages: object[]) => new Response(encoder.encode(messages.map((message) => `${JSON.stringify(message)}\n`).join('')));
  const answers = [
    answer({ epoch: 'run', head: 4 }, { id: 5, collector: 'a', title: 'A', body: 'first' }),
    answer({ epoch: 'run', head: 6 }, { id: 6, collector: 'b', title: 'B', body: 'second' }),
  ];
  const both = new Promise<void>((resolve) => { Notice.receive = () => { if (Notice.shown.length === 2) resolve(); }; });
  let askedThrice!: () => void;
  const third = new Promise<void>((resolve) => { askedThrice = resolve; });
  let hang!: ReadableStreamDefaultController<Uint8Array>;
  const stop = installCollectorNotifications({
    target, NotificationClass: Notice, baseURI: 'https://desktop.test/',
    fetchFn: async (_url: any, options: any) => {
      asked.push(options.body);
      if (asked.length === 3) askedThrice();
      const next = answers.shift();
      if (next) return next;
      options.signal.addEventListener('abort', () => hang.close(), { once: true });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { hang = controller; } }));
    },
  });
  await Promise.all([both, third]);
  stop();
  assert.deepEqual(asked.slice(0, 3), ['{}', '{"epoch":"run","after":5}', '{"epoch":"run","after":6}']);
  assert.deepEqual(Notice.shown.map((notice) => notice.title), ['A', 'B']);
});

test('a notification connection failure logs once and has no automatic retry loop', async () => {
  const target = new EventTarget();
  const Notice = notificationClass();
  let requests = 0;
  const warnings: string[] = [];
  let warned: () => void;
  const failure = new Promise<void>((resolve) => { warned = resolve; });
  const stop = installCollectorNotifications({
    target, NotificationClass: Notice, baseURI: 'https://desktop.test/',
    fetchFn: async () => { requests++; throw new Error('offline'); },
    warn: (message: string) => { warnings.push(message); warned(); },
  });
  await failure;
  assert.equal(requests, 1);
  assert.equal(warnings.length, 1);
  stop();
});
