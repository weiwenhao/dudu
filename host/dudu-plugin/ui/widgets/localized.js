import { T } from '../strings.js';

export function localizedWidget(widget) {
  if (!T.widgets.titles[widget.id]) return widget;
  return {
    ...widget,
    get label() { return T.widgets.titles[widget.id]; },
    get description() { return T.widgets.descriptions[widget.id]; },
  };
}
