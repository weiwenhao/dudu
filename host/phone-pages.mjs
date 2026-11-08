// 嘟嘟's own pages for the phone's web view (owner, 2026-11-07): its settings pages, one section to a page. The pages themselves are the desktop interface's settings sections, built
// into a script of their own (scripts/build-client.mjs, buildPhonePages) that runs outside DSH's web interface; the plugin serves them from here, under the same scoped, authenticated
// page address as DSH's pages (web-page-http.mjs) and answers the few plugin actions they ask for, nothing else.
//
//   const duduPages = createDuduPages({ assets, call })
//   duduPages.document({ target })   -> { html, resource }   the page of one section, and the files it loads (its script and stylesheet only)
//   duduPages.allowed(action)        -> boolean               whether a page of this kind may ask the plugin for it
//   duduPages.call(action, body)     -> { status, body }      the plugin's own answer to it (`call` is the plugin's, the desktop interface's: POST /api/dudu/<action>)
export const DUDU_PAGE_SECTIONS = Object.freeze(['general', 'statuses', 'connectors', 'collectors', 'rules', 'memory', 'skills']);

// What the settings pages use: 嘟嘟's settings, the workflow statuses, the connectors, the collectors, the rules, the memory and the skills. Nothing of pairing (a page never gets
// the phone's credentials or the computer's pairing code), and nothing that works on the computer's own folders, windows or files.
const ACTIONS = Object.freeze([
  /^assistant\/(?:settings|conversation-settings|state)$/u,
  /^dispatch\/state$/u,
  /^issues\/(?:statuses|status-add|status-update|status-remove|status-order|tidy-undo)$/u,
  /^(?:connectors|collectors|rules|memory|skills)\/[a-z][a-z-]{0,39}$/u,
]);

export const allowedAction = (action) => typeof action === 'string' && action.length <= 80 && ACTIONS.some((pattern) => pattern.test(action));

const FILES = Object.freeze({
  '/settings.js': 'text/javascript; charset=utf-8',
  '/settings.css': 'text/css; charset=utf-8',
});

const page = (section) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>嘟嘟</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="settings.css">
<style>
html, body, #root { height: 100%; margin: 0; background: #fff; }
body { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
/* The app's own bar above the page already says which page it is. */
.dudu .phone-settings > div > header h2 { display: none; }
.dudu .phone-settings > div > header:not(:has(button, [role="button"], a)) { display: none; }
</style>
</head>
<body>
<div id="root"></div>
<script>window.__DUDU_PHONE__ = ${JSON.stringify({ section })}</script>
<script src="settings.js"></script>
</body>
</html>
`;

/**
 * `assets(name)` reads one of the built files (`settings.js`, `settings.css`); `call(action, body)` is the plugin's own answer to an action of the desktop interface.
 */
export function createDuduPages({ assets, call }) {
  return Object.freeze({
    allowed: allowedAction,
    async call(action, body) {
      if (!allowedAction(action)) return { status: 404, body: { error: 'Not found' } };
      return call(action, body);
    },
    document({ target }) {
      if (!DUDU_PAGE_SECTIONS.includes(target)) throw new Error('Unknown page.');
      return {
        html: page(target),
        async resource(path) {
          const mimeType = FILES[String(path).split('?')[0]];
          if (!mimeType) throw new Error('Not a file of this page.');
          return { mimeType, data: new Uint8Array(await assets(path.slice(1))) };
        },
      };
    },
  });
}
