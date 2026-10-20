import type { SpeechUpdate } from './HarnessView.types';

export type SpeechRecognitionOptions = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  addsPunctuation: boolean;
  requiresOnDeviceRecognition: boolean;
  volumeChangeEventOptions: {
    enabled: boolean;
    intervalMillis: number;
  };
};

export type SpeechRecognitionResultEvent = {
  isFinal: boolean;
  results: readonly { transcript: string }[];
};

export type SpeechRecognitionVolumeEvent = {
  value: number;
};

export type SpeechRecognitionErrorEvent = {
  error: string;
};

export type SpeechRecognizer = {
  requestPermissions(): Promise<{ granted: boolean }>;
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  getSupportedLocales(): Promise<{
    locales?: readonly string[];
    installedLocales?: readonly string[];
  }>;
  start(options: SpeechRecognitionOptions): void;
  stop(): void;
  abort(): void;
};

export type SpeechInputControllerConfig = {
  maxDurationMs?: number;
  finalizationTimeoutMs?: number;
};

type Session = {
  id: number;
  phase: 'preparing' | 'listening' | 'processing';
  nativeStarted: boolean;
  nativeEnded: boolean;
  nativeStopRequested: boolean;
  finalText: string;
  interimText: string;
  maxDurationTimer?: ReturnType<typeof setTimeout>;
  finalizationTimer?: ReturnType<typeof setTimeout>;
};

const DEFAULT_MAX_DURATION_MS = 60_000;
const DEFAULT_FINALIZATION_TIMEOUT_MS = 8_000;

export class SpeechInputController {
  private active: Session | null = null;
  private draining = false;
  private drainTimer?: ReturnType<typeof setTimeout>;

  private readonly recognizer: SpeechRecognizer;
  private onUpdate: (update: SpeechUpdate) => void;
  private readonly maxDurationMs: number;
  private readonly finalizationTimeoutMs: number;

  constructor(
    recognizer: SpeechRecognizer,
    onUpdate: (update: SpeechUpdate) => void,
    config: SpeechInputControllerConfig = {},
  ) {
    this.recognizer = recognizer;
    this.onUpdate = onUpdate;
    this.maxDurationMs = config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.finalizationTimeoutMs =
      config.finalizationTimeoutMs ?? DEFAULT_FINALIZATION_TIMEOUT_MS;
  }

  setUpdateHandler(onUpdate: (update: SpeechUpdate) => void): void {
    this.onUpdate = onUpdate;
  }

