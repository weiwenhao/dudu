import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { SpeechUpdate } from './HarnessView.types';
import { SpeechInputController, type SpeechRecognizer } from './speech-input';
import { logEvent } from './diagnostics';

const recognizer: SpeechRecognizer = {
  requestPermissions: () => ExpoSpeechRecognitionModule.requestPermissionsAsync(),
  isRecognitionAvailable: () =>
    ExpoSpeechRecognitionModule.isRecognitionAvailable(),
  supportsOnDeviceRecognition: () =>
    ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
  getSupportedLocales: () => ExpoSpeechRecognitionModule.getSupportedLocales({}),
  start: (options) => {
    logEvent('speech.native-start', { language: options.lang, onDevice: options.requiresOnDeviceRecognition });
    ExpoSpeechRecognitionModule.start(options);
  },
  stop: () => { logEvent('speech.native-stop'); ExpoSpeechRecognitionModule.stop(); },
  abort: () => { logEvent('speech.native-abort'); ExpoSpeechRecognitionModule.abort(); },
};

export function useSpeechInput(
  onUpdate: (update: SpeechUpdate) => void,
): SpeechInputController {
  const lastState = useRef('');
  const update = useCallback((value: SpeechUpdate) => {
    const state = `${value.id}:${value.state}`;
    if (lastState.current !== state || value.text !== undefined || value.message) {
      logEvent('speech.update', { id: value.id, state: value.state, chars: value.text?.length, message: value.message });
      lastState.current = state;
    }
    onUpdate(value);
  }, [onUpdate]);
  const [controller] = useState(
    () => new SpeechInputController(recognizer, onUpdate),
  );

  useEffect(() => {
    controller.setUpdateHandler(update);
  }, [controller, update]);

  useEffect(() => {
    const subscriptions = [
      ExpoSpeechRecognitionModule.addListener('result', (event) => {
        logEvent('speech.result', { final: event.isFinal, alternatives: event.results.length });
        controller.onRecognizerResult(event);
      }),
      ExpoSpeechRecognitionModule.addListener('volumechange', (event) =>
        controller.onRecognizerVolumeChange(event),
      ),
      ExpoSpeechRecognitionModule.addListener('error', (event) => {
        logEvent('speech.error', { code: event.error, message: event.message }, 'warn');
        controller.onRecognizerError(event);
      }),
      ExpoSpeechRecognitionModule.addListener('nomatch', () => {
        logEvent('speech.nomatch');
        controller.onRecognizerNoMatch();
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        logEvent('speech.end');
        controller.onRecognizerEnd();
      }),
    ];
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') controller.cancel();
    });

    return () => {
      controller.cancel();
      appStateSubscription.remove();
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [controller]);

  return controller;
}
