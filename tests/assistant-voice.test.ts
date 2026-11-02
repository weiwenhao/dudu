import assert from 'node:assert/strict';
import test from 'node:test';
import { pcmWav, readySpeech } from '../host/dudu-plugin/ui/pet/voice.mjs';

test('voice uses only a configured, usable DSH recognizer and its declared recording limits', () => {
  const catalog = {
    selection: { providerId: 'local', language: 'zh' }, maxDurationSeconds: 60, maxAudioBytes: 100000,
    providers: [{ id: 'local', preparation: { phase: 'unprepared' } }],
  };
  assert.equal(readySpeech(null), false);
  assert.equal(readySpeech(catalog), false);
  for (const phase of ['ready', 'standby', 'waking']) {
    const usable = { ...catalog, providers: [{ id: 'local', preparation: { phase } }] };
    assert.equal(readySpeech(usable), true);
    assert.equal(readySpeech({ ...usable, maxAudioBytes: 44 }), false);
    assert.equal(readySpeech({ ...usable, maxDurationSeconds: Infinity }), false);
    assert.equal(readySpeech({ ...usable, selection: { providerId: 'other' } }), false);
  }
});

test('recordings encode bounded PCM16 mono WAV at 16 kHz with clipped samples', () => {
  const samples = new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN]);
  const bytes = pcmWav(samples, 60);
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint32(4, true), 52);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.deepEqual(Array.from({ length: samples.length }, (_, n) => view.getInt16(44 + n * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0]);
  assert.throws(() => pcmWav(samples, 59), /exceeds/);
});
