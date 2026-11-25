window.__ModuleLoader__.load({
  // DSH starts a package's interface only when its script registers under the package's own name (package.json "name").
  id: 'dsh-dudu',
  factory(require) {
    const { createElement: h, Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } = require('react');
    const { Button, Input, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives');
    // The React interface (ui/, built by scripts/build-client.mjs) is compiled in front of this file; unbuilt, it is absent.
    const ui = typeof __DUDU_UI__ === 'function' ? __DUDU_UI__(require) : null;
    const S = ui?.T.shell;
    const subscribeLanguage = ui?.subscribeLocale ?? (() => () => {});
    const readLanguage = ui?.getLocale ?? (() => 'en');
    const useLanguage = () => useSyncExternalStore(subscribeLanguage, readLanguage);

    /**
     * Tells Electron (macOS) that the buttons of the draggable title bar are where they are now. DSH makes Electron re-read its map of "this part is a button, not
     * the window's handle" by setting `data-window-drag-recall` on the body for a frame, but only when the box of a bar changes; the control this plugin puts in the
     * header shows later and inside the bar, so DSH never does it for that and it is dragged, not clicked (no hover, no tooltip). This does the same flip whenever the
     * control appears, changes size or the window changes. Harmless anywhere else: the attribute does nothing outside DSH's macOS styles. Returns the cleanup.
     */
    const followWindowDrag = (doc, control) => {
      const win = doc?.defaultView;
      if (!win || !doc.body || typeof doc.addEventListener !== 'function') return undefined; // not a real page (a test's stand-in)
      const ATTRIBUTE = 'data-window-drag-recall';
      let frame = 0;
      let off = 0;
      const flip = () => {
        frame = 0;
        doc.body.setAttribute(ATTRIBUTE, '');
        // two frames: DSH takes it off at the start of its next one, and Electron needs a frame to read the style it makes
        off = win.requestAnimationFrame(() => { off = win.requestAnimationFrame(() => { off = 0; doc.body.removeAttribute(ATTRIBUTE); }); });
      };
      const recall = () => { if (!frame) frame = win.requestAnimationFrame(flip); };
      const entry = control ?? doc.querySelector('[data-dudu-home-entry]');
      const observer = typeof win.ResizeObserver === 'function' && entry ? new win.ResizeObserver(recall) : null;
      observer?.observe(entry);
      const events = ['transitionend', 'animationend'];
      for (const name of events) doc.addEventListener(name, recall, true);
      win.addEventListener('resize', recall);
      recall();
      return () => {
        observer?.disconnect();
        for (const name of events) doc.removeEventListener(name, recall, true);
        win.removeEventListener('resize', recall);
        if (frame) win.cancelAnimationFrame(frame);
        if (off) win.cancelAnimationFrame(off);
        doc.body.removeAttribute(ATTRIBUTE);
      };
    };

    const styles = `
.dudu-input{display:flex;width:100%;max-width:100%;min-width:0;box-sizing:border-box}
.dudu-input input{flex:1 1 auto;width:100%;min-width:0;box-sizing:border-box}
.dudu-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:12px 0 0}
/* The frame's shell.leading seat holds the native reopen / New Session controls. The plugin wraps that component, preserving its actions and locale,
   then appends Home (owner, 2026-11-09). Match its 28px controls and 8px gap, and reserve one more control's width in the frame's existing clearance.
   Older hosts and non-macOS windows keep the conversation-header entry; hide it whenever the frame seat is present so there is only one Home.
   HomeEntry also refreshes Electron's draggable-region map when its own button appears or changes size (owner, 2026-11-06). */
.dudu-home-entry[data-dudu-home-entry]{display:none;position:relative;inset-inline-start:max(0px,calc(var(--dsh-frame-leading-clearance,0px) - 20px));flex:none;width:28px;height:28px;margin-inline-end:8px;padding:0;border-radius:var(--dsw-radius-sm);background:transparent}
[data-sidebar-collapsed="true"] .dudu-home-entry[data-dudu-home-entry]{display:inline-flex}
.dudu-home-entry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dudu-shell-leading{display:flex;align-items:center;gap:8px}
.dudu-home-entry[data-dudu-shell-home-entry]{position:static;inset-inline-start:auto;margin-inline-end:0;color:var(--dsw-alias-label-secondary)}
[data-platform="darwin"] [data-sidebar-collapsed="true"]:has([data-dudu-shell-leading]){--dsh-frame-leading-clearance:196px}
[data-platform="darwin"][data-fullscreen] [data-sidebar-collapsed="true"]:has([data-dudu-shell-leading]){--dsh-frame-leading-clearance:120px}
[data-sidebar-collapsed="true"]:has([data-dudu-shell-leading]) .dudu-home-entry:not([data-dudu-shell-home-entry]){display:none}
.dudu-session-header-actions{display:flex;align-items:center;gap:8px;flex:none;min-width:0}
.dudu-session-header-actions:empty{display:none}
/* Same 28px target and 15px glyph as DSH's adjacent More and right-sidebar controls. */
.dudu-session-return{flex:none;width:28px;padding:0;color:var(--dsw-alias-label-secondary)}
.dudu-session-return svg{width:15px;height:15px}
[data-dudu-session-overlay]{z-index:1100!important}
/* Match DSH's hidden holding row while its native root waits for background work. Keep its height stable. */
[data-conversation-session]:has([data-dudu-harness-background]) [data-chat-running]{visibility:hidden;opacity:0}
/* Only cells with Dudu's portal use the shared logo + lifecycle mark. */
[data-row-key^="session:"]>span:has(>[data-dudu-sidebar-agent])>:not([data-dudu-sidebar-agent]){display:none!important}
`;

    async function request(action, body = {}, { signal } = {}) {
      const path = new URL(`api/dudu/${action}`, document.baseURI).pathname;
      const response = await fetch(path, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), credentials: 'same-origin', signal,
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(value.error || (S?.unavailable ?? '连接暂时不可用。')), { code: value.code });
      return value;
    }

    // ---- Navigation: tell the phone what DSH's own UI contains ---------------------------------
    //
    // The sidebar panels, conversation tabs and settings sections are registered in
    // this browser runtime by whichever plugins are installed. Reading them here, rather than listing
    // them in the app, is what lets a plugin's new panel or tab reach the phone unchanged.
    const SETTINGS_ICONS = {
      account: 'IconUserOutlineMedium',
      models: 'IconDataOutlineMedium',
      'agent-presets': 'IconAgentPresetOutlineMedium',
      plugins: 'IconPersonalizationOutlineMedium',
      'archived-sessions': 'IconArchiveOutlineMedium',
    };
    const DEFAULT_SETTINGS_ICON = 'IconSettingsOutlineMedium';
    const ICON_TAG_ATTRS = {
      path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'],
      polyline: ['points'], polygon: ['points'],
    };
    const ICON_STYLE_ATTRS = [
      ['fill', 'fill'], ['stroke', 'stroke'], ['stroke-width', 'strokeWidth'],
      ['stroke-linecap', 'strokeLinecap'], ['stroke-linejoin', 'strokeLinejoin'], ['fill-rule', 'fillRule'],
    ];
    const IDENTITY = [1, 0, 0, 1, 0, 0];
    // An icon the phone cannot redraw from shapes is drawn here instead and sent as a small picture.
    const RASTER_PX = 64;
    const MAX_RASTER_ICONS = 12;
    const MAX_RASTER_BASE64 = 16 * 1024;
    const rasterCache = new Map();
    // A drawing that failed is tried again on later reports, a few times, before the icon is given up on.
    const MAX_RASTER_ATTEMPTS = 3;
    const rasterFailures = new Map();
    /**
     * The markup with its generated ids (React's useId gives every render a new one, so the same icon
     * would otherwise never hit the cache and the cache would fill with copies of it) renamed by order.
     */
    const stableMarkup = (markup) => {
      let text = markup;
      Array.from(new Set(Array.from(markup.matchAll(/\bid="([^"]+)"/gu), (match) => match[1])))
        .sort((a, b) => b.length - a.length)
        .forEach((id, index) => { text = text.split(id).join(`icon-id-${index}`); });
      return text;
    };
    const NAV_DEBOUNCE_MS = 500;
    const NAV_REFRESH_MS = 5 * 60 * 1000;
    const NAV_WARMUP_MS = [1500, 6000, 20000];

    const optionalRequire = (name) => { try { return require(name); } catch { return undefined; } };
    const multiply = (a, b) => [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    const paint = (value) => (value === 'none' || /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/u.test(value)
      ? value : 'currentColor');

    /**
     * Whether the icon uses anything that shapes and paints alone cannot show: a mask or clip, a filter,
     * a gradient or pattern, a reference to other markup, text, or styling that is not an attribute. Read
     * as plain shapes, a masked icon is a solid block.
     */
    function needsRaster(svg) {
      if (svg.querySelector('mask, clipPath, filter, linearGradient, radialGradient, pattern, use, image, text, foreignObject, style, symbol')) {
        return true;
      }
      for (const element of Array.from(svg.querySelectorAll('*'))) {
        if (element.hasAttribute('mask') || element.hasAttribute('clip-path') || element.hasAttribute('filter')) return true;
        if (/url\(/u.test(`${element.getAttribute('fill') || ''} ${element.getAttribute('stroke') || ''}`)) return true;
        if (/fill|stroke|opacity|display|visibility/u.test(element.getAttribute('style') || '')) return true;
      }
      return false;
    }

    /**
     * The icon drawn by the browser itself, black on transparent, as a small PNG. The phone uses only its
     * shape and tints it like every other icon. Resolves to undefined when the browser cannot draw it.
     */
    function rasterIcon(svg, viewBox) {
      // Everything that needs the live DOM happens before the first await: the caller unmounts it next.
      let text;
      let key;
      try {
        const copy = svg.cloneNode(true);
        // Product icons now refer to symbols in DSH's document sprite. An SVG image has its own document.
        const uses = Array.from(copy.querySelectorAll('use'));
        let definitions;
        for (let index = 0; index < uses.length; index++) {
          if (index >= 48) return Promise.resolve(undefined);
          const href = uses[index].getAttribute('href') || uses[index].getAttribute('xlink:href');
          if (!href?.startsWith('#')) return Promise.resolve(undefined);
          const id = href.slice(1);
          if (Array.from(copy.querySelectorAll('*')).some((element) => element.getAttribute('id') === id)) continue;
          const source = document.getElementById(id);
          if (!source) return Promise.resolve(undefined);
          if (!definitions) {
            definitions = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            copy.appendChild(definitions);
          }
          const definition = source.cloneNode(true);
          definitions.appendChild(definition);
          uses.push(...definition.querySelectorAll('use'));
        }
        copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        copy.setAttribute('viewBox', viewBox.join(' '));
        copy.setAttribute('width', String(RASTER_PX));
        copy.setAttribute('height', String(RASTER_PX));
        copy.setAttribute('style', 'color:#000');
        key = stableMarkup(copy.outerHTML);
        const cached = rasterCache.get(key);
        if (cached) return cached;
        if (rasterCache.size >= MAX_RASTER_ICONS) return Promise.resolve(undefined);
        text = new XMLSerializer().serializeToString(copy);
      } catch { return Promise.resolve(undefined); }
      const pending = (async () => {
        const image = new Image();
        const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('icon')); });
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
        await loaded;
        const canvas = document.createElement('canvas');
        canvas.width = RASTER_PX;
        canvas.height = RASTER_PX;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, RASTER_PX, RASTER_PX);
        if (!context.getImageData(0, 0, RASTER_PX, RASTER_PX).data.some((value, index) => index % 4 === 3 && value > 0)) {
          return undefined;
        }
        const url = canvas.toDataURL('image/png');
        const png = url.slice(url.indexOf(',') + 1);
        return png.length > 0 && png.length <= MAX_RASTER_BASE64
          ? { viewBox: [0, 0, RASTER_PX, RASTER_PX], nodes: [], png, width: RASTER_PX, height: RASTER_PX }
          : undefined;
      })().catch(() => undefined).then((icon) => {
        if (icon === undefined) {
          const failures = (rasterFailures.get(key) ?? 0) + 1;
          rasterFailures.set(key, failures);
          if (failures < MAX_RASTER_ATTEMPTS && rasterCache.get(key) === pending) rasterCache.delete(key);
        }
        return icon;
      });
      rasterCache.set(key, pending);
      return pending;
    }

    /** An icon as plain data (viewBox plus shapes); the phone draws it natively, no markup is sent. */
    function iconFromSvg(svg) {
      const box = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/u).map(Number);
      const viewBox = box.length === 4 && box.every(Number.isFinite) ? box
        : [0, 0, Number.parseFloat(svg.getAttribute('width')) || 16, Number.parseFloat(svg.getAttribute('height')) || 16];
      if (needsRaster(svg)) return rasterIcon(svg, viewBox);
      const styleOf = (element, base) => {
        const style = { ...base };
        for (const [attribute, key] of ICON_STYLE_ATTRS) {
          const value = element.getAttribute(attribute);
          if (value === null || value === '') continue;
          style[key] = key === 'strokeWidth' ? Number.parseFloat(value) : value;
        }
        return style;
      };
      const nodes = [];
      const visit = (element, inherited, matrix) => {
        for (const child of Array.from(element.children || [])) {
          const tag = String(child.tagName || '').toLowerCase();
          const style = styleOf(child, inherited);
          const list = child.transform?.baseVal;
          const own = list && list.numberOfItems > 0 ? list.consolidate()?.matrix : undefined;
          const next = own ? multiply(matrix, [own.a, own.b, own.c, own.d, own.e, own.f]) : matrix;
          if (tag === 'g') { visit(child, style, next); continue; }
          const names = ICON_TAG_ATTRS[tag];
          if (!names) continue;
          const node = { tag };
          for (const name of names) {
            const value = child.getAttribute(name);
            if (value === null) continue;
            node[name] = name === 'd' || name === 'points' ? value : Number.parseFloat(value);
          }
          node.fill = paint(style.fill ?? 'currentColor');
          node.stroke = paint(style.stroke ?? 'none');
          if (Number.isFinite(style.strokeWidth)) node.strokeWidth = style.strokeWidth;
          if (style.strokeLinecap) node.strokeLinecap = style.strokeLinecap;
          if (style.strokeLinejoin) node.strokeLinejoin = style.strokeLinejoin;
          if (style.fillRule) node.fillRule = style.fillRule;
          if (next.some((value, index) => value !== IDENTITY[index])) node.matrix = next;
          nodes.push(node);
        }
      };
      // The root carries the defaults (fill="none", stroke-width) its shapes inherit.
      visit(svg, styleOf(svg, {}), IDENTITY);
      return nodes.length ? { viewBox, nodes } : undefined;
    }

    /** Render a DSH icon component off screen, so hooks, memo and forwardRef behave as they do in DSH. */
    function renderIcon(Component, props) {
      if (typeof Component !== 'function' && (typeof Component !== 'object' || Component === null)) return undefined;
      const client = optionalRequire('react-dom/client');
      const dom = optionalRequire('react-dom');
      if (!client?.createRoot || !dom?.flushSync) return undefined;
      const container = document.createElement('div');
      const root = client.createRoot(container);
      try {
        dom.flushSync(() => root.render(h(Component, props)));
        const svg = container.querySelector('svg');
        return svg ? iconFromSvg(svg) : undefined;
      } catch { return undefined; } finally {
        try { root.unmount(); } catch { /* The container is discarded either way. */ }
      }
    }

    function startNavigationPublisher(ctx) {
      if (typeof setTimeout !== 'function') return undefined;
      const slotsModule = optionalRequire('@deepseek-ai/dsh-client-ui-slots');
      const primitives = optionalRequire('@deepseek-ai/dsh-client-ui-primitives');
      const label = (options, fallback) => {
        try {
          const resolved = slotsModule?.resolveSlotLabel?.(options?.label);
          if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
        } catch { /* Fall through to the plain forms. */ }
        const value = options?.label;
        if (typeof value === 'function') {
          try { const text = value(); if (typeof text === 'string' && text.trim()) return text.trim(); } catch { /* ignore */ }
        }
        return typeof value === 'string' && value.trim() ? value.trim() : fallback;
      };
      const entriesOf = (name) => { const list = ctx.slots?.entries?.(name); return Array.isArray(list) ? list : undefined; };
      const source = (entry) => (typeof entry?.registrant === 'string' ? entry.registrant : undefined);
      const translatedLabel = (options, fallback) => {
        const title = label(options, fallback);
        const titles = ui?.navigationLabelTranslations?.(ctx.locale, options, title);
        return { title, ...(titles ? { titles } : {}) };
      };

      // Each collector returns undefined when its registry cannot be read, so the host keeps what it had.
      const collectSidebar = () => {
        const entries = ctx.slots?.entriesOfSlot?.('sidebar.panellist');
        if (!Array.isArray(entries)) return undefined;
        return entries.filter((entry) => entry?.options?.id !== undefined).map((entry) => ({
          id: String(entry.options.id),
          ...translatedLabel(entry.options, String(entry.options.id)),
          order: entry.options.order ?? 0,
          source: source(entry),
          icon: renderIcon(entry.component, { size: 20, active: false }),
        }));
      };
      const collectViews = () => {
        const entries = entriesOf('conversation.view');
        if (!entries) return undefined;
        // DSH hides the Trajectory tab unless developer tools are on.
        let developer = true;
        try { developer = ctx.configForms?.developerTools?.enabled?.getSnapshot?.() !== false; } catch { /* keep */ }
        return entries
          .filter((entry) => entry?.options?.id !== undefined && (developer || entry.options.id !== 'trajectory'))
          .map((entry) => ({
            id: String(entry.options.id),
            ...translatedLabel(entry.options, String(entry.options.id)),
            order: entry.options.order ?? 0,
            source: source(entry),
          }));
      };
      const collectSettings = () => {
        const entries = entriesOf('settings.section');
        if (!entries) return undefined;
        return entries.filter((entry) => entry?.options?.id !== undefined).map((entry) => {
          const id = String(entry.options.id);
          return {
            id, ...translatedLabel(entry.options, id), order: entry.options.order ?? 0, source: source(entry),
            icon: renderIcon(primitives?.[SETTINGS_ICONS[id] ?? DEFAULT_SETTINGS_ICON], { size: 20 }),
          };
        });
      };
      const collect = () => {
        const snapshot = { schemaVersion: 1 };
        for (const [name, read] of [
          ['sidebar', collectSidebar], ['views', collectViews], ['settings', collectSettings],
        ]) {
          try { const list = read(); if (list) snapshot[name] = list; } catch { /* leave the list out */ }
        }
        return snapshot;
      };

      let disposed = false;
      let timer;
      let lastSignature = '';
      // An icon drawn by the browser arrives a moment later than the shapes of the others.
      const settleIcons = async (snapshot) => {
        const items = ['sidebar', 'settings'].flatMap((name) => snapshot[name] ?? []);
        await Promise.all(items.map(async (item) => {
          const icon = await item.icon;
          if (icon === undefined) delete item.icon; else item.icon = icon;
        }));
      };
      const publish = async () => {
        timer = undefined;
        if (disposed) return;
        const snapshot = collect();
        await settleIcons(snapshot);
        if (disposed) return;
        const signature = JSON.stringify(snapshot);
        if (signature === lastSignature || Object.keys(snapshot).length < 2) return;
        try {
          await request('nav', snapshot);
          lastSignature = signature;
        } catch { /* The next change or refresh retries; the phone keeps the last snapshot meanwhile. */ }
      };
      const schedule = () => {
        if (disposed) return;
        clearTimeout(timer);
        timer = setTimeout(publish, NAV_DEBOUNCE_MS);
      };

      const unsubscribers = [];
      const subscribed = new Set();
      const subscribe = (key, attach) => {
        if (subscribed.has(key)) return;
        try {
          const dispose = attach();
          if (typeof dispose === 'function') { unsubscribers.push(dispose); subscribed.add(key); }
        } catch { /* The service is not there (yet); the periodic refresh tries again. */ }
      };
      const watch = () => {
        for (const name of ['sidebar.panellist', 'conversation.view', 'settings.section']) {
          subscribe(name, () => ctx.slots.subscribe(name, schedule));
        }
        subscribe('locale', () => ctx.locale.subscribe(schedule));
        subscribe('developerTools', () => ctx.configForms.developerTools.enabled.subscribe(schedule));
      };

      // Plugins register as DSH loads them, so look again a few times while it settles, then rarely.
      const timers = NAV_WARMUP_MS.map((delay) => setTimeout(() => { watch(); schedule(); }, delay));
      const interval = setInterval(() => { watch(); schedule(); }, NAV_REFRESH_MS);
      watch();
      schedule();
      return () => {
        disposed = true;
        clearTimeout(timer);
        timers.forEach((handle) => clearTimeout(handle));
        clearInterval(interval);
        unsubscribers.forEach((dispose) => { try { dispose(); } catch { /* already gone */ } });
      };
    }

    // ---- Providers: the harnesses installed on this computer -------------------------------------------
    //
    // A harness the plugin found (Claude Code, Codex) is a model route of DSH. Two pieces of DSH's own interface
    // learn about it, both through the public client APIs and without editing any DSH package:
    //
    //  1. Scoping. `modelDirectories.directoryFor(sessionId)` returns the per-session ModelDirectory whose store
    //     feeds both the composer's model seat and the `/model` popup. Wrapping that store's `set` so `groups`
    //     only holds the groups of the session's current provider scopes both at once, with DSH's own menu,
    //     search, effort row and keyboard handling untouched.
    //  2. The chip. `conversation.hero.agentPreset` is a `single` slot rendered last in the new-session screen's
    //     chip row and occupied by the mode chip. A single slot renders its lowest-priority entry, so an entry
    //     at priority -1 shadows it; it declares a child slot and re-hosts a clone of the original entry there,
    //     so the mode chip keeps working and the provider chip is rendered beside it.
    //
    // The provider is chosen by selecting that provider's default model through the directory's own `select()`,
    // which is `session.selectModel` and so a `model/selection` event in the session's log.

    const PROVIDERS = 'dudu-providers';
    const HERO_SLOT = 'conversation.hero.agentPreset';
    const MODE_SLOT = 'dudu.hero.mode';
    // Routes that are whole harnesses. Every other route belongs to the DeepSeek family (DeepSeek Account,
    // DeepSeek, and any API-key provider the user configured).
    // This shell cannot import host/providers/catalog.mjs, so the ids are written here too: tests/harness-lists.test.ts fails when the two differ.
    const HARNESS = new Set(['claude', 'codex', 'pi', 'grok', 'kimi', 'opencode', 'antigravity', 'codebuddy', 'devin', 'factory', 'qwen', 'qoder']);
    const familyOf = (provider) => (HARNESS.has(provider) ? provider : 'deepseek');

    // The look of the mode chip (dsh-client-ui-agent-preset), under this plugin's own class names.
    const providerStyles = `
.dudu-menuAnchor{min-width:54px;max-width:100%}
.dudu-seat{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(100%,240px);min-height:28px;color:var(--dsw-alias-label-primary);white-space:nowrap;cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
.dudu-seat:not(:disabled):hover,.dudu-seat[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dudu-seat:disabled{cursor:default;color:var(--dsw-alias-label-quaternary)}
.dudu-seatIcon{width:16px;height:16px;color:var(--dsw-alias-label-primary);flex:none}
.dudu-seatLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dudu-chevron{color:var(--dsw-alias-label-caption);flex:none}
.dudu-itemName{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
`;

    const noopSubscribe = () => () => {};
    const emptyState = { current: null, groups: [], status: 'idle', pending: null };

    function scopeState(state) {
      const selection = state?.current;
      if (!selection || !Array.isArray(state.groups)) return state;
      const family = familyOf(selection.provider);
      const groups = state.groups.filter((group) => familyOf(group.id) === family);
      return groups.length === state.groups.length ? state : { ...state, groups };
    }

    function installScoping(service) {
      const wrapped = new Map();
      const refreshCatalog = () => {
        const catalog = service.catalog;
        if (catalog?.store.getSnapshot().status !== 'loading') catalog?.refresh?.();
      };
      const scope = (directory) => {
        if (!wrapped.has(directory)) {
          const store = directory.store;
          const originalSet = store.set;
          const originalLoad = directory.load;
          wrapped.set(directory, { originalSet, originalLoad });
          store.set = (next) => originalSet(scopeState(next));
          directory.load = function load() {
            const catalog = service.catalog?.store.getSnapshot();
            const current = this.store.getSnapshot().current;
            // DSH caches a provider-local failure as a ready catalog. A menu read must retry that failed load.
            if (catalog?.status === 'ready' && catalog.value?.failures?.some((failure) => !current || familyOf(failure.id) === familyOf(current.provider))) refreshCatalog();
            return originalLoad.call(this);
          };
          directory.syncInputs(); // publish the current state again, through the wrapper
        }
        return directory;
      };
      const original = service.directoryFor;
      service.directoryFor = function directoryFor(sessionId) { return scope(original.call(this, sessionId)); };
      try { for (const directory of service.live.directories.values) scope(directory); } catch { /* none yet */ }
      window.addEventListener('online', refreshCatalog);
      window.addEventListener('dudu:providers-changed', refreshCatalog);
      return () => {
        window.removeEventListener('online', refreshCatalog);
        window.removeEventListener('dudu:providers-changed', refreshCatalog);
        delete service.directoryFor;
        for (const [directory, { originalSet, originalLoad }] of wrapped) {
          directory.store.set = originalSet;
          directory.load = originalLoad;
          try { directory.syncInputs(); } catch { /* the directory is already gone */ }
        }
        wrapped.clear();
      };
    }

    // The directory exists once the session has a scope and a binding; before that `directoryFor` throws. The lookup
    // is cheap and idempotent (the service caches), so it is repeated on every render, and while it fails a short
    // timer forces another render instead of caching the failure.
    function useDirectory(service, sessionId) {
      const [attempt, retry] = useState(0);
      let directory;
      if (sessionId !== undefined) {
        try { directory = service.directoryFor(sessionId); } catch { directory = undefined; }
      }
      useEffect(() => {
        if (directory !== undefined || sessionId === undefined) return undefined;
        const timer = setTimeout(() => retry((value) => value + 1), 250);
        return () => clearTimeout(timer);
      }, [directory, sessionId, attempt]);
      const state = useSyncExternalStore(
        directory ? directory.store.subscribe : noopSubscribe,
        directory ? directory.store.getSnapshot : () => emptyState,
      );
      return { directory, state };
    }

    // What the chip offers, from the Host's catalog: the DeepSeek family as one entry (when any of its groups has
    // models) and one entry per harness that is registered and has models.
    function providersOf(catalog) {
      const groups = catalog?.value?.groups ?? [];
      const result = [];
      const deepseek = groups.filter((group) => !HARNESS.has(group.id));
      if (deepseek.length > 0) result.push({ id: 'deepseek', name: 'DeepSeek', groups: deepseek });
      for (const group of groups) if (HARNESS.has(group.id)) result.push({ id: group.id, name: group.name, groups: [group] });
      return result;
    }

    const groupRank = (group) => (group.id === 'deepseek-account' ? 0 : group.id === 'deepseek-official' ? 1 : 2);

    // The provider's default model: the deployment's default when it belongs to the provider, else the first model of
    // its first group (DSH's own provider order), with that model's default reasoning effort.
    function defaultSelection(provider, catalog) {
      const fallback = catalog?.value?.default;
      const groups = [...provider.groups].sort((a, b) => groupRank(a) - groupRank(b));
      if (fallback && familyOf(fallback.provider) === provider.id
        && groups.some((group) => group.id === fallback.provider && group.models.some((model) => model.id === fallback.model))) {
        return fallback;
      }
      const model = groups[0].models[0];
      return { provider: groups[0].id, model: model.id, ...(model.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : {}) };
    }

    function providerChip({ Menu, IconChevronDownOutlineRegular, IconCordisPluginOutlineRegular }, service) {
      return function ProviderChip({ sessionId }) {
        useLanguage();
        const { directory, state } = useDirectory(service, sessionId);
        const catalog = useSyncExternalStore(service.catalog.store.subscribe, service.catalog.store.getSnapshot);
        const [open, setOpen] = useState(false);
        const [error, setError] = useState('');
        const providers = useMemo(() => providersOf(catalog), [catalog]);
        useEffect(() => { directory?.load().catch(() => {}); }, [directory]);
        // With one provider there is nothing to choose: render nothing and leave DSH's own row as it is.
        if (!directory || providers.length < 2 || !state.current) return null;
        const family = familyOf(state.current.provider);
        const current = providers.find((provider) => provider.id === family) ?? providers[0];
        const pick = async (id) => {
          setOpen(false);
          const next = providers.find((provider) => provider.id === id);
          if (!next || next.id === family) return;
          setError('');
          const result = await directory.select(defaultSelection(next, catalog));
          if (!result.ok) setError(`${result.error.code}: ${result.error.message}`);
        };
        return h(Menu, {
          open,
          onClose: () => setOpen(false),
          items: providers.map((provider) => ({ id: provider.id, label: h('span', { className: 'dudu-itemName' }, provider.name) })),
          selectedId: current.id,
          onSelect: pick,
          align: 'start',
          portal: true,
          className: 'dudu-menuAnchor',
          anchor: h('button', {
            type: 'button',
            className: 'dudu-seat',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': S?.providerChip(current.name) ?? `供应商，当前 ${current.name}`,
            title: error || undefined,
            'data-testid': 'dudu-provider-chip',
            disabled: state.status === 'selecting',
            onClick: () => setOpen((value) => !value),
          },
          ui?.AgentLogo
            ? h(ui.AgentLogo, { agent: current.id, className: 'dudu dudu-seatIcon' })
            : h(IconCordisPluginOutlineRegular, { className: 'dudu-seatIcon' }),
          h('span', { className: 'dudu-seatLabel' }, current.name),
          h(IconChevronDownOutlineRegular, { className: 'dudu-chevron' })),
        });
      };
    }

    // The entry that shadows the hero's mode chip: the provider chip, then the original mode chip, which is only for the DeepSeek family (the mode is DSH's own, so it
    // comes after the provider it depends on and is not there for any other; owner, 2026-11-06: "换一个位置").
    function installHeroChip(ctx, service, ProviderChip) {
      function Hero(props) {
        const { state } = useDirectory(service, props.sessionId);
        const family = state.current ? familyOf(state.current.provider) : 'deepseek';
        return h(Fragment, null,
          h(ProviderChip, { sessionId: props.sessionId }),
          family === 'deepseek' ? props.renderSlot(MODE_SLOT, {}) : null);
      }
      let cloneOf;
      let disposeClone = () => {};
      const sync = () => {
        const original = ctx.slots.entries(HERO_SLOT).find((entry) => entry.registrant !== PROVIDERS);
        if (original === cloneOf) return;
        disposeClone();
        disposeClone = () => {};
        cloneOf = original;
        if (!original) return;
        disposeClone = ctx.slots.register({
          name: MODE_SLOT,
          ...(original.inject ? { inject: original.inject } : {}),
          ...(original.locale ? { locale: original.locale } : {}),
          registrant: `${PROVIDERS}:mode`,
        }, original.component);
      };
      return ctx.slots.inject(HERO_SLOT, () => {
        const disposeHero = ctx.slots.register({
          name: HERO_SLOT,
          priority: -1,
          children: { [MODE_SLOT]: { kind: 'single', scope: 'session-maybe' } },
          registrant: PROVIDERS,
        }, Hero);
        const unsubscribe = ctx.slots.subscribe(HERO_SLOT, sync);
        sync();
        return () => {
          unsubscribe();
          disposeClone();
          cloneOf = undefined;
          disposeHero();
        };
      });
    }

    // The chip and the scoping need services only some DSH builds have, so they are a plugin of their own that waits
    // for them; the settings page and the phone navigation never depend on it. The caller of the model directory's
    // methods has to declare the injects the service itself declares (Cordis' strict injection).
    const providerUi = {
      name: PROVIDERS,
      inject: ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'],
      apply(ctx) {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = providerStyles;
          document.head.appendChild(style);
          return () => style.remove();
        });
        ctx.effect(() => installScoping(ctx.modelDirectories));
        ctx.effect(() => installHeroChip(ctx, ctx.modelDirectories, providerChip(primitives, ctx.modelDirectories)));
        ctx.effect(() => ui?.installHarnessStats(ctx, { createElement: h, useMemo }));
        ctx.effect(() => ui?.installHarnessForeground(ctx, { createElement: h, useEffect, useState }, request));
      },
    };

    // ---- The 嘟嘟 panel: the sessions the harnesses on this computer already have ------------------------------------
    //
    // A global panel of DSH's sidebar, added the way DSH's own plugins add theirs (a `sidebar.panellist` entry that
    // selects a panel, and a `main` page keyed by the same id). It lists the Claude Code and Codex sessions the plugin
    // finds on this computer, searchable, and loads one into DSH: the host writes a session that holds the
    // conversation and resumes the harness's own session, and this page then opens it.

    const PANEL_ID = 'dudu';
    // The Dudu logo, transparent behind it, as DSH's sidebar draws its icons.
    const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAP1BMVEUudvI3bug3cOtiYv8AAP84ce0ycbtUqP9VVao/P78Af38zmf8AAAA5dPAA//8zaNoAAAAAAAAAAAAAAAAAAAD5D19zAAAAEHRSTlMSZJ8CAdEEAwMEAgUA/AEUQQBTPQAAAuJJREFUeNrtmt2WqyAMhTeQQNuD8P5vexDbOWP50UK8Oau5mDV1aT53QAgB+IsNX8DqAy54b/LfCwAw//53JA9I7qE0M2utkH+KAggeevkxjYIwByDjf7lPxgUBov6TKX+TAxivlsJAkAIYj9L/ovdBmgG4MkBZwo4wAQhVAasEyABMA8CeZACoNfFq8TfhGkC4FoCrAfEL+LbB/xwiSnYNgGDh8JzFABNEQ/Swr/H9bu39OVQDUgqMyamV0nrNTZ7pyfoUOSMAyN5T2lNMKmsONB+i1b3SdS8LK/CcgmC8VQ0fXTsJSK8/5P5siKyPehmzMwrItVpQRgGZCf8nFNRyTkkAuSn/xwDM+T8EYCb+JxrZzPo/ACBg0v9BiMxkAxwpmA9QXwEhTvvvKrACAnoKiM4IUEqNKjjzCXBMN0YeUxBQmRz1+/vFW/QYApSrLi6m3m2JZ3uduQ0oB6GUnCDurqqA/DmqoTa4c2VFegP2yHTjrRejpoIyQiq4vCDm96fRAzQVlH1oW5DuIve6NKKgaAKuXN+eHg2RrhYFdsq2SgRIjfSiB78r2NJo0r/rQWjXQfoA8rH8aOldGVs8vKWRD+1RABasnf5tgFJ+vagHAJWeofyfsnMpuysETgHSvTEWIxvz2HxQA6xjEbTQfBB8bTLQWmxGI295kbDOfHAxQCBjORqL1NUKLgaQB1/byEKN0JuTlQygVTclL5A4LnxvF2adRIy4U7vuTrVnrVscl5CgUlrWBCBE2U5ULEDcdEc62gExxLPLjz4AhEkBR7tQkyPS2yaU+EJcndmomyDoXRdtVluGCakH0am9TIwN3BX/rYrXUEFNVfw3a3aflwR19O6THfEPi5q6tll9UDfNe92nEJzdh48PDdAqGZqPvOetdjN0KoHyKYBa8frpe6the4vxYw8GuWdEpAqF/rH0A8DrWAJNnquAtQ0XNxgIHdwgGJve2TljHFazBuF7tkUE8Bfa9K2SazMwbgAAAABJRU5ErkJggg==';
    const AGENTS = [{ id: 'all', name: '全部' }, { id: 'claude', name: 'Claude' }, { id: 'codex', name: 'ChatGPT' }];
    const RECENT = 8;   // sessions on the overview itself
    const MORE = 200;   // when "全部" is opened
    const FOUND = 50;   // answers to a search

    const panelStyles = `
[role="tree"] [role="treeitem"][data-row-key^="session:"]{padding-inline-start:calc(24px + var(--dsh-workspace-indent,0px))}
.dudu-page{height:100%;overflow:auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dudu-page *{box-sizing:border-box}
.dudu-wrap{max-width:1000px;margin:0 auto;padding:18px 28px 40px}
.dudu-bar{display:flex;align-items:center;gap:8px;margin:0 0 16px}.dudu-search{flex:1 1 auto;min-width:0}
.dudu-tabs{display:flex;gap:2px;flex:none}
.dudu-tab{height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dudu-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}.dudu-tab[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:500}
.dudu-phone{display:inline-flex;align-items:center;gap:6px;flex:none;padding:0 4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dudu-index{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.dudu-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-quaternary,#b8b8b8);flex:none}
.dudu-dot--on,.dudu-dot--done{background:#2fb344}.dudu-dot--busy{background:#4176e6;animation:dudu-pulse 1.4s ease-in-out infinite}
@keyframes dudu-pulse{50%{opacity:.35}}
.dudu-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin:0 0 20px}
.dudu-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.dudu-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:12px 14px;min-width:0}
.dudu-label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dudu-name{display:flex;align-items:baseline;gap:8px;margin:6px 0 2px;font-weight:500}.dudu-name:first-of-type{margin-top:0}
.dudu-warn{color:var(--dsw-alias-state-error-primary);font-weight:400;font-size:12px}
.dudu-run{display:flex;align-items:center;gap:8px;padding:3px 0;min-width:0}
.dudu-run b{flex:1 1 auto;min-width:0;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dudu-run em{flex:0 1 38%;min-width:0;font-style:normal;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.dudu-run span{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.dudu-run--open{cursor:pointer}.dudu-run--open:hover b{text-decoration:underline}
.dudu-fold{display:flex;align-items:center;gap:8px;margin:2px 0 0;padding:3px 0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.dudu-fold:hover{color:var(--dsw-alias-label-primary)}
.dudu-idle{max-height:180px;overflow:auto;margin-top:2px}
.dudu-none{color:var(--dsw-alias-label-secondary)}
.dudu-section{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dudu-list{border-top:.5px solid var(--dsw-alias-border-l2)}
.dudu-row{padding:7px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);cursor:pointer}.dudu-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dudu-main{display:flex;align-items:center;gap:10px;min-width:0}
.dudu-title{flex:1 1 auto;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dudu-meta{flex:0 1 auto;display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.dudu-meta span:first-child{max-width:200px;overflow:hidden;text-overflow:ellipsis}
.dudu-badge{display:inline-block;flex:none;padding:0 7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dudu-preview{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.dudu-more{margin-top:8px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dudu-more code{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-primary)}.dudu-more .dudu-actions{display:flex;gap:8px;margin-top:6px}
.dudu-note{padding:22px 10px;color:var(--dsw-alias-label-secondary);text-align:center}.dudu-fail{margin-top:4px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dudu-count{margin:8px 2px 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.dudu-mark{background:color-mix(in srgb,#ffb800 38%,transparent);color:inherit;border-radius:2px}
@media(max-width:760px){.dudu-wrap{padding:14px 14px 32px}.dudu-grid{grid-template-columns:minmax(0,1fr)}.dudu-bar{flex-wrap:wrap}.dudu-meta span:first-child{max-width:110px}}
`;

    const ago = (time) => {
      const seconds = Math.max(0, (Date.now() - time) / 1000);
      if (seconds < 60) return '刚刚';
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
      if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
      return new Date(time).toLocaleDateString('zh-CN');
    };
    // How long, without "ago": 12 分钟, 3 小时, 2 天.
    const span = (time) => {
      const seconds = Math.max(0, (Date.now() - time) / 1000);
      if (seconds < 60) return '';
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
      return `${Math.floor(seconds / 86400)} 天`;
    };
    const shortPath = (path, home) => {
      if (!path) return '';
      const text = home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
      const parts = text.split('/');
      return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : text;
    };
    const quote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
    const resumeCommand = (session) => `${session.cwd ? `cd ${quote(session.cwd)} && ` : ''}${session.provider === 'claude' ? 'claude --resume' : session.provider === 'pi' ? 'pi --session' : 'codex resume'} ${session.id}`;
    const agentName = (provider) => (provider === 'claude' ? 'Claude' : provider === 'pi' ? 'Pi' : 'ChatGPT');
    const termsOf = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);
    // A lone letter would light up half the words of a snippet.
    const markable = (terms) => terms.filter((term) => term.length > 1 || /[^\x00-\x7f]/.test(term));
    // The text with the words of the query marked.
    const highlight = (text, terms) => {
      terms = markable(terms);
      if (!terms.length) return text;
      const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      return text.split(pattern).map((part, index) => (index % 2 ? h('mark', { key: index, className: 'dudu-mark' }, part) : part));
    };

    function DuduGlyph({ size = 18, home = false }) {
      return h('img', { src: LOGO, width: size, height: size, alt: '', 'aria-hidden': 'true', 'data-dudu-home': home ? '' : undefined, draggable: false, style: { display: 'block' } });
    }

    // Reads something now and again after the time `delay` says (a number, or a function of the last reading); keeps the last
    // reading when one fails.
    function usePoll(read, delay) {
      const [value, setValue] = useState(null);
      useEffect(() => {
        let alive = true;
        let timer;
        const tick = async () => {
          let next = typeof delay === 'function' ? delay(null) : delay;
          try {
            const result = await read();
            if (alive) setValue(result);
            if (typeof delay === 'function') next = delay(result);
          } catch { /* the last reading stays */ }
          if (alive) timer = setTimeout(tick, next);
        };
        tick();
        return () => { alive = false; clearTimeout(timer); };
      }, []);
      return value;
    }

    function RunningRow({ item, kind, home, onOpen }) {
      const state = kind === 'busy' ? `忙${span(item.since) ? ` ${span(item.since)}` : ''}` : kind === 'done' ? `${ago(item.since)}完成` : `空闲中${span(item.since) ? ` ${span(item.since)}` : ''}`;
      const open = item.dshSessionId ? () => onOpen(item.dshSessionId) : undefined;
      return h('div', { className: `dudu-run${open ? ' dudu-run--open' : ''}`, 'data-testid': 'dudu-running', 'data-state': kind, onClick: open },
        h('i', { className: `dudu-dot dudu-dot--${kind === 'busy' ? 'busy' : kind === 'done' ? 'done' : ''}` }),
        h('b', { title: item.title }, item.title || agentName(item.provider)),
        h('em', { title: item.cwd ?? '' }, shortPath(item.cwd, home)),
        h('span', null, state));
    }

    function RunningCard({ running, home, onOpen }) {
      const [unfolded, setUnfolded] = useState(false);
      const lead = running ? [...running.busy, ...running.done].slice(0, 8) : [];
      const left = running ? running.idle.length + (running.busy.length + running.done.length - lead.length) : 0;
      return h('div', { className: 'dudu-card', 'data-testid': 'dudu-runningcard' },
        h('div', { className: 'dudu-label' }, '正在运行', running && running.busy.length > 0 && h('span', null, `${running.busy.length} 忙`)),
        !running && h('div', { className: 'dudu-none' }, '…'),
        running && lead.length === 0 && left === 0 && h('div', { className: 'dudu-none' }, '没有在运行的会话'),
        lead.map((item) => h(RunningRow, { key: `${item.provider}:${item.id}`, item, kind: item.status, home, onOpen })),
        left > 0 && h('button', { type: 'button', className: 'dudu-fold', onClick: () => setUnfolded(!unfolded), 'aria-expanded': unfolded },
          `另有 ${left} 个空闲`, h('span', null, unfolded ? '收起' : '展开')),
        unfolded && h('div', { className: 'dudu-idle' }, running.idle.map((item) => h(RunningRow, { key: `${item.provider}:${item.id}`, item, kind: 'idle', home, onOpen }))));
    }

    function SessionRow({ session, home, terms, expanded, busy, failure, onToggle, onOpen }) {
      const [copied, setCopied] = useState(false);
      const copy = async (event) => {
        event.stopPropagation();
        try { await navigator.clipboard.writeText(resumeCommand(session)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the page may not be allowed to copy */ }
      };
      return h('div', { className: 'dudu-row', 'data-testid': 'dudu-session', 'data-key': session.key, onClick: onToggle },
        h('div', { className: 'dudu-main' },
          h('span', { className: 'dudu-badge' }, agentName(session.provider)),
          h('div', { className: 'dudu-title', title: session.title }, highlight(session.title, terms)),
          h('div', { className: 'dudu-meta' },
            session.cwd && h('span', { title: session.cwd }, shortPath(session.cwd, home)),
            h('span', null, ago(session.updatedAt)),
            h(Button, {
              size: 'sm', variant: session.dshSessionId ? 'outline' : 'primary', className: 'dudu-button', disabled: busy,
              onClick: (event) => { event.stopPropagation(); onOpen(); },
            }, busy ? '加载中…' : session.dshSessionId ? '打开' : '加载到 DSH'))),
        session.evidence && h('div', { className: 'dudu-preview' }, highlight(session.evidence.text, terms)),
        failure && h('div', { className: 'dudu-fail', role: 'alert' }, failure),
        expanded && h('div', { className: 'dudu-more' },
          session.preview && h('div', null, highlight(session.preview, terms)),
          session.cwd && h('div', null, '目录：', h('code', null, session.cwd)),
          h('div', null, '会话 ID：', h('code', null, session.id)),
          h('div', { className: 'dudu-actions' },
            h(Button, { size: 'sm', variant: 'outline', className: 'dudu-button', onClick: copy }, copied ? (S?.copied ?? '已复制') : '复制恢复命令'))));
    }

    function DuduPage({ openSession }) {
      const [query, setQuery] = useState('');
      const [agent, setAgent] = useState('all');
      const [showAll, setShowAll] = useState(false);
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [expanded, setExpanded] = useState('');
      const [busy, setBusy] = useState('');
      const [failure, setFailure] = useState({});
      const latest = useRef(0);
      const searching = query.trim() !== '' || agent !== 'all';
      const limit = searching ? FOUND : showAll ? MORE : RECENT;
      const running = usePoll(() => request('overview/running'), 5_000);
      const phone = usePoll(() => request('state'), 30_000);
      const fetchList = (refresh = false) => {
        const ticket = ++latest.current;
        return request('sessions/list', { query: query.trim(), ...(agent === 'all' ? {} : { provider: agent }), limit, refresh })
          .then((value) => { if (ticket === latest.current) { setData(value); setError(''); } },
            (problem) => { if (ticket === latest.current) setError(problem.message); });
      };
      useEffect(() => {
        const timer = setTimeout(() => { fetchList(); }, data ? 180 : 0);
        return () => clearTimeout(timer);
      }, [query, agent, showAll]);
      // While the conversations are still being read for the search, look again until they are.
      useEffect(() => {
        if (!data?.indexing?.running) return undefined;
        const timer = setTimeout(() => { void fetchList(); }, 2000);
        return () => clearTimeout(timer);
      }, [data]);
      const open = async (session) => {
        setBusy(session.key);
        setFailure((previous) => ({ ...previous, [session.key]: '' }));
        try {
          const result = await request('sessions/load', { provider: session.provider, id: session.id });
          await openSession(result);
          if (!session.dshSessionId) void fetchList();
        } catch (problem) {
          setFailure((previous) => ({ ...previous, [session.key]: problem.message }));
        } finally { setBusy(''); }
      };
      const terms = termsOf(query);
      const unavailable = data?.providers?.filter((provider) => provider.error) ?? [];
      const online = Array.isArray(phone?.devices) && phone.devices.some((device) => Date.now() - device.lastSeenAt < 180_000);
      const home = data?.home;
      return h('div', { className: 'dudu-page', 'data-testid': 'dudu-page' },
        h('div', { className: 'dudu-wrap' },
          h('div', { className: 'dudu-bar' },
            h('div', { className: 'dudu-search' }, h(Input, {
              type: 'text', className: 'dudu-input', value: query, placeholder: '搜索会话', 'aria-label': '搜索会话',
              autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, onChange: (event) => setQuery(event.target.value),
            })),
            data?.indexing?.running && h('span', { className: 'dudu-index', role: 'status' }, `索引 ${data.indexing.done} / ${data.indexing.total}`),
            h('div', { className: 'dudu-tabs', role: 'group', 'aria-label': '筛选' }, AGENTS.map((item) => h('button', {
              key: item.id, type: 'button', className: 'dudu-tab', 'aria-pressed': agent === item.id, onClick: () => setAgent(item.id),
            }, item.name))),
            h(Button, { size: 'sm', variant: 'outline', className: 'dudu-button', onClick: () => { void fetchList(true); } }, '刷新'),
            phone && h('span', { className: 'dudu-phone', 'data-testid': 'dudu-phone' }, h('i', { className: `dudu-dot${online ? ' dudu-dot--on' : ''}` }), online ? '手机已连接' : '手机未连接')),
          !searching && h('div', { className: 'dudu-grid' },
            h('div', { className: 'dudu-col' }, h(RunningCard, { running, home, onOpen: (sessionId) => openSession({ sessionId }) }))),
          error && h('p', { className: 'dudu-error', role: 'alert' }, `读取会话失败：${error}`),
          unavailable.map((provider) => h('p', { key: provider.id, className: 'dudu-error', role: 'alert' }, `${provider.name}：${provider.error}`)),
          !searching && h('div', { className: 'dudu-section' }, h('span', null, '最近'),
            data && data.total > RECENT && h('button', { type: 'button', className: 'dudu-fold', onClick: () => setShowAll(!showAll) }, showAll ? '收起' : `全部 ${data.total}`)),
          !data && !error && h('div', { className: 'dudu-note' }, '…'),
          data && h('div', { className: 'dudu-list' },
            data.sessions.length === 0
              ? h('div', { className: 'dudu-note' }, searching ? '没有匹配的会话' : '没有会话')
              : data.sessions.map((session) => h(SessionRow, {
                key: session.key, session, home: data.home, terms, expanded: expanded === session.key, busy: busy === session.key,
                failure: failure[session.key], onToggle: () => setExpanded(expanded === session.key ? '' : session.key), onOpen: () => open(session),
              }))),
          searching && data && data.total > data.sessions.length && h('div', { className: 'dudu-count' }, `${data.sessions.length} / ${data.total}`)));
    }

    function withAbort(promise, signal) {
      if (!signal) return promise;
      return new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
        if (signal.aborted) aborted();
        else signal.addEventListener('abort', aborted, { once: true });
      });
    }

    // A session written by the plugin must be discovered before DSH's workspace can select it.
    async function untilListed(sessions, sessionId, timeout = 5000, signal) {
      signal?.throwIfAborted();
      const listed = () => {
        const state = sessions.list.getSnapshot();
        return state.ids.includes(sessionId) || sessionId in state.byId;
      };
      if (listed()) return;
      await new Promise((resolve, reject) => {
        const cleanup = () => { unsubscribe(); clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
        const done = () => { cleanup(); resolve(); };
        const aborted = () => { cleanup(); reject(signal.reason); };
        const unsubscribe = sessions.list.subscribe(() => { if (listed()) done(); });
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(S?.unavailable ?? '连接暂时不可用。'));
        }, timeout);
        signal?.addEventListener('abort', aborted, { once: true });
        // Ask for the list again, and look again once it has answered: it may have changed before anyone was listening.
        Promise.resolve(sessions.refresh?.()).catch(() => {}).then(() => { if (listed()) done(); });
      });
    }

    // The panel needs services only some DSH builds have, so it is a plugin of its own that waits for them.
    const sessionsUi = {
      name: 'dudu-sessions',
      inject: ['slots', 'layout', 'uiWorkspace', 'sessions', 'remote', 'remote.session', 'remote.skills', 'modelDirectories'],
      apply(ctx) {
        const sessionExpansion = ui?.createSessionExpansion({ layout: ctx.layout, panelId: PANEL_ID });
        ctx.effect(() => () => sessionExpansion?.dispose());
        const selectSession = (sessionId, { returnToDudu = false } = {}) => {
          ctx.uiWorkspace.openSession(sessionId);
          ctx.layout.selectPanel(null);
          if (returnToDudu) sessionExpansion?.begin(sessionId);
          else sessionExpansion?.clear();
        };
        if (sessionExpansion) ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities', id: 'dudu:session-return', order: 1000,
        }, function SessionReturn({ sessionId }) {
          useLanguage();
          const expanded = useSyncExternalStore(sessionExpansion.subscribe, sessionExpansion.getSnapshot);
          const control = useRef(null);
          const active = expanded?.sessionId === sessionId;
          useEffect(() => { sessionExpansion.visit(sessionId); }, [sessionId]);
          useEffect(() => active ? followWindowDrag(document, control.current) : undefined, [active]);
          useEffect(() => active ? ui.installSessionReturnEscape({
            view: window, restore: () => sessionExpansion.restore(sessionId),
            blocked: event => ui.sessionReturnBlocked(document, event.target),
          }) : undefined, [active, sessionId]);
          if (!active) return null;
          const label = ui.T.detail.back;
          return h(Tooltip, { label, shortcutKeys: ['Esc'], side: 'bottom', delayMs: 500 },
            h(Button, {
              ref: control, size: 'sm', className: 'dudu-session-return',
              'aria-label': label, 'aria-keyshortcuts': 'Escape', 'data-dudu-session-return': '',
              onClick: () => sessionExpansion.restore(sessionId),
            }, h(ui.SessionReturnIcon)));
        }));
        ctx.effect(() => ui?.installCollectorNotifications({
          onOpen: () => { ui.openDashboard(); ctx.layout.selectPanel(PANEL_ID); },
        }));
        // The host Team action assumes its own continuable workers. Native CLI children are observation-only.
        ctx.effect(() => {
          const service = ctx.uiWorkspace;
          const original = service.openSession;
          const hadOwn = Object.hasOwn(service, 'openSession');
          // A hot update runs this again in the window that is already open, and when the new run wraps before this one is cleaned up, the check at the end does not take this
          // wrapper out. It then stays in the chain over a context that is gone, and reading `ctx.layout` throws "inactive context" at every `uiWorkspace.openSession`, the expand
          // button's included (owner, 2026-11-24). A run that has ended only passes the call on.
          let live = true;
          const open = function openSession(target, ...args) {
            if (!live) return original.call(this, target, ...args);
            if (target && typeof target === 'object' && target.childSessionId?.startsWith('dudu-native-child-')) {
              target = { ...target, mode: 'one-shot' };
            }
            // Opened from Dudu's page (the subagent and team lists of its conversation header): the conversation gets the return button, as the expand button's does
            // (owner, 2026-11-23: 「点击了，就回不到嘟嘟这个界面了」). Dudu's own `selectSession` settles it again after this.
            const fromDudu = ctx.layout.panelInfo?.getSnapshot().activePanelId === PANEL_ID;
            const result = original.call(this, target, ...args);
            if (fromDudu) {
              const shown = typeof target === 'string' ? target : target?.childSessionId ?? target?.sessionId;
              sessionExpansion?.begin(typeof shown === 'string' ? shown : null, { claim: true });
            }
            return result;
          };
          service.openSession = open;
          return () => {
            live = false;
            if (service.openSession !== open) return;
            if (hadOwn) service.openSession = original;
            else delete service.openSession;
          };
        });
        ctx.effect(() => {
          const home = (event) => {
            const row = event.target instanceof Element ? event.target.closest('button') : null;
            if (row?.querySelector('[data-dudu-home]')) ui?.openDashboard();
          };
          document.addEventListener('click', home, true);
          return () => document.removeEventListener('click', home, true);
        });
        let historyCache;
        ctx.effect(() => {
          historyCache = ui?.installSessionHistoryCache(ctx.sessions, { workspaces: ctx.get?.('workspaces') });
          return () => { historyCache?.(); historyCache = undefined; };
        });
        ctx.effect(() => ui?.installSessionReadReceipts(ctx.sessions, request));
        ctx.effect(() => ui?.installSessionActivityUpdates(ctx.sessions));
        let embeddedSurface;
        const surfaceListeners = new Set();
        const surfaceSnapshot = () => embeddedSurface;
        const subscribeSurface = (listener) => { surfaceListeners.add(listener); return () => surfaceListeners.delete(listener); };
        const publishSurface = (surface) => { embeddedSurface = surface; for (const listener of surfaceListeners) listener(); };
        if (ui?.installEmbeddedSessionSurface) ctx.inject(['sidebarRight'], (child) => {
          const bridge = ui.installEmbeddedSessionSurface({
            sidebar: child.sidebarRight,
            openSession: selectSession,
            isVisible: () => child.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID,
          });
          publishSurface(bridge);
          child.effect(() => () => { bridge.dispose(); if (embeddedSurface === bridge) publishSurface(undefined); });
          child.slots.inject('conversation.session.header.actions', () => child.slots.register({
            name: 'conversation.session.header.actions', id: 'dudu:session-surface-ready', order: 1000,
          }, function SessionSurfaceReady({ sessionId }) {
            const onScreen = useSyncExternalStore(child.sidebarRight.mounted.subscribe, child.sidebarRight.mounted.getSnapshot);
            useEffect(() => { if (onScreen === sessionId) embeddedSurface?.committed(sessionId); }, [onScreen, sessionId]);
            return null;
          }));
        });
        if (ui?.SidebarAgent) {
          const activity = ui.createSidebarActivity(request);
          ctx.effect(() => () => activity.dispose());
          ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
            name: 'sidebar.workspaces.session.row.action', id: 'dudu-agent-state', order: 20,
          }, (props) => h(ui.SidebarAgent, { ...props, sessions: ctx.sessions, activity })));
        }
        // The scheduled tasks that go into a conversation, in its header after DSH's own team and background-jobs controls (owner, 2026-11-17; nothing until the conversation has one).
        if (ui?.SessionTasksAction) {
          const sessionTasks = ui.createSessionTasks(request);
          ctx.effect(() => () => sessionTasks.dispose());
          ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
            name: 'conversation.session.header.actions', id: 'dudu:session-tasks', order: 500,
          }, (props) => h(ui.SessionTasksAction, { ...props, tasks: sessionTasks })));
        }
        ctx.effect(() => {
          if (!ctx.sessions.list?.subscribe || !window.addEventListener) return undefined;
          let closed = false;
          let roster = '';
          let selected = '';
          const foreground = { running: false, pending: false };
          const background = { running: false, pending: false };
          const ids = () => ctx.sessions.list.getSnapshot().ids.filter((id) => !id.startsWith('dudu-assistant-'));
          const opened = () => {
            const snapshot = ctx.sessions.list.getSnapshot();
            return ids().filter((id) => {
              const retained = snapshot.byId[id]?.retainedBy;
              return retained?.mainView > 0 || retained?.duduIssuePreview > 0;
            });
          };
          const sync = async (lane, targets, recover) => {
            lane.pending = true;
            if (closed || lane.running || document.visibilityState === 'hidden') return;
            lane.running = true;
            try {
              while (lane.pending && !closed && document.visibilityState !== 'hidden') {
                lane.pending = false;
                const sessionIds = targets();
                if (!sessionIds.length) continue;
                try {
                  const result = await request('sessions/sync', { sessionIds, recover });
                  if (!closed && (result.updated?.length || result.replacements?.length)) await ctx.sessions.refresh();
                } catch { /* a disconnected window retries on focus or the next pass */ }
              }
            } finally { lane.running = false; }
          };
          // The visible conversation must not wait behind a long history elsewhere in the sidebar.
          const syncOpened = () => { void sync(foreground, opened, true); };
          const syncAll = () => { void sync(background, ids, false); };
          const changed = () => {
            const snapshot = ctx.sessions.list.getSnapshot();
            const next = ids().sort().join('\n');
            const active = opened().map((id) => `${id}:${snapshot.byId[id]?.running}`).sort().join('\n');
            if (active !== selected) { selected = active; syncOpened(); }
            if (next !== roster) { roster = next; syncAll(); }
          };
          const unsubscribe = ctx.sessions.list.subscribe(changed);
          const timer = setInterval(syncAll, 15_000);
          const activeTimer = setInterval(syncOpened, 5_000);
          const focus = () => { syncOpened(); syncAll(); };
          window.addEventListener('focus', focus);
          document.addEventListener('visibilitychange', focus);
          changed();
          return () => {
            closed = true; clearInterval(timer); clearInterval(activeTimer); unsubscribe();
            window.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', focus);
          };
        });
        // This is an ordinary Session in the controller, but has its own entry point on the dashboard.
        ctx.effect(() => {
          const source = ctx.sessions.list;
          if (typeof source?.getSnapshot !== 'function') return undefined;
          const original = source.getSnapshot;
          let previous;
          let filtered;
          function snapshot() {
            const value = original.call(source);
            if (value === previous) return filtered;
            previous = value;
            const ids = value.ids.filter((id) => !id.startsWith('dudu-assistant-'));
            // DSH also reads byId to render the selected session and its model picker.
            filtered = ids.length === value.ids.length ? value : { ...value, ids };
            return filtered;
          }
          source.getSnapshot = snapshot;
          return () => { if (source.getSnapshot === snapshot) source.getSnapshot = original; };
        });
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = panelStyles;
          document.head.appendChild(style);
          return () => style.remove();
        });
        // Listed sessions have readable history, including archived ones. This cache does not establish permission to send.
        // Retaining them starts the existing foreground synchronizer.
        const preparedSessions = new Map();
        const preparedSession = (requestedId) => {
          const sessionId = preparedSessions.get(requestedId) ?? requestedId;
          const snapshot = ctx.sessions.list.getSnapshot();
          if (snapshot.ids.includes(sessionId) || sessionId in snapshot.byId) return sessionId;
          preparedSessions.delete(requestedId);
          return null;
        };
        // Refresh discovers stored sessions; opening retains/resumes them through DSH's workspace.
        // session.create is for blank conversations and newer hosts mint a different ID for a nonblank target.
        const prepareSession = async ({ sessionId }, { signal, synchronize = false, onStage } = {}) => {
          signal?.throwIfAborted();
          const cached = preparedSession(sessionId);
          if (cached && !synchronize) return cached;
          const requestedId = sessionId;
          if (synchronize && !sessionId.startsWith('dudu-assistant-')) {
            onStage?.('sync');
            const synchronized = await request('sessions/sync', { sessionIds: [sessionId], recover: true }, { signal });
            const replacement = synchronized.replacements?.find((entry) => entry.previousId === sessionId);
            if (replacement) sessionId = replacement.sessionId;
          }
          // On cold startup the host catalog may not have arrived yet. Discover the persisted
          // session first; the existing visible-session synchronizer updates its native tail.
          // A missing client list entry is not evidence that its history needs repair.
          onStage?.('catalog');
          await withAbort(ctx.sessions.refresh(), signal);
          await untilListed(ctx.sessions, sessionId, 5000, signal);
          preparedSessions.set(requestedId, sessionId);
          preparedSessions.set(sessionId, sessionId);
          return sessionId;
        };
        const openSession = async (target, { from, returnToDudu = false } = {}) => {
          const sessionId = await prepareSession(target);
          selectSession(sessionId, { returnToDudu });
          if (from?.width > 0 && from?.height > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            await new Promise(requestAnimationFrame);
            // The public main slot is display:contents; its parent is DSH's conversation column.
            const surface = document.querySelector('[data-slot="main"]')?.parentElement;
            const to = surface?.getBoundingClientRect();
            if (to?.width > 0 && to?.height > 0) surface.animate([
              { transformOrigin: 'top left', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, clipPath: 'inset(0 round 20px)', opacity: 0.6 },
              { transformOrigin: 'top left', transform: 'none', clipPath: 'inset(0 round 0px)', opacity: 1 },
            ], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
          }
        };
        const Page = () => h(DuduPage, { openSession });
        if (ui) {
          ctx.effect(() => {
            const style = document.createElement('style');
            style.textContent = ui.css;
            document.head.appendChild(style);
            return () => style.remove();
          });
        }
        // The page opens a session in DSH as `{ sessionId, workspaceId }`. One that the plugin started for an issue may have been folded away in
        // the sidebar: the plugin puts it back first, and says which workspace it lives in (DSH ties a session to its folder, and refuses to
        // adopt it into another); it does nothing for a session it does not know.
        // Use the same host attachment protocol for Dudu's conversation and an explicit @issue delivery.
        const prepareAttachments = async (sessionId, attachments) => {
          const content = [];
          for (const item of attachments) {
            if (item.kind !== 'file') { content.push({ type: 'image', mediaType: item.mediaType, data: item.data, name: item.name }); continue; }
            const uploader = ctx.get?.('fileUpload');
            if (!uploader) throw new Error('This DSH cannot take files.');
            const uploaded = await uploader.upload(sessionId, item.file, item.name);
            if (uploaded.error) throw new Error(uploaded.error.message);
            content.push({ type: 'file', receiptId: (uploaded.value ?? uploaded).receiptId });
          }
          return content;
        };
        const findConversation = ui?.createConversationFinder(async (sessionId, page, signal) => {
          const result = await ctx.remote.session.page({
            address: { kind: 'session', sessionId }, maxMessages: 100, ...page,
          }, signal);
          if (result.error) throw new Error(result.error.message);
          return result.value ?? result;
        });
        const actions = {
          sessionExpansion,
          pickProjectDirectory: () => ctx.uiWorkspace.pickDirectory(),
          findConversation,
          conversationFindNodes: (reference) => ctx.get('uiConversation').binding(reference.binding)
            .target('chat').getSnapshot().nodes.values(),
          conversationPermissionLabel: (option) => {
            const key = { 'read-only': 'preset.readOnly', 'workspace-write': 'preset.workspaceWrite', 'danger-full-access': 'preset.fullAccess' }[option.value];
            return key ? ctx.locale.bind('settings.permission')(key) : option.name;
          },
          conversationPermissionTitle: () => ctx.locale.bind('settings.permission')('title'),
          retainCachedSession: (issue) => historyCache?.retain(issue),
          sessionOpenFailed: (failure) => console.error('[dudu] Session opening failed', failure),
          retainSession: async (target, { signal, issue, onStage } = {}) => {
            let sessionId = await prepareSession(target, { signal, onStage });
            const retain = async () => {
              signal?.throwIfAborted();
              onStage?.('history');
              const reference = ctx.sessions.retain(sessionId, { source: 'duduIssuePreview' });
              try {
                await withAbort(reference.ready, signal);
                historyCache?.remember(issue, { sessionId });
                return reference;
              }
              catch (error) { reference.release(); throw error; }
            };
            try { return await retain(); }
            catch {
              signal?.throwIfAborted();
              // A legacy imported copy can require repair before the host can restore it.
              sessionId = await prepareSession(target, { signal, synchronize: true, onStage });
              return retain();
            }
          },
          voiceCatalog: async () => {
            const result = await ctx.remote.speech?.catalog();
            return result?.error ? null : result?.value ?? null;
          },
          watchVoiceCatalog: (receive) => {
            if (!ctx.remote.$stream) return undefined;
            let closed = false;
            const stream = ctx.remote.$stream({
              name: 'dudu speech readiness',
              open: (signal) => ctx.remote.speech.follow(signal),
              ended: () => new Error('Speech readiness ended.'),
              carrierFailed: () => { if (!closed) receive(null); },
            });
            void (async () => {
              try {
                for await (const item of stream) {
                  if (!closed) receive(item.value);
                  item.accept();
                }
              } catch { if (!closed) receive(null); }
            })();
            return () => { closed = true; void stream.dispose(); };
          },
          transcribeVoice: async (audio, signal) => {
            const result = await ctx.remote.speech.transcribe(audio, signal);
            if (result.error) throw new Error(result.error.message);
            return result.value;
          },
          readConversation: async ({ sessionId, cursor }, beforeSeq) => {
            const result = await ctx.remote.session.page({
              address: { kind: 'session', sessionId }, throughSeq: cursor, maxMessages: 100,
              ...(beforeSeq === undefined ? {} : { beforeSeq }),
            });
            if (result.error) throw new Error(result.error.message);
            return result.value ?? result;
          },
          conversationModels: async (sessionId) => {
            await ctx.sessions.refresh();
            const reference = ctx.sessions.retain(sessionId, { source: 'duduConversation' });
            try {
              await reference.ready;
              return { directory: ctx.modelDirectories.directoryFor(sessionId), reference, release: () => reference.release() };
            } catch (error) {
              reference.release();
              throw error;
            }
          },
          selectConversationModel: (selection) => request('assistant/conversation-model', selection),
          conversationSkills: async (sessionId, signal) => {
            await ctx.sessions.refresh();
            const reference = ctx.sessions.retain(sessionId, { source: 'duduSkills' });
            try {
              await reference.ready;
              signal?.throwIfAborted();
              const result = await ctx.remote.skills.list({ sessionId }, signal);
              if (result.error) throw new Error(result.error.message);
              return (result.value ?? result).skills;
            } finally { reference.release(); }
          },
          conversationImage: async (sessionId, attachment) => {
            // DSH 0.2.2 asks for the attachment itself (as the phone's bridge sends it) and refuses its id alone ("wire field request failed boundary validation", found 2026-11-10: the history
            // pictures of the pet did not load); 0.2.0 took the id alone. The attachment is tried first, the id is the way for the older one.
            let result = await ctx.remote.session.attachment({ sessionId, attachment });
            if (result.error) result = await ctx.remote.session.attachment({ sessionId, attachmentId: attachment.attachmentId });
            if (result.error) throw new Error(result.error.message);
            const value = result.value ?? result;
            return `data:${value.attachment.mediaType};base64,${value.data}`;
          },
          // `attachments` are what waits in the box, in the order picked: a picture ({ kind: 'image', mediaType, data, name }) travels in the prompt;
          // a file ({ kind: 'file', file, name }) is uploaded to the session first, as DSH's own box does, and the prompt carries its receipt.
          // As there, the attachments come before the words.
          sendConversation: async (sessionId, text, attachments = []) => {
            const content = await prepareAttachments(sessionId, attachments);
            if (text) content.push({ type: 'text', text });
            const result = await ctx.remote.session.prompt({
              requestId: `dudu-${crypto.randomUUID()}`, sessionId, mode: 'queue',
              content,
              clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            if (result.error) throw new Error(result.error.message);
            return result.value ?? result;
          },
          forwardIssue: async (message, attachments) => {
            // Resume resolves a native-only issue to its existing DSH copy before staging session-scoped files.
            // Check the picked recipient again; issues/forward also checks the final session after the upload.
            const target = await request('issues/resume', { id: message.id });
            if (!['success', 'no_op'].includes(target.outcome) || !target.sessionId
              || message.session !== undefined && message.session !== target.issue?.session) {
              return { outcome: 'needs_clarification', code: 'recipient_unavailable' };
            }
            return request('issues/forward', {
              ...message, session: `dsh:${target.sessionId}`,
              attachments: await prepareAttachments(target.sessionId, attachments),
            });
          },
          stopConversation: async (sessionId) => {
            const result = await ctx.remote.session.cancel({ sessionId });
            if (result.error) throw new Error(result.error.message);
          },
          // A session the plugin has just written into DSH is stored, not yet known to this window: it is made known (DSH lists it in its sidebar)
          // without being opened.
          addSession: async ({ sessionId }) => {
            await ctx.sessions.refresh();
            await untilListed(ctx.sessions, sessionId);
          },
          // The page of the plugin in DSH's main area (a reminder beside the pet opens an issue there).
          openPanel: () => { ctx.layout.selectPanel(PANEL_ID); },
          openSession: async (target, options) => {
            if (target?.sessionId) {
              const resumed = await request('issues/resume', { session: `dsh:${target.sessionId}` });
              if (!['success', 'no_op'].includes(resumed?.outcome) || typeof resumed.sessionId !== 'string' || !resumed.sessionId) {
                throw new Error(resumed?.message || ui?.T.widgets.sessions.openFailed || S?.unavailable);
              }
              target = { ...target, sessionId: resumed.sessionId, workspaceId: resumed.workspaceId ?? target.workspaceId };
            }
            await openSession(target, options);
          },
        };
        const petInShell = Boolean(ui?.AssistantOverlay && ctx.slots.spec?.('shell.overlay'));
        const permissionSlot = 'dudu.pet.permission';
        const permissionChild = { [permissionSlot]: { kind: 'single', scope: 'session' } };
        const renderPermission = (props) => (reference, owner) => h(props.SessionProvider, { session: reference }, props.renderSlot(permissionSlot, owner));
        // Re-host DSH's existing permission seat with its own projection, locale, menu and confirmation.
        ctx.slots.inject(permissionSlot, () => {
          let original;
          let dispose = () => {};
          const sync = () => {
            const entry = ctx.slots.entries('conversation.input.permission')[0];
            if (entry === original) return;
            dispose();
            original = entry;
            dispose = entry ? ctx.slots.register({
              name: permissionSlot,
              ...(entry.inject ? { inject: entry.inject } : {}),
              ...(entry.locale ? { locale: entry.locale } : {}),
            }, entry.component) : () => {};
          };
          const stop = ctx.slots.subscribe('conversation.input.permission', sync);
          sync();
          return () => { stop(); dispose(); };
        });
        if (petInShell) {
          ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay', id: 'dudu-assistant', order: 50,
            children: permissionChild,
          }, (props) => h(ui.AssistantOverlay, { request, actions, renderPermission: renderPermission(props) })));
        }
        const widgetSource = ui?.createWidgetSource?.(ctx.slots);
        if (widgetSource) ctx.effect(() => () => widgetSource.close());
        if (ui?.installIssueHeader) ui.installIssueHeader(ctx, h);
        const sessionHeaderSlot = ui?.ISSUE_HEADER_SLOT ?? 'dudu.issue.header.actions';
        const IssuesPage = (props = {}) => h(ui.SlotPage ?? ui.Page, {
          request, logo: LOGO, actions, petInShell, widgetSource, renderSlot: props.renderSlot,
          ...(!petInShell ? { renderPermission: renderPermission(props) } : {}),
          renderConversation: (reference) => h(props.SessionProvider, { session: reference }, props.renderSlot('dudu.issue.conversation', {})),
          renderSessionHeader: (reference, owner) => h(props.SessionProvider, { session: reference },
            h('div', { className: 'dudu-host-conversation dudu-session-header-actions' }, props.renderSlot(sessionHeaderSlot, owner))),
        });
        ctx.slots.inject('main', () => {
          const dispose = ctx.slots.register({
            name: 'main', key: PANEL_ID,
            children: {
              ...(widgetSource ? { 'dudu.widget': { kind: 'list', scope: 'root' } } : {}),
              'dudu.issue.conversation': { kind: 'single', scope: 'session' },
              [sessionHeaderSlot]: { kind: 'list', scope: 'session' },
              ...(!petInShell ? permissionChild : {}),
            },
          }, ui ? IssuesPage : Page);
          const conversation = ctx.slots.register({ name: 'dudu.issue.conversation' }, function EmbeddedConversation(props) {
            const bridge = useSyncExternalStore(subscribeSurface, surfaceSnapshot);
            const surface = useRef(null);
            useEffect(() => {
              const mounted = bridge?.mount(props.sessionId);
              surface.current = mounted;
              return () => { mounted?.release(); if (surface.current === mounted) surface.current = null; };
            }, [bridge, props.sessionId]);
            return h('div', {
              className: 'dudu-embedded-session-surface',
              onPointerDownCapture: () => surface.current?.activate(),
              onFocusCapture: () => surface.current?.activate(),
              style: { display: 'contents' },
            }, props.renderFactorySlot('conversation.content', {
              variant: 'embedded', phase: 'active', hero: false,
            }));
          });
          const widgets = (ui?.REGISTRY ?? []).map((widget) => ctx.slots.register({
            name: 'dudu.widget', id: widget.id, label: widget.label,
          }, widget.Component));
          // The widgets 嘟嘟 writes: files in its project folder, loaded here and registered into the same slot (ui/widgets/local.js). No plugin is installed.
          const localWidgets = ui?.createLocalWidgets?.({
            slots: ctx.slots,
            list: () => request('assistant/widgets'),
            report: (entries) => request('assistant/widgets-report', { widgets: entries }),
            fileUrl: (name, stamp) => new URL(`api/dudu/assistant/widget-file?name=${encodeURIComponent(name)}&v=${encodeURIComponent(stamp)}`, document.baseURI).href,
          });
          localWidgets?.start();
          ctx.layout.selectPanel(PANEL_ID);
          return () => { for (const stop of widgets) stop(); localWidgets?.close(); conversation(); dispose(); };
        });
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => ui?.T.brand ?? '嘟嘟',
        }, (props) => h(DuduGlyph, { ...props, home: true })));
        function HomeEntry({ inShell = false }) {
          useLanguage();
          const control = useRef(null);
          useEffect(() => followWindowDrag(document, control.current), []);
          const label = ui?.T.brand ?? '嘟嘟';
          return h(Tooltip, { label, delayMs: 500 },
            h(Button, {
              ref: control, size: 'sm', variant: 'ghost', className: 'dudu-home-entry',
              'aria-label': label, 'data-dudu-home-entry': '', ...(inShell ? { 'data-dudu-shell-home-entry': '' } : {}),
              onClick: () => { ui?.openDashboard(); ctx.layout.selectPanel(PANEL_ID); },
            }, h(DuduGlyph, { size: 16 })));
        }
        ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({ name: 'conversation.header.leading' }, HomeEntry));
        if (!window.__DUDU_PAGE__ && document.documentElement?.dataset?.platform === 'darwin') {
          // shell.leading is a single slot. Shadow it the same way the hero mode chip is wrapped above, cloning the host occupant into a private child slot.
          // Never reimplement sidebar actions: the original component keeps its shortcuts, remote-access behavior and locale.
          const leadingSlot = 'shell.leading';
          const nativeSlot = 'dudu.shell.leading.native';
          const registrant = 'dudu:home-leading';
          ctx.slots.inject(leadingSlot, () => {
            function Leading(props) {
              return h('div', { className: 'dudu-shell-leading', 'data-dudu-shell-leading': '' },
                props.renderSlot(nativeSlot, {}), h(HomeEntry, { inShell: true }));
            }
            const disposeLeading = ctx.slots.register({
              name: leadingSlot, registrant, priority: -1,
              children: { [nativeSlot]: { kind: 'single', scope: 'root' } },
            }, Leading);
            let original;
            let disposeNative = () => {};
            const sync = () => {
              const entry = ctx.slots.entries(leadingSlot).find((candidate) => candidate.registrant !== registrant);
              if (entry === original) return;
              disposeNative();
              original = entry;
              disposeNative = entry ? ctx.slots.register({
                name: nativeSlot,
                ...(entry.inject ? { inject: entry.inject } : {}),
                ...(entry.locale ? { locale: entry.locale } : {}),
                registrant: `${registrant}:native`,
              }, entry.component) : () => {};
            };
            const unsubscribe = ctx.slots.subscribe(leadingSlot, sync);
            sync();
            return () => { unsubscribe(); disposeNative(); disposeLeading(); };
          });
        }
      },
    };

    return {
      name: 'dudu',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ui?.connectLocale(ctx.locale));
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = styles;
          document.head.appendChild(style);
          return () => style.remove();
        });
        // 嘟嘟 is set up in its own settings window (the gear of its page); DSH's Settings has nothing of it.
        // Phone pages run this same module inside their own frontend; only DSH's own window reports.
        if (!window.__DUDU_PAGE__) {
          ctx.effect(() => ui?.installChatAutoHistory(document));
          ctx.effect(() => {
            try { return startNavigationPublisher(ctx); } catch { return undefined; }
          });
          ctx.plugin(providerUi);
          ctx.plugin(sessionsUi);
        }
      },
    };
  },
});
