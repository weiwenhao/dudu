import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';

const D = T.dashboard;

/**
 * The list the dashboard's "Add widget" opens: every widget there is, one line each, with the ones already on the dashboard marked
 * (each can be there once) and the plugin a widget comes from named when it is not ours. A click puts one in the first free place.
 */
export function AddWidgetDialog({ open, onOpenChange, registry, onBoard, onAdd }) {
  const free = registry.filter((widget) => !onBoard.has(widget.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogTitle className="font-semibold">{D.addTitle}</DialogTitle>
        <DialogDescription className="sr-only">{D.addDescription}</DialogDescription>
        <ul className="flex max-h-[60vh] flex-col overflow-auto">
          {registry.map((widget) => {
            const there = onBoard.has(widget.id);
            const source = widget.id.includes('.') ? widget.id.slice(0, widget.id.indexOf('.')) : null;
            return (
              <li key={widget.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{widget.label}</div>
                  <div className="text-xs text-muted-foreground">{widget.description}{source ? ` ${D.source(source)}` : ''}</div>
                </div>
                {there
                  ? <span className="text-xs text-muted-foreground">{D.added}</span>
                  : <Button variant="outline" size="sm" aria-label={`${D.add} ${widget.label}`} onClick={() => onAdd(widget.id)}>{D.add}</Button>}
              </li>
            );
          })}
        </ul>
        {free.length === 0 && <p className="text-xs text-muted-foreground">{D.noMore}</p>}
        <div className="flex justify-end"><DialogClose asChild><Button variant="ghost" size="sm">{D.done}</Button></DialogClose></div>
      </DialogContent>
    </Dialog>
  );
}
