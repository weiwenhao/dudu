export const MOBILE_PAGE_CSS = `
html[data-dudu-page-kind],
html[data-dudu-page-kind] body {
  width: 100%;
  height: 100%;
  min-width: 0 !important;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
html[data-dudu-page-kind] #root {
  width: 100%;
  min-width: 0 !important;
  height: 100%;
}
html[data-dudu-page-kind] button,
html[data-dudu-page-kind] a,
html[data-dudu-page-kind] [role="button"],
html[data-dudu-page-kind] input,
html[data-dudu-page-kind] textarea,
html[data-dudu-page-kind] [contenteditable="true"] {
  touch-action: manipulation;
}
html[data-dudu-page-kind] [data-dudu-frame] > [class*="_leadingSeat"],
html[data-dudu-page-kind] [data-dudu-frame] > [class*="_handle"],
html[data-dudu-page-kind] [data-dudu-frame] > [class*="_drawerMask"] {
  display: none !important;
}
html[data-dudu-page-kind="plugins"] [data-dudu-sidebar],
html[data-dudu-page-kind="plugins"] [data-dudu-rightbar],
html[data-dudu-page-kind="plugins"] [data-slot="conversation.composer"],
html[data-dudu-page-kind="plugins"] [data-slot="conversation.composer.bar"],
html[data-dudu-page-kind="panel"] [data-dudu-sidebar],
html[data-dudu-page-kind="panel"] [data-dudu-rightbar],
html[data-dudu-page-kind="panel"] [data-slot="conversation.composer"],
html[data-dudu-page-kind="panel"] [data-slot="conversation.composer.bar"] {
  display: none !important;
}
/* Fit DSH's shell to the native viewport; the selected page owns its layout and scrolling. */
html[data-dudu-page-kind="plugins"] [data-dudu-frame],
html[data-dudu-page-kind="panel"] [data-dudu-frame] {
  grid-template-columns: minmax(0, 1fr) !important;
  min-width: 0 !important;
  padding: 0 !important;
}
html[data-dudu-page-kind="plugins"] [data-dudu-center],
html[data-dudu-page-kind="panel"] [data-dudu-center] {
  grid-column: 1 !important;
  grid-row: 1 !important;
  min-height: 0;
  border: 0 !important;
  border-radius: 0 !important;
}
html[data-dudu-page-kind="plugins"] [data-global-panel],
html[data-dudu-page-kind="panel"] [data-global-panel] {
  padding-top: 0 !important;
}
html[data-dudu-page-kind="settings"] #root,
html[data-dudu-page-kind="settings"] #root * {
  visibility: hidden !important;
}
html[data-dudu-page-kind="settings"] [data-shortcut-modal="settings"] {
  position: fixed !important;
  inset: 0 !important;
  z-index: 100 !important;
  display: flex !important;
  width: 100vw !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100% !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  border: 0 !important;
  border-radius: 0 !important;
  transform: none !important;
}
html[data-dudu-page-kind="settings"] [data-shortcut-modal="settings"] > nav,
html[data-dudu-page-kind="settings"] [data-dudu-settings-nav] {
  display: none !important;
}
html[data-dudu-page-kind="settings"] [data-shortcut-modal="settings"] > [class*="_content"],
html[data-dudu-page-kind="settings"] [data-dudu-settings-body] {
  flex: 1 1 auto !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100% !important;
  overflow: auto !important;
  overscroll-behavior: contain;
}
html[data-dudu-page-session] [data-dudu-sidebar],
html[data-dudu-page-session] [data-dudu-rightbar] {
  display: none !important;
}
html[data-dudu-page-session] [data-dudu-frame] {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  width: 100% !important;
  min-width: 0 !important;
  height: 100% !important;
  padding: 0 !important;
}
html[data-dudu-page-session] [data-dudu-center] {
  display: flex !important;
  flex-direction: column !important;
  grid-column: 1 !important;
  grid-row: 1 !important;
  width: 100% !important;
  min-width: 0 !important;
  height: 100% !important;
  border: 0 !important;
  border-radius: 0 !important;
}
html[data-dudu-page-session] [data-slot="main"],
html[data-dudu-page-session] [data-slot="main.conversation"],
html[data-dudu-page-session] [data-conversation-content] {
  width: 100% !important;
  min-width: 0 !important;
  height: 100% !important;
  margin: 0 !important;
}
html[data-dudu-page-session] [data-slot="conversation.header"],
html[data-dudu-page-session] [data-slot="conversation.composer"],
html[data-dudu-page-session] [data-slot="conversation.composer.bar"],
html[data-dudu-page-session] [data-composer-seat],
html[data-dudu-page-session] [data-sidebar-right-expand],
html[data-dudu-page-session] [data-sidebar-right-collapse] {
  display: none !important;
}
html[data-dudu-page-session] [data-conversation-scroll] {
  min-width: 0 !important;
  margin: 0 !important;
  padding-inline: 0 !important;
  overscroll-behavior-y: contain;
}
html[data-dudu-page-kind="context"] [data-conversation-scroll] {
  overflow: hidden !important;
}
html[data-dudu-page-kind="context"] [class*="_viewArea"] {
  flex: 1 1 0 !important;
  min-height: 0 !important;
  height: 100%;
  overflow-y: auto;
}
html[data-dudu-page-kind="trace"] aside[aria-label="事件详情"],
html[data-dudu-page-kind="trace"] aside[aria-label="Event details"] {
  position: absolute !important;
  inset: 0 !important;
  z-index: 200 !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100% !important;
  border: 0 !important;
  background: var(--dsw-alias-bg-layer-1, #fff) !important;
}
html[data-dudu-page-kind="trace"] [data-conversation-composer-overlay] > [class*="_ledger"] {
  --dsh-trajectory-bottom-clearance: 0px;
}
html[data-dudu-page-kind="trace"] [data-conversation-composer-overlay]:has(aside[aria-label]) > :not([class*="_ledger"]) {
  display: none !important;
}
html[data-dudu-page-kind="trace"] aside[aria-label] [role="separator"] {
  display: none !important;
}
html[data-dudu-page-kind="trace"] aside[aria-label] [role="tablist"] {
  overflow-x: auto;
  flex-shrink: 0;
}
html[data-dudu-page-kind="trace"] aside[aria-label] > [class*="_detailsHeader"] {
  min-height: 48px;
  height: auto;
}
html[data-dudu-page-kind="trace"] aside[aria-label] button[aria-label="关闭详情"],
html[data-dudu-page-kind="trace"] aside[aria-label] button[aria-label="Close details"],
html[data-dudu-page-kind="trace"] aside[aria-label] [role="tab"] {
  min-width: 44px;
  min-height: 44px;
}
html[data-dudu-page-kind="settings"] [data-shortcut-modal="settings"] > [class*="_navTitle"],
html[data-dudu-page-kind="settings"] [data-shortcut-modal="settings"] > [class*="_header"],
html[data-dudu-page-kind="settings"] [data-shortcut-modal="settings"] > [class*="_content"] > [class*="_header"],
html[data-dudu-page-kind="settings"] [data-dudu-settings-body] > [class*="_header"] {
  display: none !important;
}
html[data-dudu-page-kind="settings"] [data-dudu-duplicate-heading] {
  display: none !important;
}
html[data-dudu-page-kind="settings"] [data-shortcut-modal="settings"] > [class*="_content"] > [class*="_options"],
html[data-dudu-page-kind="settings"] [data-dudu-settings-body][class*="_options"],
html[data-dudu-page-kind="settings"] [data-dudu-settings-body] > [class*="_options"] {
  width: 100% !important;
  min-width: 0 !important;
  padding: 16px !important;
}
html[data-dudu-page-kind] input,
html[data-dudu-page-kind] textarea,
html[data-dudu-page-kind] select {
  font-size: 16px !important;
}
@media (prefers-reduced-motion: reduce) {
  html[data-dudu-page-kind] *,
  html[data-dudu-page-kind] *::before,
  html[data-dudu-page-kind] *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`;

