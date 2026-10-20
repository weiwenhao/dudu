import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeechInputController,
  type SpeechRecognitionOptions,
  type SpeechRecognizer,
} from '../src/speech-input.ts';
import type { SpeechUpdate } from '../src/HarnessView.types.ts';

class FakeRecognizer implements SpeechRecognizer {
  permission: Promise<{ granted: boolean }> = Promise.resolve({ granted: true });
  available = true;
  onDeviceAvailable = true;
  locales: { locales?: readonly string[]; installedLocales?: readonly string[] } = {
    locales: ['zh-CN'],
    installedLocales: ['zh-CN'],
  };
  startedWith: SpeechRecognitionOptions[] = [];
  stopCalls = 0;
  abortCalls = 0;
  throwOnStart = false;

  requestPermissions(): Promise<{ granted: boolean }> {
    return this.permission;
  }

  isRecognitionAvailable(): boolean {
    return this.available;
  }

  supportsOnDeviceRecognition(): boolean {
    return this.onDeviceAvailable;
  }

  async getSupportedLocales(): Promise<{
    locales?: readonly string[];
    installedLocales?: readonly string[];
  }> {
    return this.locales;
  }

  start(options: SpeechRecognitionOptions): void {
    if (this.throwOnStart) throw new Error('native start failed');
    this.startedWith.push(options);
  }

  stop(): void {
    this.stopCalls += 1;
  }

  abort(): void {
    this.abortCalls += 1;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeController(
  recognizer = new FakeRecognizer(),
  config: ConstructorParameters<typeof SpeechInputController>[2] = {},
) {
  const updates: SpeechUpdate[] = [];
  const controller = new SpeechInputController(
    recognizer,
    (update) => updates.push(update),
    config,
  );
  return { controller, recognizer, updates };
}

test('release during permission prompt cancels and never starts recognition', async () => {
  const permission = deferred<{ granted: boolean }>();
  const recognizer = new FakeRecognizer();
  recognizer.permission = permission.promise;
  const { controller, updates } = makeController(recognizer);

  const pendingStart = controller.start(11);
  controller.stop(11);
  permission.resolve({ granted: true });
  await pendingStart;

  assert.equal(recognizer.startedWith.length, 0);
  assert.deepEqual(
    updates.map(({ state }) => state),
    ['preparing', 'cancelled'],
  );
});

test('uses Chinese interim and continuous results, merges duplicate finals once, then completes once', async () => {
  const { controller, recognizer, updates } = makeController();
  await controller.start(12);

  assert.deepEqual(recognizer.startedWith[0], {
    lang: 'zh-CN',
    interimResults: true,
    continuous: true,
    maxAlternatives: 1,
    addsPunctuation: true,
    requiresOnDeviceRecognition: true,
    volumeChangeEventOptions: {
      enabled: true,
      intervalMillis: 100,
    },
  });

  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '你好' }],
  });
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '好世界' }],
  });
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '好世界' }],
  });
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '你好世界，继续' }],
  });

  controller.stop(12);
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '你好世界，继续' }],
  });
  controller.onRecognizerEnd();
  controller.onRecognizerEnd();

  const completed = updates.filter(({ state }) => state === 'complete');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].text, '你好世界，继续');
  assert.equal(recognizer.stopCalls, 1);
});

test('normalizes volume levels only while actively listening and stops after native end', async () => {
  const { controller, updates } = makeController();
  await controller.start(24);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '保留识别文本' }],
  });

  controller.onRecognizerVolumeChange({ value: -2 });
  controller.onRecognizerVolumeChange({ value: 4 });
  controller.onRecognizerVolumeChange({ value: 10 });
  controller.onRecognizerVolumeChange({ value: -20 });
  controller.onRecognizerVolumeChange({ value: 20 });
  controller.onRecognizerVolumeChange({ value: Number.NaN });

  const meterUpdates = updates.filter(
    (update): update is typeof update & { level: number } =>
      'level' in update,
  );
  assert.deepEqual(
    meterUpdates.map(({ id, state, level }) => ({ id, state, level })),
    [
      { id: 24, state: 'listening', level: 0 },
      { id: 24, state: 'listening', level: 0.5 },
      { id: 24, state: 'listening', level: 1 },
      { id: 24, state: 'listening', level: 0 },
      { id: 24, state: 'listening', level: 1 },
    ],
  );
  assert.equal(meterUpdates.some(({ text }) => text !== undefined), false);

  controller.onRecognizerEnd();
  controller.onRecognizerVolumeChange({ value: 4 });
  assert.equal(
    updates.filter((update) => 'level' in update).length,
    meterUpdates.length,
  );
  assert.equal(
    updates.some(({ id, state }) => id === 24 && state === 'complete'),
    false,
  );
  controller.stop(24);
  assert.equal(
    updates.filter((update) => 'level' in update).length,
    meterUpdates.length,
  );
  assert.deepEqual(
    updates.filter(({ id, state }) => id === 24 && state === 'complete'),
    [{ id: 24, state: 'complete', text: '保留识别文本' }],
  );
});

