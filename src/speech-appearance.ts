// Share the bottom colors with the native safe area to avoid a visible seam.
export const SPEECH_COLOR_STOPS = [
  { offset: 0, recording: '#37b1fe', cancel: '#ffe2e4' },
  { offset: 16, recording: '#239bf9', cancel: '#ffdee0' },
  { offset: 50, recording: '#1380f5', cancel: '#ffdadb' },
  { offset: 84, recording: '#239bf9', cancel: '#ffdee0' },
  { offset: 100, recording: '#37b1fe', cancel: '#ffe2e4' },
] as const;
