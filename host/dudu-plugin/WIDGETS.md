# Writing a widget for Dudu

A widget is a small DSH plugin. It registers into the `dudu.widget` slot of the Dudu dashboard. Dudu's own widgets (Issues, Office, Inbox) use the same interface.

A plugin is code that runs with the owner's permissions, and the slot is not a sandbox: installing a widget plugin means trusting its code. A newly installed widget only appears in the add list. It is never put on the dashboard by itself.

## Steps

1. Copy the template that ships with this package into a folder of your own.

   ```sh
   cp -r <this package>/dist/widget-template <folder>/<name>
   cd <folder>/<name>
   ```

2. Make these names agree.
   - `name` in `package.json`.
   - `id` and `name` in `cordis.patch.yml`.
   - The widget `id` in `widget.mjs`, which is `<package name>.<widget>`, for example `clock.time`.

   The module-loader id that the build writes is read from `package.json`, so it follows the package name.

3. Edit `widget.mjs`: the declaration and the component.

4. Install and build.

   ```sh
   npm install
   npm run build        # esbuild writes dist/client.js
   npm test             # optional, needs Chrome
   ```

   If npm cannot fetch `dsh-dudu` (the peer dependency), install without peers and take it from this package instead:

   ```sh
   npm install --legacy-peer-deps
   npm install --no-save <this package>
   ```

5. Install the plugin in DSH. The owner does this, because it adds code that runs with their permissions: Plugins page, Add plugin, then the absolute path of the folder. The terminal form is `dsh plugin --profile <profile> add <absolute path>`. A local folder is linked, not copied: rebuild `dist/client.js` and DSH hot-reloads it.

6. The owner adds the widget from the dashboard: Edit layout, Add widget.

`<this package>` is the folder that contains this file.

## Declaration

```js
import { defineWidget } from 'dsh-dudu/widget';

export const declaration = {
  id: 'clock.time', label: 'Clock', description: 'The time',
  min: { w: 3, h: 2 }, size: { w: 4, h: 3 }, needs: [], widgetApi: 1,
};
export const Widget = defineWidget(declaration, function Widget(props) { /* return a React element */ });
```

- `id` is unique and written `<package name>.<widget>`.
- `min` is the smallest size whose content still reads. `size` is the recommended size used when it is added, and is not smaller than `min`. Sizes count dashboard cells: fifteen columns, and rows about as tall as a column is wide. `size` may use `'fill'` for every column or every row the window shows.
- `needs` lists what the widget reads: `issues`, `quota`, `inputs`, `sessions`, `network`.
- `preview` is an optional image for the add list, as a `data:` URL.

The Component receives `WidgetProps` (see `widget.d.ts`):

- `size: { cols, rows, width, height }` and `editing`.
- Read-only hooks `useIssues(view)`, `useQuota()`, `useInputs()` and `useSessions(query)`. Each returns `{ status, value }` and follows the real data while the widget is mounted.
- Actions `openIssue(id)`, `openSession(session)`, `takeOverSession(session)` and the read `readSession(session)`.
- `renderIssues()` renders the hosted Issues interface.

There is no write API. A widget's own preferences belong in its plugin's DSH settings.

`dsh-dudu/widget-ui` exports `Frame`, `Row`, `Empty`, `Badge`, `WidgetNumber` and `ProgressBar`. The host supplies their styles. Otherwise use DSH's `--dsw-*` tokens.

## Rules

- Any size from `min` up must fit: show whole rows and scroll inside when the content is longer.
- React comes from DSH's loader and stays external. Everything else, including `defineWidget`, is bundled by `build.mjs`.
- Content follows its own size (container queries), not the screen width.
- Respect reduced motion. Label icon buttons with `aria-label`.

## Where to keep it

A widget plugin can live in any folder. The assistant keeps the ones it writes in `<assistant home>/widgets/<name>`.
