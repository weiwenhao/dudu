// DSH accepts PCM16 mono WAV at 16 kHz. Recognition is used only after the owner configured a ready provider.
export function readySpeech(catalog) {
  const provider = catalog?.providers?.find((item) => item.id === catalog.selection?.providerId);
  return ['ready', 'standby', 'waking'].includes(provider?.preparation?.phase) &&
    Number.isFinite(catalog.maxDurationSeconds) && catalog.maxDurationSeconds > 0 &&
    Number.isFinite(catalog.maxAudioBytes) && catalog.maxAudioBytes >= 46;
}

export function pcmWav(samples, maxBytes) {
  if (44 + samples.length * 2 > maxBytes) throw new Error('The recording exceeds the speech limit.');
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const word = (offset, text) => { for (let n = 0; n < text.length; n++) bytes[offset + n] = text.charCodeAt(n); };
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE');
  word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}

export function recordSpeech(catalog, transcribe) {
  if (!readySpeech(catalog) || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Speech recording is unavailable.');
  const abort = new AbortController();
  const chunks = [];
  let recorder;
  let stream;
  let timer;
  let finished;
  let released = false;
  let cancelled = false;
  let stopped;
  const settled = new Promise((resolve, reject) => { stopped = { resolve, reject }; });
  // Attach the rejection handler immediately, including when permission is still pending on key release.
  void settled.catch(() => {});
  const releaseTracks = () => { for (const track of stream?.getTracks() ?? []) track.stop(); };
  const start = navigator.mediaDevices.getUserMedia({ audio: true }).then((value) => {
    stream = value;
    if (released || cancelled) { releaseTracks(); stopped.resolve(); return; }
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { releaseTracks(); stopped.reject(new Error('Speech recording failed.')); };
    recorder.onstop = () => { releaseTracks(); stopped.resolve(); };
    recorder.start();
    timer = setTimeout(() => { void stop().catch(() => {}); }, catalog.maxDurationSeconds * 1000);
  }).catch((error) => { releaseTracks(); stopped.reject(error); throw error; });
  void start.catch(() => {});

  async function stop(cancel = false) {
    released = true;
    if (cancel) { cancelled = true; abort.abort(); releaseTracks(); }
    clearTimeout(timer);
    if (finished) return finished;
    finished = (async () => {
      await start;
      if (recorder?.state !== 'inactive' && recorder) recorder.stop();
      await settled;
      if (cancelled || !chunks.length) return '';
      const context = new AudioContext();
      let decoded;
      try { decoded = await context.decodeAudioData(await new Blob(chunks).arrayBuffer()); }
      finally { await context.close(); }
      if (cancelled) return '';
      const frames = Math.min(Math.floor(decoded.duration * 16000), Math.floor(catalog.maxDurationSeconds * 16000), Math.floor((catalog.maxAudioBytes - 44) / 2));
      if (frames < 1) return '';
      const offline = new OfflineAudioContext(1, frames, 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const audio = await offline.startRendering();
      if (cancelled) return '';
      const bytes = pcmWav(audio.getChannelData(0), catalog.maxAudioBytes);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      const result = await transcribe({
        audioBase64: btoa(binary), providerId: catalog.selection.providerId, language: catalog.selection.language,
      }, abort.signal);
      return cancelled ? '' : result.text ?? '';
    })().finally(releaseTracks);
    return finished;
  }
  return { started: start, stop };
}