  async start(id: number): Promise<void> {
    if (this.active?.id === id) return;

    if (this.active) {
      if (this.active.nativeStarted) {
        this.cancel(this.active.id);
        this.emit({ id, state: 'error', message: '语音识别正在结束，请稍后重试' });
        return;
      }
      this.cancel(this.active.id);
    }

    if (this.draining) {
      this.emit({ id, state: 'error', message: '语音识别正在结束，请稍后重试' });
      return;
    }

    const session: Session = {
      id,
      phase: 'preparing',
      nativeStarted: false,
      nativeEnded: false,
      nativeStopRequested: false,
      finalText: '',
      interimText: '',
    };
    this.active = session;
    this.emitProgress(session);

    try {
      if (!this.recognizer.isRecognitionAvailable()) {
        this.fail(session, '系统语音识别暂不可用');
        return;
      }

      const permission = await this.recognizer.requestPermissions();
      if (this.active !== session) return;
      if (!permission.granted) {
        this.fail(session, '请允许使用麦克风和语音识别');
        return;
      }

      let requiresOnDeviceRecognition = false;
      try {
        if (this.recognizer.supportsOnDeviceRecognition()) {
          const locales = await this.recognizer.getSupportedLocales();
          if (this.active !== session) return;
          const onDeviceLocales = locales.installedLocales ?? locales.locales ?? [];
          requiresOnDeviceRecognition = onDeviceLocales.some(isChineseMainlandLocale);
        }
      } catch {
        // Locale lookup is optional; the system recognizer remains available.
      }
      if (this.active !== session) return;

      if (!this.recognizer.isRecognitionAvailable()) {
        this.fail(session, '系统语音识别暂不可用');
        return;
      }

      session.nativeStarted = true;
      session.phase = 'listening';
      this.emitProgress(session);

      this.recognizer.start({
        lang: 'zh-CN',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        addsPunctuation: true,
        requiresOnDeviceRecognition,
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: 100,
        },
      });

      if (this.active === session) {
        session.maxDurationTimer = setTimeout(
          () => {
            if (this.active !== session) return;
            session.maxDurationTimer = undefined;
            // Cap microphone use while keeping submission gated on finger release.
            this.stopRecognizer(session);
          },
          this.maxDurationMs,
        );
      }
    } catch {
      this.fail(session, '语音识别启动失败，请重试');
    }
  }

  stop(id: number): void {
    const session = this.active;
    if (!session || session.id !== id) return;

    if (session.phase === 'preparing' || !session.nativeStarted) {
      this.finish(session, 'cancelled');
      return;
    }
    if (session.phase === 'processing') return;

    this.clearTimer(session, 'maxDurationTimer');
    if (session.nativeEnded) {
      const text = this.transcript(session);
      if (text) this.finish(session, 'complete', text);
      else this.cancel(session.id);
      return;
    }

    session.phase = 'processing';
    this.emitProgress(session);
    session.finalizationTimer = setTimeout(
      () => this.finishAfterTimeout(session),
      this.finalizationTimeoutMs,
    );

    this.stopRecognizer(session);
  }

  cancel(id?: number): void {
    const session = this.active;
    if (!session || (id !== undefined && session.id !== id)) return;

    const shouldAbort = session.nativeStarted && !session.nativeEnded;
    if (shouldAbort) this.beginDraining();
    this.finish(session, 'cancelled');
    if (shouldAbort) {
      try {
        this.recognizer.abort();
      } catch {
        // The session is already cancelled; ignore native cleanup failures.
      }
    }
  }

  onRecognizerResult(event: SpeechRecognitionResultEvent): void {
    const session = this.active;
    if (!session || !session.nativeStarted || session.nativeEnded) return;

    const transcript = cleanTranscript(event.results[0]?.transcript ?? '');
    const previousText = this.transcript(session);
    if (event.isFinal) {
      session.finalText = mergeTranscript(session.finalText, transcript);
      session.interimText = '';
    } else if (transcript) {
      session.interimText = transcript;
    }

    if (this.transcript(session) !== previousText) this.emitProgress(session);
  }

  onRecognizerVolumeChange(event: SpeechRecognitionVolumeEvent): void {
    const session = this.active;
    if (
      !session ||
      session.phase !== 'listening' ||
      !session.nativeStarted ||
      session.nativeEnded ||
      !Number.isFinite(event.value)
    ) {
      return;
    }

    const level = Math.max(0, Math.min(1, (event.value + 2) / 12));
    const update: SpeechUpdate & { level: number } = {
      id: session.id,
      state: 'listening',
      level,
    };
    this.onUpdate(update);
  }

  onRecognizerError(event: SpeechRecognitionErrorEvent): void {
    const session = this.active;
    if (!session || !session.nativeStarted) return;

    if (event.error === 'no-speech') {
      this.cancel(session.id);
      return;
    }

    if (event.error === 'aborted') {
      this.beginDraining();
      this.finish(session, 'cancelled');
      return;
    }

    this.fail(session, messageForError(event.error));
  }

  onRecognizerNoMatch(): void {
    if (this.active?.nativeStarted && !this.active.nativeEnded) {
      this.cancel(this.active.id);
    }
  }

  onRecognizerEnd(): void {
    const session = this.active;
    if (session?.nativeStarted) {
      session.nativeEnded = true;
      this.clearTimer(session, 'maxDurationTimer');
      if (session.phase === 'processing') {
        const text = this.transcript(session);
        if (!text) {
          this.cancel(session.id);
        } else {
          this.finish(session, 'complete', text);
        }
      }
    }

    this.clearDrainTimer();
    this.draining = false;
  }

  private finishAfterTimeout(session: Session): void {
    if (this.active !== session) return;
    const text = this.transcript(session);
    if (!text) {
      this.cancel(session.id);
      return;
    }

    this.beginDraining();
    this.finish(session, 'complete', text);
    try {
      this.recognizer.abort();
    } catch {
      // The finalization deadline has already produced a terminal update.
    }
  }

  private stopRecognizer(session: Session): void {
    if (session.nativeEnded || session.nativeStopRequested) return;
    session.nativeStopRequested = true;
    try {
      this.recognizer.stop();
    } catch {
      this.fail(session, '语音识别停止失败，请重试');
    }
  }

  private fail(
    session: Session,
    message: string,
    abortNative = true,
  ): void {
    if (this.active !== session) return;
    const shouldAbort = session.nativeStarted && !session.nativeEnded && abortNative;
    if (shouldAbort) this.beginDraining();
    this.finish(session, 'error', undefined, message);
    if (shouldAbort) {
      try {
        this.recognizer.abort();
      } catch {
        // The failure is already reported; ignore native cleanup failures.
      }
    }
  }

  private finish(
    session: Session,
    state: 'complete' | 'cancelled' | 'error',
    text?: string,
    message?: string,
  ): void {
    if (this.active !== session) return;
    this.clearTimer(session, 'maxDurationTimer');
    this.clearTimer(session, 'finalizationTimer');
    this.active = null;

    const update: SpeechUpdate = { id: session.id, state };
    if (state === 'complete') update.text = text ?? this.transcript(session);
    if (message) update.message = message;
    this.onUpdate(update);
  }

  private emitProgress(session: Session): void {
    if (this.active !== session) return;
    const update: SpeechUpdate = {
      id: session.id,
      state: session.phase,
      text: this.transcript(session),
    };
    this.onUpdate(update);
  }

  private emit(update: SpeechUpdate): void {
    this.onUpdate(update);
  }

  private transcript(session: Session): string {
    return mergeTranscript(session.finalText, session.interimText);
  }

  private beginDraining(): void {
    this.draining = true;
    this.clearDrainTimer();
    this.drainTimer = setTimeout(() => {
      this.draining = false;
      this.drainTimer = undefined;
    }, this.finalizationTimeoutMs);
  }

  private clearDrainTimer(): void {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = undefined;
  }

  private clearTimer(
    session: Session,
    key: 'maxDurationTimer' | 'finalizationTimer',
  ): void {
    const timer = session[key];
    if (timer) clearTimeout(timer);
    session[key] = undefined;
  }
}