test('does not emit volume levels while processing or after cancellation', async () => {
  const { controller, updates } = makeController();
  await controller.start(25);
  controller.stop(25);
  controller.onRecognizerVolumeChange({ value: 5 });
  assert.equal(updates.some((update) => 'level' in update), false);

  controller.cancel(25);
  controller.onRecognizerVolumeChange({ value: 5 });
  assert.equal(updates.some((update) => 'level' in update), false);

  controller.onRecognizerEnd();
  await controller.start(26);
  controller.onRecognizerVolumeChange({ value: 4 });
  assert.deepEqual(
    updates.filter((update) => update.id === 26 && 'level' in update),
    [{ id: 26, state: 'listening', level: 0.5 }],
  );
  controller.cancel(26);
  controller.onRecognizerEnd();
});

test('falls back to the system recognizer when zh-CN is not installed for on-device use', async () => {
  const recognizer = new FakeRecognizer();
  recognizer.locales = {
    locales: ['zh-CN'],
    installedLocales: [],
  };
  const { controller } = makeController(recognizer);

  await controller.start(13);

  assert.equal(recognizer.startedWith[0].requiresOnDeviceRecognition, false);
  controller.cancel(13);
  controller.onRecognizerEnd();
});

test('cancel discards results and blocks a new session until the old native session ends', async () => {
  const { controller, recognizer, updates } = makeController();
  await controller.start(14);
  controller.cancel(14);
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '不得提交' }],
  });

  await controller.start(15);
  assert.equal(recognizer.startedWith.length, 1);
  assert.equal(
    updates.find((update) => update.id === 15)?.message,
    '语音识别正在结束，请稍后重试',
  );

  controller.onRecognizerEnd();
  await controller.start(15);
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '新会话' }],
  });
  controller.stop(15);
  controller.onRecognizerEnd();

  const completed = updates.filter(({ state }) => state === 'complete');
  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0], {
    id: 15,
    state: 'complete',
    text: '新会话',
  });
  assert.equal(recognizer.abortCalls, 1);
});

test('permission denial and recognizer interruption report concise errors without completion', async () => {
  const denied = new FakeRecognizer();
  denied.permission = Promise.resolve({ granted: false });
  const first = makeController(denied);
  await first.controller.start(16);

  assert.equal(first.updates.at(-1)?.state, 'error');
  assert.equal(first.updates.at(-1)?.message, '请允许使用麦克风和语音识别');
  assert.equal(denied.startedWith.length, 0);

  const interrupted = makeController();
  await interrupted.controller.start(17);
  interrupted.controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '不可提交的 partial' }],
  });
  interrupted.controller.onRecognizerError({ error: 'interrupted' });
  interrupted.controller.onRecognizerEnd();

  assert.equal(interrupted.updates.at(-1)?.state, 'error');
  assert.equal(interrupted.updates.at(-1)?.message, '语音输入已中断');
  assert.equal(
    interrupted.updates.some(({ state }) => state === 'complete'),
    false,
  );
  assert.equal(interrupted.recognizer.abortCalls, 1);
});

test('native end waits for finger release, while cancel and no-match never complete partial text', async () => {
  const { controller, recognizer, updates } = makeController();
  await controller.start(19);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '松手前仍可取消' }],
  });
  controller.onRecognizerEnd();

  assert.equal(
    updates.some(({ state }) => state === 'complete'),
    false,
  );
  controller.cancel(19);
  assert.equal(recognizer.abortCalls, 0);

  await controller.start(20);
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '松手后提交' }],
  });
  controller.onRecognizerEnd();
  assert.equal(
    updates.some(({ id, state }) => id === 20 && state === 'complete'),
    false,
  );
  controller.stop(20);
  assert.deepEqual(updates.filter(({ id, state }) => id === 20 && state === 'complete'), [
    { id: 20, state: 'complete', text: '松手后提交' },
  ]);
  assert.equal(recognizer.stopCalls, 0);

  await controller.start(21);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: 'nomatch 不能提交' }],
  });
  controller.onRecognizerNoMatch();
  controller.onRecognizerEnd();
  controller.stop(21);

  const noMatchUpdates = updates.filter(({ id }) => id === 21);
  assert.deepEqual(noMatchUpdates.at(-1), { id: 21, state: 'cancelled' });
  assert.equal(
    updates.some(({ id, state }) => id === 21 && state === 'complete'),
    false,
  );
});

test('a thrown native start reports an error and aborts the recognizer', async () => {
  const recognizer = new FakeRecognizer();
  recognizer.throwOnStart = true;
  const { controller, updates } = makeController(recognizer);

  await controller.start(22);

  assert.equal(recognizer.abortCalls, 1);
  assert.equal(updates.at(-1)?.state, 'error');
  assert.equal(updates.at(-1)?.message, '语音识别启动失败，请重试');
  controller.onRecognizerEnd();
});

