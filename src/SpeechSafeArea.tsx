import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SPEECH_COLOR_STOPS } from './speech-appearance';

export function SpeechSafeArea({ height, cancel }: { height: number; cancel: boolean }) {
  return (
    <Svg width="100%" height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id="speechSafeArea" x1="0%" y1="0%" x2="100%" y2="0%">
          {SPEECH_COLOR_STOPS.map((stop) => (
            <Stop key={stop.offset} offset={`${stop.offset}%`}
              stopColor={cancel ? stop.cancel : stop.recording} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#speechSafeArea)" />
    </Svg>
  );
}
