import { createElement as h } from 'react';
import { defineWidget } from 'dsh-dudu/widget';
import { Frame, Row, WidgetNumber } from 'dsh-dudu/widget-ui';

export const declaration = {
  id: 'dudu-example-widget.count', label: 'Example widget',
  description: 'An example using the read-only issues hook',
  min: { w: 3, h: 3 }, size: { w: 5, h: 3 }, needs: ['issues'],
  preview: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="80"%3E%3Crect width="160" height="80" fill="%23eee"/%3E%3Ctext x="16" y="48" font-size="24"%3E2 issues%3C/text%3E%3C/svg%3E',
  development: typeof __WIDGET_DEV__ !== 'undefined' && __WIDGET_DEV__,
};

export const Widget = defineWidget(declaration, function Widget({ useIssues }) {
  const { value } = useIssues({ tab: 'active', limit: 1 });
  return h(Frame, { title: declaration.label }, h(Row, null, h(WidgetNumber, { value: value?.total ?? '—', label: 'Issues' })));
});