test('nomatch during finalization cancels partial text without feedback', async () => {
  const { controller, recognizer, updates } = makeController(
    new FakeRecognizer(),
    { finalizationTimeoutMs: 5 },
  );
  await controller.start(23);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: 'partial 不能自动发送' }],
  });
  controller.stop(23);
  controller.onRecognizerNoMatch();
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.onRecognizerEnd();

  assert.equal(
    updates.some(({ id, state }) => id === 23 && state === 'complete'),
    false,
  );
  assert.deepEqual(updates.at(-1), { id: 23, state: 'cancelled' });
  assert.equal(recognizer.abortCalls, 1);
});

test('the recording limit stops the microphone but waits for finger release to submit', async () => {
  for (const nativeEndFirst of [false, true]) {
    const { controller, recognizer, updates } = makeController(
      new FakeRecognizer(),
      { maxDurationMs: 5 },
    );
    await controller.start(30);
    controller.onRecognizerResult({
      isFinal: false,
      results: [{ transcript: '仍按住时不能发送' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(recognizer.stopCalls, 1);
    assert.equal(updates.some(({ state }) => state === 'complete' || state === 'processing'), false);

    if (nativeEndFirst) controller.onRecognizerEnd();
    assert.equal(updates.some(({ state }) => state === 'complete'), false);
    controller.stop(30);
    if (!nativeEndFirst) controller.onRecognizerEnd();

    assert.equal(recognizer.stopCalls, 1);
    assert.deepEqual(updates.filter(({ state }) => state === 'complete'), [
      { id: 30, state: 'complete', text: '仍按住时不能发送' },
    ]);
  }
});

test('an empty final result clears unconfirmed interim text and cancels quietly', async () => {
  const { controller, updates } = makeController();
  await controller.start(31);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '临时文本不可发送' }],
  });
  controller.onRecognizerResult({ isFinal: true, results: [] });

  assert.equal(updates.at(-1)?.text, '');
  controller.onRecognizerEnd();
  controller.stop(31);
  assert.deepEqual(updates.at(-1), { id: 31, state: 'cancelled' });
  assert.equal(updates.some(({ state }) => state === 'complete' || state === 'error'), false);
});

test('nomatch cannot be reversed by a delayed final result and the next recording can start', async () => {
  const { controller, recognizer, updates } = makeController();
  await controller.start(32);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '临时结果' }],
  });
  controller.onRecognizerNoMatch();
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '迟到结果不能撤销取消' }],
  });
  controller.onRecognizerEnd();
  controller.stop(32);

  assert.deepEqual(updates.at(-1), { id: 32, state: 'cancelled' });
  assert.equal(updates.some(({ state }) => state === 'complete' || state === 'error'), false);
  assert.equal(recognizer.abortCalls, 1);
  await controller.start(33);
  assert.equal(recognizer.startedWith.length, 2);
  controller.cancel(33);
  controller.onRecognizerEnd();
});

test('silence ends quietly without an error message or a transcript', async () => {
  for (const nativeEndFirst of [false, true]) {
    const { controller, recognizer, updates } = makeController();
    await controller.start(27);
    if (nativeEndFirst) controller.onRecognizerEnd();
    controller.stop(27);
    if (!nativeEndFirst) controller.onRecognizerEnd();

    assert.deepEqual(updates.at(-1), { id: 27, state: 'cancelled' });
    assert.equal(updates.some(({ state }) => state === 'error' || state === 'complete'), false);
    assert.equal(recognizer.abortCalls, 0);
  }
});

test('native no-speech discards interim text and ignores delayed results', async () => {
  const { controller, recognizer, updates } = makeController();
  await controller.start(28);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '不可发送的临时识别' }],
  });
  controller.onRecognizerError({ error: 'no-speech' });
  controller.onRecognizerResult({
    isFinal: true,
    results: [{ transcript: '迟到的结果' }],
  });
  controller.onRecognizerEnd();
  controller.stop(28);

  assert.deepEqual(updates.at(-1), { id: 28, state: 'cancelled' });
  assert.equal(updates.some(({ state }) => state === 'error' || state === 'complete'), false);
  assert.equal(recognizer.abortCalls, 1);
});

test('empty finalization timeout cancels quietly and releases the recognizer', async () => {
  const { controller, recognizer, updates } = makeController(
    new FakeRecognizer(),
    { finalizationTimeoutMs: 5 },
  );
  await controller.start(29);
  controller.stop(29);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.onRecognizerEnd();

  assert.deepEqual(updates.at(-1), { id: 29, state: 'cancelled' });
  assert.equal(updates.some(({ state }) => state === 'error' || state === 'complete'), false);
  assert.equal(recognizer.abortCalls, 1);
});

test('finalization timeout completes available transcript once and aborts native recognition', async () => {
  const { controller, recognizer, updates } = makeController(
    new FakeRecognizer(),
    { finalizationTimeoutMs: 5 },
  );
  await controller.start(18);
  controller.onRecognizerResult({
    isFinal: false,
    results: [{ transcript: '保留这段识别结果' }],
  });
  controller.stop(18);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.onRecognizerEnd();

  const completed = updates.filter(({ state }) => state === 'complete');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].text, '保留这段识别结果');
  assert.equal(recognizer.abortCalls, 1);
});
