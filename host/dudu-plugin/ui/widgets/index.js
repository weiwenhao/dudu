// The widgets 嘟嘟 ships: the declarations (names, sizes, what each reads) come from the one table the plugin process also reads;
// the components are ours. A widget without a component yet is not offered.
import { BUILT_IN_WIDGETS } from '../../../assistant/dashboard/widgets.mjs';
import { CollectorCard } from './CollectorCard.jsx';
import { IssuesCard } from './IssuesCard.jsx';
import { OfficeCard } from './OfficeCard.jsx';
import { Quota } from './Quota.jsx';
import { defineWidget } from '../../widget.mjs';
import { createElement } from 'react';
import { WidgetData } from './data.jsx';
import { localizedWidget } from './localized.js';

const COMPONENTS = { issues: IssuesCard, quota: Quota, office: OfficeCard, collector: CollectorCard };

export const REGISTRY = BUILT_IN_WIDGETS.filter((widget) => COMPONENTS[widget.id]).map((widget) => localizedWidget({ ...widget, Component: defineWidget(widget, COMPONENTS[widget.id]) }));

// Fixtures and the page's standalone entry use exactly the capability face the native slot injects.
export const DIRECT_REGISTRY = REGISTRY.map((widget) => localizedWidget({
  ...widget, Component: (props) => createElement(WidgetData, { ...props, Component: widget.Component }),
}));