export const MOBILE_PAGE_SCRIPT = String.raw`(()=>{
  const page = window.__DUDU_PAGE__;
  const supported = new Set(["trace", "context", "team", "tools", "view", "panel", "plugins", "settings"]);
  if (!page || !supported.has(page.kind)) return;
  // The id of a panel, view or settings section the phone asked for.
  let target = typeof page.target === "string" && page.target ? page.target : null;

  const html = document.documentElement;
  html.dataset.duduPageKind = page.kind;
  if (["trace", "context", "team", "tools", "view"].includes(page.kind)) {
    html.dataset.duduPageSession = "";
  }

  const tabLabels = {
    trace: ["轨迹", "对话轨迹", "Trajectory", "Trace"],
    context: ["上下文", "Context"],
    team: ["编队", "团队", "Team"],
    plugins: ["插件", "Plugins"]
  };
  let routeStarted = false;
  let routeFinished = false;
  let isVisible = true;
  let requestedSession = false;
  let selectedOverflowView = false;
  let settingsSignature = "";
  let selectedSection = typeof page.section === "string" ? page.section
    : page.kind === "settings" ? target : null;
  let lastMutationAt = performance.now();
  let closed = false;
  let observer;
  let scheduled = false;
  let timer;
  let routeError = "";
  let deadline = performance.now() + 60000;
  let routeDeadline;
  const originalConsoleError = console.error;

  function reviewDiagnostic(message) {
    if (!page.reviewDiagnostics) return;
    void window.webkit?.messageHandlers?.dudu?.postMessage(JSON.stringify({
      method: "review.diagnostic",
      params: {stage: "transport.error", message}
    })).catch(() => {});
  }

  if (page.reviewDiagnostics) {
    console.error = function(...args) {
      const details = args.map(value => value instanceof Error ? value.message
        : typeof value === "string" ? value : "").filter(Boolean).join(" ").slice(0, 2048);
      if (details) reviewDiagnostic("Frontend console: " + details);
      return originalConsoleError.apply(this, args);
    };
  }

  function appUI() {
    return window.__DUDU_APP_UI__ || null;
  }

  function contextOf(ui) {
    return ui?.ctx || ui?.context || ui || null;
  }

  function service(ui, name) {
    const contexts = [...Object.values(ui?.contexts || {}), contextOf(ui)];
    for (const ctx of contexts) {
      try {
        const value = ctx?.get?.(name) || ctx?.[name];
        if (value) return value;
      } catch {}
    }
    return null;
  }

  function markShell() {
    const sidebar = document.querySelector('[class*="_sidebarCol"]');
    const center = document.querySelector('[class*="_centerCol"]');
    const rightbar = document.querySelector("[data-rightbar-col]");
    const frame = sidebar?.parentElement || center?.parentElement || rightbar?.parentElement;
    sidebar?.setAttribute("data-dudu-sidebar", "");
    center?.setAttribute("data-dudu-center", "");
    rightbar?.setAttribute("data-dudu-rightbar", "");
    frame?.setAttribute("data-dudu-frame", "");
    if (page.kind === "settings") {
      const dialog = document.querySelector('[data-shortcut-modal="settings"]');
      const nav = dialog?.querySelector("nav");
      const options = dialog?.querySelector(':scope > [class*="_options"]');
      const body = options || dialog?.querySelector('[class*="_content"]');
      nav?.setAttribute("data-dudu-settings-nav", "");
      body?.setAttribute("data-dudu-settings-body", "");
      const ui = appUI();
      const section = settingsEntries(contextOf(ui)).find(item => item.id === selectedSection);
      const heading = (options || body?.querySelector('[class*="_options"]'))?.querySelector("h1,h2");
      if (heading) {
        const label = section ? resolveLabel(ui, contextOf(ui), section.entry) : "";
        heading.toggleAttribute("data-dudu-duplicate-heading",
          Boolean(label) && cleanText(heading.textContent) === label);
      }
    }
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/gu, " ").trim();
  }

  function pluginsReady() {
    const panel = document.querySelector("[data-plugin-panel]");
    if (!panel) return false;
    // Existing plugin cards remain usable while another section is loading.
    if (
      panel.querySelector(
        "[data-plugin-package], [data-plugin-item], [data-plugin-row], " +
        "[data-plugin-item-detail], [data-plugin-row-detail]"
      ) ||
      panel.querySelector("[data-plugin-group] li, [data-plugin-group] button")
    ) return true;
    if (panel.getAttribute("aria-busy") === "true" || panel.querySelector("[data-plugin-loading]")) return false;
    return Boolean(
      panel.querySelector("[data-plugin-rows]") ||
      panel.querySelector('[class*="_empty"]') ||
      panel.querySelector('[role="alert"]') ||
      panel.querySelector('[role="status"]')
    );
  }

  function labelOf(element) {
    return cleanText(element.getAttribute("aria-label") || element.innerText || element.textContent);
  }

  function slotEntries(ctx, name) {
    try {
      const entries = ctx?.slots?.entries?.(name);
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
  }

  function resolveLabel(ui, ctx, entry) {
    const value = entry?.options?.label ?? entry?.options?.title;
    if (typeof value === "function") {
      try {
        const label = value();
        if (typeof label === "string") return cleanText(label);
      } catch {}
    }
    const resolver = ui?.resolveSlotLabel || ctx?.resolveSlotLabel;
    if (typeof resolver === "function") {
      try {
        const resolved = resolver(value, entry);
        if (typeof resolved === "string" && cleanText(resolved)) return cleanText(resolved);
      } catch {}
    }
    if (typeof value === "string" && cleanText(value)) return cleanText(value);
    if (value && typeof value === "object") {
      for (const key of ["defaultValue", "default", "zh-CN", "zh", "text"]) {
        if (typeof value[key] === "string" && cleanText(value[key])) return cleanText(value[key]);
      }
    }
    return cleanText(entry?.options?.id || entry?.id);
  }

  function settingsEntries(ctx) {
    return slotEntries(ctx, "settings.section")
      .filter(entry => entry?.options?.id && !["dudu-mobile-control", "dudu-providers", "dudu-mobile-control", "general"].includes(entry.options.id))
      .map((entry, index) => ({ entry, index, id: entry.options.id }))
      .sort((a, b) => {
        const ao = Number(a.entry?.options?.order);
        const bo = Number(b.entry?.options?.order);
        return Number.isFinite(ao) && Number.isFinite(bo) ? ao - bo : a.index - b.index;
      });
  }

  function publishSettingsCategories(ui, ctx) {
    if (page.kind !== "settings") return;
    const categories = settingsEntries(ctx).map(({ entry, id }) => ({
      id: String(id),
      label: resolveLabel(ui, ctx, entry)
    })).filter(category => category.id && category.label);
    // A registry may become empty after a plugin unloads. Do not leave the old list on the phone.
    if (!categories.length && !settingsSignature && !slotEntries(ctx, "settings.section").length) return;
    const signature = JSON.stringify(categories);
    if (signature === settingsSignature) return;
    settingsSignature = signature;
    try {
      const result = window.__DUDU_NATIVE__?.settingsCategories?.(categories);
      result?.catch?.(() => {});
    } catch {}
  }

  function settingsModal() {
    return document.querySelector('[data-shortcut-modal="settings"]');
  }

  function settingsReady(ui, ctx) {
    const dialog = settingsModal();
    if (!settingsSignature || !dialog?.querySelector("[data-dudu-settings-body]")) return false;
    if (!selectedSection) return true;
    const section = settingsEntries(ctx).find(item => item.id === selectedSection);
    if (!section) return false;
    const label = resolveLabel(ui, ctx, section.entry);
    return [...dialog.querySelectorAll("nav button")].some(button =>
      labelOf(button) === label && button.getAttribute("aria-current") === "true"
    );
  }

  function settingsShell(ui) {
    const slots = service(ui, "slots");
    const entry = slots?.entries?.("sidebar.settings")?.[0];
    try { return entry?.store?.create?.(); } catch { return null; }
  }

  function openSettingsFromUI(ui) {
    if (settingsModal()) return true;
    const shell = settingsShell(ui);
    if (typeof shell?.actions?.open === "function") {
      shell.actions.open();
      return true;
    }
    if (typeof ui?.openSettings === "function") {
      try {
        ui.openSettings();
        return true;
      } catch {}
    }
    const launcher = document.querySelector(
      '[data-slot="settings.launcher"] button, button[aria-label="设置"], button[aria-label="Settings"]'
    );
    if (!launcher) return false;
    if (launcher.getAttribute("aria-expanded") !== "true") launcher.click();
    const menuItem = [...document.querySelectorAll('[role="menuitem"],button')]
      .find(element => /^(设置|settings)$/iu.test(labelOf(element)));
    if (menuItem && menuItem !== launcher) menuItem.click();
    return true;
  }

  function selectSettingsSection(ui, ctx, id) {
    if (page.kind !== "settings" || typeof id !== "string") return false;
    const entry = settingsEntries(ctx).find(item => item.id === id);
    if (!entry || ["dudu-mobile-control", "dudu-providers", "dudu-mobile-control", "general"].includes(id)) return false;
    const dialog = settingsModal();
    const label = resolveLabel(ui, ctx, entry.entry);
    const matches = [...(dialog?.querySelectorAll("nav button") || [])]
      .filter(button => labelOf(button) === label);
    const target = matches.length === 1 ? matches[0] : null;
    if (target?.getAttribute("aria-current") === "true") return true;
    const shell = settingsShell(ui);
    if (typeof shell?.actions?.openSection === "function") {
      shell.actions.openSection(id);
      return true;
    }
    if (target) {
      if (target.getAttribute("aria-current") !== "true") target.click();
      return true;
    }
    if (typeof ui?.selectSettingsSection === "function") {
      try {
        ui.selectSettingsSection(id);
        return true;
      } catch {}
    }
    if (!dialog) {
      openSettingsFromUI(ui);
      return false;
    }
    return false;
  }

  function conversationTabs() {
    return [...document.querySelectorAll(
      '[data-slot="conversation.header"] [data-conversation-tabs] [role="tab"],' +
      '[data-slot="conversation.header"] [role="tablist"] [role="tab"]'
    )];
  }

  // The tab for a view is found by the label DSH resolves for it in this page, so the lookup does not
  // depend on the desktop's language or on the order of the tabs.
  function viewLabels(ui, ctx) {
    const entries = slotEntries(ctx, "conversation.view");
    const legacyIDs = {
      trace: /^(?:trajectory)$/iu,
      context: /^(?:context|dsh-?context|dshContext)$/iu,
      team: /^(?:team|fleet|agent-?team|dsh-?team|dsh-?fleet)$/iu,
      tools: /^(?:tools)$/iu
    };
    const entry = entries.find(item => target ? item?.options?.id === target
      : legacyIDs[page.kind]?.test(item?.options?.id || ""));
    // Older catalogs have no target. Prefer the registry's localized label even for those.
    return entry ? [resolveLabel(ui, ctx, entry)] : target ? [] : (tabLabels[page.kind] || []);
  }

  function conversationTab(ui, ctx) {
    const tabs = conversationTabs();
    const labels = viewLabels(ui, ctx);
    return tabs.find(tab => labels.includes(labelOf(tab)));
  }

  // A hidden desktop header has no width budget: newer DSH folds its non-Chat
  // views into More. Use those same controls rather than making another store.
  function selectOverflowView(ui, ctx) {
    const labels = viewLabels(ui, ctx);
    const strip = document.querySelector('[data-slot="conversation.header"] [data-conversation-tabs]');
    const more = strip?.parentElement?.querySelector('button[aria-haspopup="menu"]');
    if (!more || more.disabled || !labels.length) return false;
    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find(element => labels.includes(labelOf(element)));
    if (item) {
      if (item.getAttribute("aria-current") === "page") {
        if (more.getAttribute("aria-expanded") === "true") more.click();
        return true;
      }
      item.click();
      lastMutationAt = performance.now();
      return true;
    } else if (more.getAttribute("aria-expanded") !== "true") more.click();
    return false;
  }

  // Panels come from plugins this adapter knows nothing about, so "ready" means the page
  // has been still for a moment after DSH showed it.
  function settled(milliseconds) {
    return performance.now() - lastMutationAt >= milliseconds;
  }

  async function applyRoute(ui) {
    if (routeStarted || routeFinished || closed) return;
    routeStarted = true;
    const ctx = contextOf(ui);
    try {
      if (["trace", "context", "team", "tools", "view"].includes(page.kind) && page.sessionId) {
        const workspace = service(ui, "uiWorkspace");
        if (!requestedSession && typeof workspace?.openSession === "function") {
          await workspace.openSession(page.sessionId);
          requestedSession = true;
        }
        if (!requestedSession) {
          const rowKey = "session:" + page.sessionId;
          const row = [...document.querySelectorAll("[data-row-key]")]
            .find(element => element.getAttribute("data-row-key") === rowKey);
          if (row) { row.click(); requestedSession = true; }
        }
        const tab = requestedSession ? conversationTab(ui, ctx) : null;
        if (tab && !tab.disabled) {
          if (tab.getAttribute("aria-selected") !== "true") tab.click();
          else if (document.querySelector("[data-conversation-content]")
            && (page.kind !== "view" || settled(500))) await finishRoute();
        } else if (requestedSession) {
          if (!selectedOverflowView) selectedOverflowView = selectOverflowView(ui, ctx);
          if (selectedOverflowView && document.querySelector("[data-conversation-content]")
            && settled(500)) await finishRoute();
        }
      } else if (page.kind === "panel" && target) {
        const layout = service(ui, "layout");
        if (layout?.panelInfo?.getSnapshot?.().activePanelId !== target) {
          layout?.selectPanel?.(target);
        } else if (settled(500)) {
          await finishRoute();
        }
      } else if (page.kind === "plugins") {
        const layout = service(ui, "layout");
        if (layout?.panelInfo?.getSnapshot?.().activePanelId !== "plugins") {
          layout?.selectPanel?.("plugins");
        } else if (pluginsReady()) {
          await finishRoute();
        }
      } else if (page.kind === "settings") {
        publishSettingsCategories(ui, ctx);
        openSettingsFromUI(ui);
        if (selectedSection) selectSettingsSection(ui, ctx, selectedSection);
        markShell();
        if (settingsReady(ui, ctx)) {
          await finishRoute();
        }
      }
    } catch (error) {
      routeError = String(error?.message || error).slice(0, 512);
    }
    markShell();
    if (page.kind === "settings") {
      publishSettingsCategories(ui, ctx);
      if (selectedSection) selectSettingsSection(ui, ctx, selectedSection);
    }
    routeStarted = false;
  }

  function onAppUIReady() {
    const ui = appUI();
    if (!ui) return;
    publishSettingsCategories(ui, contextOf(ui));
    schedule();
  }

  function onSettingsSelect(event) {
    if (page.kind !== "settings") return;
    selectedSection = typeof event.detail === "string" ? event.detail : null;
    const ui = appUI();
    if (!ui) return;
    publishSettingsCategories(ui, contextOf(ui));
    if (selectedSection) selectSettingsSection(ui, contextOf(ui), selectedSection);
    schedule();
  }

  function onVisibility(event) {
    if (typeof event.detail !== "boolean") return;
    isVisible = event.detail;
    if (isVisible) schedule();
  }

  // Older apps still dispatch their native "+" here; current apps use DSH's visible toolbar.
  function addPlugin() {
    const group = [...document.querySelectorAll('[data-plugin-panel] [role="group"]')]
      .find(element => /添加插件|add plugin/iu.test(element.getAttribute("aria-label") || ""));
    // While an install is running DSH swaps the add button for one that reopens its progress.
    const toolbar = document.querySelector('[data-plugin-panel] [data-plugin-toolbar]')
      || document.querySelector('[data-plugin-panel] > header [class*="_toolbar"]');
    const buttons = toolbar ? [...toolbar.querySelectorAll("button")] : [];
    const target = group?.querySelector("button") || buttons[buttons.length - 1];
    if (target && !target.disabled) target.click();
  }

  function onCommand(event) {
    if (page.kind === "plugins" && event.detail === "add") addPlugin();
  }

  window.addEventListener("dudu:app-ui-ready", onAppUIReady);
  window.addEventListener("dudu:settings-select", onSettingsSelect);
  window.addEventListener("dudu:command", onCommand);
  window.addEventListener("dudu:visibility", onVisibility);
  async function finishRoute() {
    if (routeFinished || closed) return;
    markShell();
    await window.__DUDU_NATIVE__?.ready?.();
    routeFinished = true;
    clearTimeout(timer);
    observer?.disconnect();
    if (page.kind === "settings") {
      observer?.observe(document.body, {childList: true, subtree: true});
    }
  }

  function schedule() {
    if (closed || scheduled) return;
    scheduled = true;
    // Start routing before WebKit schedules visible animation frames.
    queueMicrotask(() => {
      scheduled = false;
      markShell();
      const ui = appUI();
      if (ui) {
        publishSettingsCategories(ui, contextOf(ui));
        if (page.kind === "settings" && isVisible && routeFinished && !settingsReady(ui, contextOf(ui))) {
          routeFinished = false;
          deadline = performance.now() + 28000;
          routeDeadline = deadline;
          clearTimeout(timer);
          timer = setTimeout(tick, 200);
        }
        if (!routeFinished) {
          if (routeDeadline === undefined) routeDeadline = Math.min(deadline, performance.now() + 28000);
          void applyRoute(ui);
        }
      }
    });
  }

  function tick() {
    if (closed || routeFinished) return;
    if (performance.now() > (routeDeadline ?? deadline)) {
      if (page.reviewDiagnostics) {
        const ui = appUI();
        const state = {
          ui: Boolean(ui),
          contexts: Object.keys(ui?.contexts || {}),
          layout: Boolean(service(ui, "layout")),
          workspace: Boolean(service(ui, "uiWorkspace")),
          slots: Boolean(service(ui, "slots")),
          frame: Boolean(document.querySelector("[data-dudu-frame]")),
          tabs: document.querySelectorAll('[data-conversation-tabs] [role="tab"]').length,
          settingsDialog: Boolean(settingsModal()),
          settingsBody: Boolean(settingsModal()?.querySelector("[data-dudu-settings-body]")),
          settingsShell: Boolean(settingsShell(ui)?.actions?.open),
          settingsCategories: Boolean(settingsSignature),
          requestedSession,
          routeError
        };
        reviewDiagnostic("Route deadline: " + JSON.stringify(state));
      }
      closed = true;
      observer?.disconnect();
      if (page.reviewDiagnostics) console.error = originalConsoleError;
      void window.__DUDU_NATIVE__?.fail?.("page");
      return;
    }
    schedule();
    timer = setTimeout(tick, 200);
  }

  window.__DUDU_MOBILE_PAGE_ADAPTER__ = Object.freeze({
    kind: page.kind,
    sessionId: page.sessionId || null,
    close() {
      closed = true;
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("dudu:app-ui-ready", onAppUIReady);
      window.removeEventListener("dudu:settings-select", onSettingsSelect);
      window.removeEventListener("dudu:command", onCommand);
      window.removeEventListener("dudu:visibility", onVisibility);
    }
  });
  markShell();
  function observe() {
    observer = new MutationObserver(() => {
      lastMutationAt = performance.now();
      schedule();
    });
    observer.observe(document.body, {childList: true, subtree: true});
    schedule();
  }
  if (document.body) observe();
  else document.addEventListener("DOMContentLoaded", observe, {once: true});
  tick();
})();`;
