// Slot registries retain only their own options. Keep the widget declaration on the component.
export function defineWidget(declaration, Component) {
  Object.defineProperty(Component, 'duduWidget', {
    value: Object.freeze({ widgetApi: 1, ...declaration }), configurable: true,
  });
  return Component;
}
