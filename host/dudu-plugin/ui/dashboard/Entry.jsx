import { LayoutGrid, MessagesSquare, Settings } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';

/** Keep DSH's native window region above the board, with its three actions outside the draggable area. */
export function Entry({ editing, onSettings, onEdit, onSessions }) {
  const D = T.dashboard;
  return (
    <header className="db-header" data-window-drag>
      {!editing && <div role="toolbar" aria-label={D.menu} aria-orientation="horizontal" className="db-entry" data-window-drag-recall>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={D.settings} title={D.settings} onClick={onSettings}><Settings aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={D.editLayout} title={D.editLayout} onClick={onEdit}><LayoutGrid aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={T.widgets.titles.sessions} title={T.widgets.titles.sessions} onClick={onSessions}><MessagesSquare aria-hidden="true" /></Button>
      </div>}
    </header>
  );
}
