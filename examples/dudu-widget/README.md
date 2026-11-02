# DSH widget template

This is a separate DSH plugin, using the `dudu.widget` slot. Its source does not receive the DSH context or the request helper. Installing a plugin still trusts its JavaScript; the slot is not a sandbox.

In a separate copy of this folder, install dependencies with the locally packaged `dudu` tarball as the peer, then build:

```sh
npm install /absolute/path/dudu-0.4.0.tgz
npm run dev
DSH_HOME=/absolute/path/development-home dsh plugin --profile web add /absolute/path/widget-copy
DSH_HOME=/absolute/path/development-home dsh web --host 127.0.0.1 --no-open --port 0
```

Use a dedicated DSH home for development. Open the address printed by DSH privately; it contains a login token. In Settings → Widgets, enable Developer mode and add Example widget. During Edit layout, Inspect widget offers minimum/recommended sizes, theme and fixed example data. Rebuilding `dist/client.js` triggers DSH's own HMR; the saved layout remains.

`npm run build` removes the development flag before publishing. Change the package name, module-loader id, bundle row and widget id together. Widget ids use `<package>.<widget>`. Keep `dudu` as a peer dependency and bundle `dudu/widget` and `dudu/widget-ui`; React stays external and comes from the DSH loader. `build.mjs` provides the wrapper.

`defineWidget` keeps metadata on the component because DSH's slot registry discards unknown registration options. The declaration includes `id`, `label`, `description`, `min`, `size`, `needs`, `preview` and `widgetApi: 1`. `min` and `size` count the dashboard's cells: twenty columns across the board and rows of the same size, so a cell is a twentieth of the width (a recommended `w` or `h` of `'fill'` is every column, or every row the window shows). Use `import type {} from 'dudu/widget'` to merge the slot into DSH's SlotMap. `development: true` explicitly marks a local build; it is removed by the release build command.

Widgets receive `size: { cols, rows, width, height }`, `editing`, read-only React hooks `useIssues(view)`, `useQuota()`, `useInputs()`, `useSessions(query)`, and `openIssue(id)` / `openSession(session)`. Each hook returns `{ status, value }` and follows the real plugin while mounted. `needs` discloses the data used, including `network` when applicable. Do not perform writes through this interface. Put widget-specific preferences in the plugin's own DSH settings.

`renderIssues()` embeds the existing hosted Issues interface, including its owner-operated controls. The built-in Issues widget uses that same public function. The other seven built-ins use the same read hooks and opening actions offered to third-party widgets; none receives a general request helper. The standalone example-data helper returns an empty hosted view because it has no issue backend.

`dudu/widget-ui` exports Frame, Empty, Row, WidgetNumber, ProgressBar and Badge. The host supplies their scoped styles. `dudu/widget.css` can be included in a standalone preview. Otherwise use DSH's `--dsw-*` tokens. Respect reduced motion and label icon buttons.

`npm test` opens the installed Chrome, renders this widget at both sizes in both themes, and checks layout and button labels. It uses `dudu/widget-testing` (`exampleData`, `exampleWidgetProps`, `widgetCases`, `inspectWidget`) without DSH or a model. CI needs a Chrome installation or an equivalent `playwright-core` launch configuration; it does not download a browser.

From this repository, without installing a separate copy:

```sh
DUDU_WIDGET_ROOT="$PWD/host/dudu-plugin" node examples/dudu-widget/test.mjs
```

Publishing follows the normal DSH plugin flow (`npm publish`, installation through DSH's Plugins page). No special widget registry is required. The new widget appears in the add list and is never added to the dashboard automatically.
