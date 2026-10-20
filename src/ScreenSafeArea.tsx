import { StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];
type PaddingProperty = 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft';

export function ScreenSafeArea({
  edges = ALL_EDGES, style, ...props
}: ViewProps & { edges?: readonly Edge[] }) {
  const insets = useSafeAreaInsets();
  const base = StyleSheet.flatten(style) ?? {};
  const padding: Partial<Record<PaddingProperty, number>> = {};

  // Apply measured insets directly to the layout, including modal roots.
  for (const edge of edges) {
    const property = `padding${edge[0].toUpperCase()}${edge.slice(1)}` as PaddingProperty;
    const axis = edge === 'top' || edge === 'bottom' ? 'paddingVertical' : 'paddingHorizontal';
    const value = base[property] ?? base[axis] ?? base.padding;
    padding[property] = insets[edge] + (typeof value === 'number' ? value : 0);
  }

  return <View {...props} style={[style, padding]} />;
}
