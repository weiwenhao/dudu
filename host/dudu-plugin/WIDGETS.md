# Writing a widget for Dudu

A widget is one of the draggable panels on the Dudu dashboard (Issues, Office, Inbox are widgets). You write one as a single file. There is nothing to install and no build step.

## Where it goes

`<assistant home>/widgets/<name>.mjs`, with a lowercase name made of letters, digits and dashes, for example `widgets/clock.mjs`. The file is a JavaScript module of at most 256 KB.

The dashboard looks at the folder every few seconds. A new file shows up in the add list (Edit layout, Add widget). A changed file replaces the old one, also where it is already on the board. A deleted file removes its widget. A widget's id is `local.<name>`, so the file name is the only name to choose.

## The file

Default-export a function. It receives `{ React, h, defineWidget, Frame, Row, Empty, Badge, WidgetNumber, ProgressBar }` and returns what `defineWidget` returns.

```js
export default ({ h, defineWidget, Frame, WidgetNumber }) => defineWidget({
  label: 'Clock',
  min: { w: 3, h: 2 },
  size: { w: 4, h: 3 },
}, function Clock({ useIssues }) {
  const { value } = useIssues({ tab: 'active', limit: 1 });
  return h(Frame, { title: 'Clock' }, h(WidgetNumber, { value: value?.total ?? '-', label: 'Active issues' }));
});
```

- There are no imports. Everything comes through the argument. `h` is `React.createElement`, and `React` has the hooks (`React.useState`, `React.useEffect`, ...).
- `label` is the name in the add list. `description` is optional.
- `min` is the smallest size whose content still reads. `size` is the size it gets when it is added, and is not smaller than `min`. Sizes count dashboard cells: fifteen columns, and rows about as tall as a column is wide. `size` may use `'fill'` for every column or every row the window shows. Both are required.
- `needs` lists what the widget reads (`issues`, `quota`, `inputs`, `sessions`, `network`). It defaults to an empty list. `preview` is an optional image for the add list, as a `data:` URL.

## What the component gets

The component receives these props:

- `size: { cols, rows, width, height }` and `editing`.
- Read-only hooks `useIssues(view)`, `useQuota()`, `useInputs()` and `useSessions(query)`. Each returns `{ status, value }` and follows the real data while the widget is mounted. `useInputs()` is what the Inbox shows: the records the collectors collected.
- Actions `openIssue(id)`, `openSession(session)`, `takeOverSession(session)` and the read `readSession(session)`.
- `renderIssues()` renders the Issues interface.

`Frame`, `Row`, `Empty`, `Badge`, `WidgetNumber` and `ProgressBar` come with the host's styles. Plain elements and DSH's `--dsw-*` tokens work as well. The full types are in `widget.d.ts`, next to this file.

## Rules

- Any size from `min` up must fit: show whole rows and scroll inside when the content is longer.
- Content follows its own size (container queries), not the screen width.
- Respect reduced motion. Label icon buttons with `aria-label`.

## Did it load?

The dashboard writes how each file loaded to `<assistant home>/widgets/status.json`: `{ "widgets": { "<name>": { "ok": true } } }`, or `{ "ok": false, "error": "..." }` for a file that failed. A file that does not export a function, or whose declaration is incomplete, fails there with the reason. The file is written while the dashboard is open, a few seconds after the widget file changes. A widget that fails while it renders shows an error where it sits on the board.
