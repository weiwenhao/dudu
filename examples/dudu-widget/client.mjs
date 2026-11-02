import { Widget, declaration } from './widget.mjs';

window.__ModuleLoader__.load({
  id: 'dudu-example-widget',
  factory() {
    return {
      name: 'dudu-example-widget', inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('dudu.widget', () => ctx.slots.register({
          name: 'dudu.widget', id: declaration.id, label: declaration.label,
        }, Widget));
      },
    };
  },
});
