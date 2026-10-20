import { forwardRef, type ComponentRef } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { logEvent } from './diagnostics';

let sequence = 0;
export const LoggedPressable = forwardRef<ComponentRef<typeof Pressable>, PressableProps>(function LoggedPressable(props, ref) {
  const label = props.accessibilityLabel ?? props.testID ?? 'button';
  return <Pressable {...props} ref={ref}
    onPressIn={(event) => {
      logEvent('ui.press-in', { label, nativeTime: event.nativeEvent.timestamp });
      props.onPressIn?.(event);
    }}
    onPressOut={(event) => {
      logEvent('ui.press-out', { label, nativeTime: event.nativeEvent.timestamp });
      props.onPressOut?.(event);
    }}
    onPress={(event) => {
      const id = ++sequence;
      const start = performance.now();
      logEvent('ui.press', { id, label, nativeTime: event.nativeEvent.timestamp });
      try { props.onPress?.(event); }
      finally {
        logEvent('ui.press-handled', { id, label, durationMs: Math.round((performance.now() - start) * 100) / 100 });
        requestAnimationFrame(() => logEvent('ui.native-next-frame', { id, durationMs: Math.round(performance.now() - start) }));
      }
    }} />;
});
