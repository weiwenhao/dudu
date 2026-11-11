import { Clock3, LayoutGrid, MessageCircle, Settings } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { QuotaButton } from '../quota/QuotaButton.jsx';
import { T } from '../strings.js';

/** Keep the five actions outside DSH's draggable window region. The quota (owner, 2026-11-11) sits between the tasks and the layout: the windows of the dashboard, then its own settings. */
export function Entry({ request, editing, onSettings, onEdit, onSessions, onTasks }) {
  const D = T.dashboard;
  return (
    <header className="db-header" data-window-drag>
      {!editing && <div role="toolbar" aria-label={D.menu} aria-orientation="horizontal" className="db-entry" data-window-drag-recall>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={T.widgets.titles.sessions} title={T.widgets.titles.sessions} onClick={onSessions}><MessageCircle aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={T.tasks.title} title={T.tasks.title} onClick={onTasks}><Clock3 aria-hidden="true" /></Button>
        <QuotaButton request={request} />
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={D.editLayout} title={D.editLayout} onClick={onEdit}><LayoutGrid aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={D.settings} title={D.settings} onClick={onSettings}><Settings aria-hidden="true" /></Button>
      </div>}
    </header>
  );
}