function cleanTranscript(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isChineseMainlandLocale(locale: string): boolean {
  const normalized = locale.replace(/_/gu, '-').toLowerCase();
  return normalized === 'zh-cn' || normalized === 'zh-hans-cn';
}

function mergeTranscript(baseValue: string, nextValue: string): string {
  const base = cleanTranscript(baseValue);
  const next = cleanTranscript(nextValue);
  if (!base) return next;
  if (!next || next === base || base.endsWith(next)) return base;
  if (next.startsWith(base)) return next;

  const baseWords = base.split(' ');
  const nextWords = next.split(' ');
  for (
    let overlap = Math.min(baseWords.length, nextWords.length);
    overlap > 0;
    overlap -= 1
  ) {
    const baseSuffix = baseWords.slice(-overlap).join(' ').toLowerCase();
    const nextPrefix = nextWords.slice(0, overlap).join(' ').toLowerCase();
    if (baseSuffix === nextPrefix) {
      return joinTranscript(base, nextWords.slice(overlap).join(' '));
    }
  }

  const baseChars = Array.from(base);
  const nextChars = Array.from(next);
  if (
    isHan(baseChars.at(-1) ?? '') &&
    isHan(nextChars[0] ?? '')
  ) {
    for (
      let overlap = Math.min(baseChars.length, nextChars.length);
      overlap > 0;
      overlap -= 1
    ) {
      if (
        baseChars.slice(-overlap).join('') ===
        nextChars.slice(0, overlap).join('')
      ) {
        return joinTranscript(base, nextChars.slice(overlap).join(''));
      }
    }
  }

  return joinTranscript(base, next);
}

function joinTranscript(base: string, next: string): string {
  if (!next) return base;
  if (/^[,.;:!?，。！？；：、…）】」』]/u.test(next)) return base + next;
  const last = Array.from(base).at(-1) ?? '';
  const first = Array.from(next)[0] ?? '';
  const separator = isHan(last) && isHan(first) ? '' : ' ';
  return `${base}${separator}${next}`;
}

function isHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function messageForError(error: string): string {
  switch (error) {
    case 'audio-capture':
      return '无法访问麦克风';
    case 'interrupted':
      return '语音输入已中断';
    case 'language-not-supported':
      return '系统不支持中文语音识别';
    case 'network':
      return '语音识别网络连接失败';
    case 'not-allowed':
      return '请允许使用麦克风和语音识别';
    case 'service-not-allowed':
      return '请在系统设置中启用语音识别';
    case 'busy':
      return '语音识别正在结束，请稍后重试';
    default:
      return '语音识别失败，请重试';
  }
}
