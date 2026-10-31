// The widgets 嘟嘟 ships: the declarations (names, sizes, what each reads) come from the one table the plugin process also reads;
// the components are ours. A widget without a component yet is not offered.
import { BUILT_IN_WIDGETS } from '../../../assistant/dashboard/widgets.mjs';
import { IssuesCard } from './IssuesCard.jsx';
import { Overview } from './Overview.jsx';
import { Quota } from './Quota.jsx';
import { Sessions } from './Sessions.jsx';
import { Stuck } from './Stuck.jsx';
import { Upcoming } from './Upcoming.jsx';

const COMPONENTS = { issues: IssuesCard, overview: Overview, upcoming: Upcoming, stuck: Stuck, quota: Quota, sessions: Sessions };

export const REGISTRY = BUILT_IN_WIDGETS.filter((widget) => COMPONENTS[widget.id]).map((widget) => ({ ...widget, Component: COMPONENTS[widget.id] }));
