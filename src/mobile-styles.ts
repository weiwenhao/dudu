import { SPEECH_COLOR_STOPS } from './speech-appearance.ts';

const speechGradient = (phase: 'recording' | 'cancel') =>
  SPEECH_COLOR_STOPS.map((stop) => `${stop[phase]} ${stop.offset}%`).join(', ');

export const MOBILE_CSS = `
#hm-toolbar, #hm-scrim, #hm-drawer-close, #hm-drawer-search, #hm-welcome,
#hm-settings-heading, #hm-settings-back, #hm-view-menu, #hm-composer-photos,
#hm-keyboard-toggle, #hm-voice-input, #hm-speech-feedback, #hm-speech-overlay, #hm-computer-picker, [data-hm-add-icon],
[data-hm-lucide] { display: none; }
@media (max-width: 820px) {
  html[data-harness-mobile] {
    --dsh-frame-top-clearance: 0px !important;
    --dsh-frame-leading-clearance: 0px !important;
    --dsh-frame-overlay-top: 12px !important;
    --hm-toolbar-height: 0px;
    --hm-surface: #fff;
    --hm-sheet: #f7f7f8;
    --hm-ink: #17181b;
    --hm-muted: #96989d;
    --hm-line: #ededf0;
    --hm-blue: #4d6bfe;
    -webkit-text-size-adjust: 100%;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: none;
  }
  html[data-harness-mobile][data-hm-theme="dark"] {
    --hm-surface: #1c1d21;
    --hm-sheet: #141519;
    --hm-ink: #f4f4f6;
    --hm-muted: #92949d;
    --hm-line: #303137;
  }
  html[data-harness-mobile], html[data-harness-mobile] body {
    width: 100%; height: var(--hm-height, 100dvh); min-width: 0 !important;
    margin: 0; overflow: hidden; background: var(--hm-surface);
  }
  html[data-harness-mobile] body { position: relative; }
  html[data-harness-mobile] *, html[data-harness-mobile] *::before,
  html[data-harness-mobile] *::after { box-sizing: border-box; }
  html[data-harness-mobile] button, html[data-harness-mobile] a,
  html[data-harness-mobile] [role="button"],
  html[data-harness-mobile] input, html[data-harness-mobile] textarea,
  html[data-harness-mobile] [contenteditable="true"] { touch-action: manipulation; }
  html[data-harness-mobile] #root {
    width: 100%; min-width: 0;
    height: calc(var(--hm-height, 100dvh) - var(--hm-toolbar-height));
  }
  html[data-harness-mobile][data-hm-web-toolbar] { --hm-toolbar-height: 64px; }
  #hm-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    height: 64px; padding: 8px 14px; gap: 4px;
    color: var(--hm-ink); background: var(--hm-surface); position: relative;
  }
  #hm-toolbar strong {
    min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; text-align: center; font-size: 13px; font-weight: 500;
  }
  #hm-toolbar button, #hm-drawer-close, #hm-settings-back {
    width: 42px; height: 42px; border: 1px solid var(--hm-line); border-radius: 50%;
    background: var(--hm-surface); color: var(--hm-ink); cursor: pointer;
    display: inline-flex; justify-content: center; align-items: center;
    font: inherit; touch-action: manipulation; flex: none; corner-shape: round;
  }
  #hm-toolbar button { border: 0; border-radius: 0; background: transparent; }
  #hm-toolbar #hm-toolbar-views {
    flex: 1; min-width: 0; width: auto; gap: 5px; padding: 0 4px;
  }
  #hm-toolbar-views > svg { width: 14px; height: 14px; flex: none; color: var(--hm-muted); }
  #hm-toolbar-views:disabled > svg { display: none; }
  #hm-toolbar-views[aria-expanded="true"] > svg { transform: rotate(180deg); }
  #hm-view-menu {
    position: fixed; inset: var(--hm-toolbar-height) 0 0; z-index: 80;
  }
  #hm-view-menu[data-hm-open="true"] { display: block; }
  #hm-view-backdrop {
    position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
    padding: 0; background: transparent;
  }
  #hm-view-options {
    position: absolute; top: 0; right: 58px; width: 164px; padding: 5px;
    border: 1px solid var(--hm-line); border-radius: 16px;
    background: var(--hm-surface); box-shadow: 0 6px 24px #00000012;
  }
  #hm-view-options button {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; min-height: 44px; padding: 0 13px; border: 0; border-radius: 11px;
    background: transparent; color: var(--hm-ink); font: inherit; font-size: 15px;
  }
  #hm-view-options button[aria-checked="true"] { color: var(--hm-blue); }
  #hm-view-options button:active { background: var(--hm-sheet); }
  #hm-view-options button:disabled { opacity: .4; }
  #hm-view-options svg { width: 17px; height: 17px; }
  #hm-toolbar-tools[aria-expanded="true"] { color: var(--hm-blue); }
  #hm-settings-back { display: none; }
  #hm-toolbar button:focus-visible, #hm-drawer-close:focus-visible,
  #hm-settings-back:focus-visible {
    outline: 2px solid var(--hm-blue); outline-offset: 2px;
  }
  html[data-harness-mobile] [data-hm-frame] {
    display: grid !important; grid-template-columns: minmax(0, 1fr) !important;
    width: 100% !important; min-width: 0 !important; padding-top: 0 !important;
    height: 100% !important; transition: none !important;
  }
  html[data-harness-mobile] [data-hm-frame]::before { display: none !important; }
  html[data-harness-mobile] [data-hm-center] {
    grid-column: 1 !important; grid-row: 1 !important; width: 100% !important;
    min-width: 0 !important; border: 0 !important; border-radius: 0 !important;
    background: var(--hm-surface) !important;
  }
  html[data-harness-mobile] [data-hm-sidebar] {
    position: fixed !important; inset: var(--hm-toolbar-height) auto 0 0 !important;
    width: min(83vw, 340px) !important;
    height: calc(var(--hm-height, 100dvh) - var(--hm-toolbar-height)) !important;
    z-index: 60 !important; transform: translateX(-102%);
    visibility: hidden; content-visibility: hidden; pointer-events: none; background: var(--hm-surface) !important;
    border-right: 1px solid var(--hm-line);
    transition: transform .18s ease, visibility .18s !important;
    box-shadow: 16px 0 40px #00000008;
  }
  html[data-harness-mobile] [data-hm-sidebar][data-hm-open="true"] {
    transform: translateX(0); visibility: visible; content-visibility: visible; pointer-events: auto;
  }
  html[data-harness-mobile] [data-hm-sidebar] > [data-slot] { width: 100% !important; }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_root"]:has(> [class*="_logoRow"]) {
    width: 100% !important; padding: 124px 16px 14px !important; background: var(--hm-surface) !important;
  }
  html[data-harness-mobile] [data-hm-sidebar] [data-hm-native-actions="true"] {
    width: 100% !important; padding: 124px 16px 14px !important;
    background: var(--hm-surface) !important;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_topStrip"],
  html[data-harness-mobile] [data-hm-sidebar] [class*="_toggle"],
  html[data-harness-mobile] [data-hm-sidebar] [class*="_buildVersion"] { display: none !important; }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_logoRow"] { display: none !important; }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_brandName"] { font-size: 15px !important; }
  html[data-harness-mobile] [data-hm-sidebar] button[class*="_newSession"] { display: none !important; }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_panelList"] {
    display: flex !important; flex-direction: column; gap: 2px;
    margin: 0 0 14px !important; padding: 0 !important; flex-shrink: 0;
  }
  #hm-computer-picker {
    display: flex; align-items: center; gap: 12px; flex-shrink: 0;
    width: 100%; min-height: 46px; padding: 0 10px; margin-bottom: 8px;
    color: var(--hm-ink); background: var(--hm-sheet); border: 0; border-radius: 12px;
    font: inherit; font-size: 15px; cursor: pointer;
  }
  #hm-computer-picker span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  #hm-computer-picker svg { width: 23px; height: 23px; flex: none; }
  #hm-computer-picker svg:last-child { width: 15px; height: 15px; color: var(--hm-muted); }
  #hm-computer-picker:active { filter: brightness(.9); }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_panelRow"] {
    display: flex !important; align-items: center; width: 100%;
    min-height: 46px !important; padding: 0 10px !important; gap: 12px;
    border: 0; border-radius: 12px; background: transparent; color: var(--hm-ink);
    font-size: 17px; font-weight: 500;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_panelRow"]:active,
  #hm-drawer-new:active { background: var(--hm-sheet); }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_panelGlyph"] {
    display: inline-flex; width: 25px; height: 25px; flex: none;
    align-items: center; justify-content: center;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_panelGlyph"] [data-hm-lucide] svg {
    width: 24px; height: 24px;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_panelTitle"] { font-size: 17px; }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_searchButton"] {
    width: 100%; border-radius: 28px; background: var(--hm-sheet);
    border: 1px solid var(--hm-line); color: var(--hm-muted); min-height: 44px;
  }
  html[data-harness-mobile] [data-hm-sidebar] [role="treeitem"] {
    min-height: 46px; border-radius: 12px; font-size: 15px;
    touch-action: manipulation; -webkit-user-drag: none; -webkit-user-select: none; user-select: none;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_sectionHeader"] {
    color: var(--hm-muted); margin: 0 0 4px !important; padding: 0 4px 0 10px !important;
    display: flex !important; align-items: center; justify-content: flex-start;
    min-height: 44px; gap: 8px;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_sectionHeader"] > span:empty { display: none !important; }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_headerActions"] {
    margin-left: auto !important; flex: 0 0 42px !important; width: 42px;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_sectionLabel"] {
    flex: 1; min-width: 0; text-align: left; font-size: 13px;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_sectionHeader"] [class*="_searchSlot"],
  html[data-harness-mobile] [data-hm-sidebar] button[aria-label="添加工作区"] { display: none !important; }
  html[data-harness-mobile] [data-hm-sidebar] button[aria-label="视图选项"] {
    display: inline-flex !important; align-items: center; justify-content: center;
    width: 42px; height: 42px; border: 0; border-radius: 12px; color: var(--hm-muted);
  }
  html[data-harness-mobile] [data-hm-sidebar] button[aria-label="视图选项"] svg {
    width: 22px; height: 22px;
  }
  html[data-harness-mobile] [data-hm-sidebar] [data-row-key^="session:"] {
    position: relative; padding: 0 4px 0 8px !important;
  }
  html[data-harness-mobile] [data-hm-sidebar] [data-row-key^="session:"] [class*="_time"] {
    display: block !important; flex: 0 0 42px !important; width: 42px; text-align: center;
  }
  html[data-harness-mobile] [data-hm-sidebar] [data-row-key^="session:"] [class*="_rowActions"] {
    display: flex !important; position: absolute; top: 50%; right: 4px;
    width: 42px; height: 42px; transform: translateY(-50%);
    visibility: hidden !important; pointer-events: none; overflow: hidden;
  }
  html[data-harness-mobile] [data-hm-sidebar] [data-row-key^="session:"] [class*="_pinIndicator"] {
    display: inline-flex !important;
  }
  html[data-harness-mobile] [data-hm-session-options] {
    width: 224px; padding: 5px; border: 1px solid var(--hm-line);
    background: var(--hm-surface) !important; color: var(--hm-ink);
    box-shadow: 0 5px 24px #00000012; backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  html[data-harness-mobile] [data-hm-session-options] > [aria-hidden="true"],
  html[data-harness-mobile] [data-hm-session-options] [data-hm-view-extra] { display: none !important; }
  html[data-harness-mobile] [data-hm-sidebar-initializing] [class*="_viewOptionsMenu"],
  html[data-harness-mobile][data-hm-sidebar-initializing] [class*="_viewOptionsMenu"] { visibility: hidden !important; }
  html[data-harness-mobile] [data-hm-session-options] [role="menuitem"] {
    min-height: 44px !important; font-size: 15px; border-radius: 11px;
  }
  html[data-harness-mobile] [data-hm-sidebar] [class*="_footArea"] {
    padding-top: 10px; background: var(--hm-surface);
  }
  #hm-drawer-close { display: none !important; }
  #hm-drawer-search {
    display: flex; position: absolute; top: 12px; left: 16px; gap: 9px;
    width: calc(100% - 32px); height: 44px; border: 1px solid var(--hm-line);
    background: var(--hm-sheet); color: var(--hm-muted); border-radius: 24px;
    align-items: center; padding: 0 14px; font-size: 14px; cursor: pointer;
  }
  #hm-drawer-search svg { width: 18px; height: 18px; flex: none; }
  #hm-drawer-actions {
    display: flex; position: absolute; top: 68px; left: 16px; right: 16px; gap: 8px;
  }
  #hm-drawer-actions button {
    display: inline-flex; width: 100%; min-width: 0; height: 44px; align-items: center;
    justify-content: flex-start; gap: 12px; border: 0;
    border-radius: 12px; padding: 0 10px; background: transparent;
    color: var(--hm-ink); font-size: 17px; font-weight: 500; white-space: nowrap;
  }
  #hm-drawer-actions svg { width: 25px; height: 25px; flex: none; }
  html[data-harness-mobile] [data-hm-sidebar] [data-hm-account-slot="true"] { position: relative !important; }
  html[data-harness-mobile] [data-hm-sidebar] [data-hm-account-slot="true"] button[aria-haspopup="menu"] {
    padding-right: 56px !important;
  }
  #hm-user-settings {
    display: inline-flex; position: absolute; top: 50%; right: 6px; z-index: 2;
    width: 42px !important; min-width: 42px !important; height: 42px !important;
    align-items: center; justify-content: center; transform: translateY(-50%);
    border: 0; border-radius: 50%; padding: 0; background: transparent;
    color: var(--hm-muted); cursor: pointer;
  }
  #hm-user-settings:active { color: var(--hm-blue); background: #4d6bfe0b; }
  #hm-user-settings svg { width: 20px; height: 20px; }
  [data-hm-account-settings] { display: none !important; }
  #hm-scrim {
    display: none; position: fixed; inset: var(--hm-toolbar-height) 0 0;
    background: #11131a1a; z-index: 50; border: 0; padding: 0; touch-action: none;
  }
  #hm-scrim[data-hm-open="true"] { display: block; }
  html[data-harness-mobile] [data-hm-frame] > [class*="_handle"],
  html[data-harness-mobile] [data-hm-frame] > [class*="_dragHandle"],
  html[data-harness-mobile] [class*="_widthHandle"] { display: none !important; }
  html[data-harness-mobile] [data-hm-rightbar] {
    position: fixed !important; inset: var(--hm-toolbar-height) 0 0 auto !important;
    width: min(83vw, 340px) !important; min-width: 0 !important;
    height: calc(var(--hm-height, 100dvh) - var(--hm-toolbar-height)) !important;
    z-index: 60 !important; transform: translateX(102%);
    visibility: hidden; content-visibility: hidden; pointer-events: none; background: var(--hm-surface) !important;
    border-left: 1px solid var(--hm-line); box-shadow: -16px 0 40px #00000008;
    transition: transform .18s ease, visibility .18s !important; overflow: hidden;
  }
  html[data-harness-mobile][data-hm-tools="open"] [data-hm-rightbar] {
    transform: translateX(0); visibility: visible; content-visibility: visible; pointer-events: auto;
  }
  html[data-harness-mobile] [data-hm-rightbar] [data-sidebar-right-panel] {
    inset: 0 !important; width: 100% !important; max-width: 100% !important;
    --dsh-sidebar-width: 100% !important;
  }
  html[data-harness-mobile] [data-hm-rightbar] [data-hm-tools-guide="true"],
  html[data-harness-mobile] [data-hm-rightbar] [data-dockkit-split-button],
  html[data-harness-mobile] [data-hm-rightbar] [data-dockkit-add-tab],
  html[data-harness-mobile] [data-hm-rightbar] [data-dockkit-strip-chrome],
  html[data-harness-mobile] [data-hm-rightbar] [data-dockkit-tab-close],
  html[data-harness-mobile] [data-hm-rightbar] [data-dockkit-divider],
  html[data-harness-mobile] [data-hm-rightbar] [data-sidebar-right-guide] [class*="_hero"],
  html[data-harness-mobile] [data-hm-rightbar] [data-sidebar-right-guide] [class*="_entryDescription"],
  html[data-harness-mobile] [data-hm-rightbar] [data-sidebar-right-guide] [class*="_description"],
  html[data-harness-mobile] [data-hm-rightbar] [data-sidebar-right-guide] [class*="_keys"] {
    display: none !important;
  }
  html[data-harness-mobile] [data-hm-rightbar] [data-sidebar-right-guide] {
    padding: 24px 16px !important; gap: 12px;
  }
  html[data-harness-mobile] [data-hm-rightbar] [data-sidebar-right-guide-entry] {
    min-height: 56px; max-width: 100%; border-radius: 16px;
  }
  html[data-harness-mobile] [data-slot="main"],
  html[data-harness-mobile] [data-slot="main.conversation"] {
    min-width: 0 !important; width: 100% !important; height: 100% !important;
  }
  html[data-harness-mobile] [data-slot="conversation.header"] {
    display: none !important;
  }
  html[data-harness-mobile] [data-conversation-header-corner] { margin: 0 !important; }
  html[data-harness-mobile] [data-slot="conversation.header"] [data-sidebar-right-expand],
  html[data-harness-mobile] [data-slot="conversation.header"] [data-sidebar-right-collapse] {
    display: none !important;
  }
  html[data-harness-mobile] [data-sidebar-right-expand],
  html[data-harness-mobile] [data-sidebar-right-collapse] { display: none !important; }
  html[data-harness-mobile] [data-conversation-header-leading] {
    min-width: 0; max-width: 100%; overflow: hidden;
  }
  html[data-harness-mobile] [data-conversation-content] {
    min-width: 0 !important; width: 100% !important; overflow-x: hidden;
    --dsh-chat-content-width: calc(100vw - 32px);
    --dsh-composer-side-clearance: 0px;
    --dsh-composer-card-max-width: 100%;
    background: var(--hm-surface);
  }
  html[data-harness-mobile] [data-conversation-scroll] {
    min-width: 0 !important; margin: 0 !important; padding-inline: 0 !important;
    scrollbar-gutter: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch;
  }
  html[data-harness-mobile] [data-content-phase="hero"] [data-conversation-scroll] {
    justify-content: flex-end !important;
  }
  #hm-welcome {
    position: absolute; top: 43%; left: 12px; right: 12px; transform: translateY(-50%);
    align-items: center; flex-direction: column; gap: 22px;
    pointer-events: none; color: var(--hm-blue);
  }
  html[data-harness-mobile] [data-content-phase="hero"] #hm-welcome { display: flex; }
  #hm-welcome svg { width: 42px; height: 32px; }
  #hm-welcome p {
    color: var(--hm-ink); font-size: clamp(17px, 4.6vw, 20px);
    line-height: 1.5; font-weight: 600; margin: 0; text-align: center;
  }
  html[data-harness-mobile] [data-composer-seat] {
    min-width: 0 !important; width: 100% !important;
    padding: 8px 12px max(12px, env(safe-area-inset-bottom)) !important;
    background: var(--hm-surface) !important;
  }
  html[data-harness-mobile] [data-composer-seat] [class*="_composerStack"] {
    width: 100% !important; max-width: 100% !important;
    min-width: 0 !important; margin-inline: 0 !important; gap: 8px !important;
  }
  html[data-harness-mobile] [data-composer-seat] [class*="_composerHero"] {
    max-width: 100% !important; padding-bottom: 0 !important;
  }
  html[data-harness-mobile] [data-composer-seat] [class*="_headline"],
  html[data-harness-mobile] [data-composer-seat] [class*="_stack"]:has(> [class*="_headline"]) {
    display: none !important;
  }
  html[data-harness-mobile] [data-composer-seat] [class*="_heroWorkspaceRow"] {
    padding: 0 4px !important; min-width: 0; max-width: 100%; margin-top: 0 !important;
  }
  html[data-harness-mobile] [data-composer-seat] [class*="_heroWorkspaceRow"] button {
    font-size: 12px; min-height: 32px;
  }
  html[data-harness-mobile] [data-slot="conversation.composer.bar"] > * { padding: 0 !important; }
  html[data-harness-mobile] [data-composer-card] {
    display: flex !important; flex-direction: row !important; flex-wrap: wrap !important;
    align-items: center !important; border-radius: 22px !important;
    border: 1px solid var(--hm-line) !important; padding: 6px 8px !important;
    background: var(--hm-surface) !important; gap: 2px !important;
    box-shadow: 0 3px 16px #00000009 !important; max-width: 100% !important;
  }
  html[data-harness-mobile] [data-input-scroll] {
    order: 1; flex: 1; width: 0; min-width: 0 !important;
    max-height: min(25dvh, 132px) !important; overflow-y: auto !important;
  }
  html[data-harness-mobile] [data-slot="conversation.input.attachments"] > * {
    order: -2; flex-basis: 100%; min-width: 0;
  }
  html[data-harness-mobile] [data-composer-input],
  html[data-harness-mobile] input, html[data-harness-mobile] textarea,
  html[data-harness-mobile] select { font-size: 16px !important; }
  html[data-harness-mobile] [data-composer-input] {
    min-width: 0 !important; max-width: 100% !important;
    min-height: 44px !important; padding: 10px 4px !important; line-height: 24px !important;
  }
  html[data-harness-mobile] [data-composer-placeholder] {
    font-size: 0 !important; left: 4px !important; right: 4px !important;
    top: 10px !important; line-height: 24px !important;
  }
  html[data-harness-mobile] [data-composer-placeholder]::after { content: '发消息'; font-size: 16px; }
  html[data-harness-mobile] [data-composer-card] [class*="_row"]:has(> [class*="_tools"]) {
    display: contents !important;
  }
  html[data-harness-mobile] [data-composer-card] [class*="_tools"],
  html[data-harness-mobile] [data-composer-card] [class*="_trailing"] { display: contents !important; }
  html[data-harness-mobile] [data-composer-card] [class*="_standardControls"],
  html[data-harness-mobile] [data-composer-card] [class*="_activity"],
  html[data-harness-mobile] [data-slot="conversation.input.model"],
  html[data-harness-mobile] [data-slot="conversation.input.permission"],
  html[data-harness-mobile] [data-slot="conversation.input.plan"] { display: none !important; }
  html[data-harness-mobile] [data-composer-card] button[aria-haspopup="listbox"] {
    order: 3; display: inline-flex; width: 40px !important; height: 44px !important;
    min-width: 40px !important; min-height: 44px !important; padding: 0 !important;
    background: transparent !important; color: var(--hm-ink) !important;
  }
  html[data-harness-mobile] [data-composer-card] button[aria-haspopup="listbox"] > svg { display: none; }
  [data-hm-add-icon] { display: inline-flex; }
  [data-hm-add-icon] svg { width: 27px; height: 27px; }
  #hm-composer-photos, #hm-keyboard-toggle {
    display: inline-flex; flex: none; align-items: center; justify-content: center;
    width: 40px; height: 44px; border: 0; padding: 0; cursor: pointer;
    background: transparent; border-radius: 16px; color: var(--hm-ink);
  }
  #hm-composer-photos { order: 0; }
  #hm-keyboard-toggle { order: 2; }
  #hm-keyboard-toggle[hidden] { display: none; }
  #hm-composer-photos svg { width: 27px; height: 27px; }
  #hm-keyboard-toggle svg { width: 25px; height: 25px; }
  #hm-composer-photos:active, #hm-keyboard-toggle:active { background: var(--hm-sheet); }
  #hm-voice-input {
    order: 1; display: flex; align-items: center; justify-content: center;
    flex: 1; min-width: 0; height: 44px; padding: 0 2px; border: 0;
    border-radius: 14px; background: transparent; color: var(--hm-ink);
    font: inherit; font-size: 17px; font-weight: 600; white-space: nowrap;
    touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  html[data-harness-mobile][data-hm-input-mode="text"] #hm-voice-input,
  html[data-harness-mobile][data-hm-input-mode="voice"] [data-input-scroll] { display: none !important; }
  html[data-harness-mobile][data-hm-input-mode="voice"][data-hm-draft] [data-input-scroll] {
    display: block !important; order: -1; flex-basis: 100%; width: 100%;
  }
  html[data-harness-mobile][data-hm-speech] #hm-voice-input { color: var(--hm-blue); background: #4d6bfe0b; }
  html[data-harness-mobile][data-hm-speech-cancel] #hm-voice-input { color: #d45757; background: #d457570d; }
  #hm-speech-feedback:not([hidden]) {
    display: block; position: absolute; bottom: calc(100% + 10px); left: 12px; right: 12px;
    z-index: 110; padding: 0; color: var(--hm-muted);
    font-size: 13px; line-height: 20px; text-align: center; pointer-events: none;
  }
  html[data-harness-mobile][data-hm-speech-cancel] #hm-speech-feedback { color: #d45757; }
  #hm-speech-overlay {
    --hm-meter: 0; --hm-touch-x: 50%; --hm-touch-y: 90%;
    display: block; position: fixed; inset: auto 0 0; z-index: 120;
    height: min(32dvh, 248px); overflow: hidden; pointer-events: none;
    color: white; opacity: 1; isolation: isolate;
    contain: layout paint style;
  }
  #hm-speech-overlay[data-hm-phase="hidden"] { display: none; }
  #hm-speech-overlay::before {
    content: ""; position: absolute; inset: 0; z-index: -2; pointer-events: none;
    background: linear-gradient(to right, ${speechGradient('recording')});
    -webkit-mask-image: linear-gradient(to top, #000, #000000a6 22%, #00000026 50%, transparent 75%),
      radial-gradient(ellipse 65% 110% at 50% 110%, #000 25%, #000000a6 50%, #00000020 75%, transparent 95%);
    mask-image: linear-gradient(to top, #000, #000000a6 22%, #00000026 50%, transparent 75%),
      radial-gradient(ellipse 65% 110% at 50% 110%, #000 25%, #000000a6 50%, #00000020 75%, transparent 95%);
  }
  #hm-speech-overlay::after {
    content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background: radial-gradient(ellipse 145px 130px at var(--hm-touch-x) var(--hm-touch-y), #0061ff66, #006bff26 50%, #006bff00);
    -webkit-mask-image: linear-gradient(to bottom, #000 65%, transparent);
    mask-image: linear-gradient(to bottom, #000 65%, transparent);
  }
  #hm-speech-overlay[data-hm-phase="cancel"] { color: #ec3e42; }
  #hm-speech-overlay[data-hm-phase="cancel"]::before {
    background: linear-gradient(to right, ${speechGradient('cancel')});
  }
  #hm-speech-overlay[data-hm-phase="cancel"]::after {
    background: radial-gradient(ellipse 145px 130px at var(--hm-touch-x) var(--hm-touch-y), #fa77794a, #ff9c9e18 50%, #ff9c9e00);
  }
  #hm-speech-transcript {
    position: absolute; bottom: 132px; left: 28px; right: 28px;
    font-size: 19px; font-weight: 500; line-height: 1.5; text-align: center;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; overflow-wrap: anywhere;
  }
  #hm-speech-hint {
    position: absolute; bottom: 82px; left: 20px; right: 20px;
    text-align: center; font-size: 14px; line-height: 24px; font-weight: 500;
  }
  #hm-speech-wave {
    position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
    display: flex; width: min(68vw, 286px); height: 32px;
    align-items: center; justify-content: space-between; gap: 2px;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
    mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent);
  }
  #hm-speech-wave i {
    display: block; flex: 1; max-width: 2.5px; height: 28px; border-radius: 4px;
    background: currentColor; transform: scaleY(calc(.18 + var(--hm-meter) * var(--hm-bar-weight) * .82));
    transition: transform 90ms linear;
  }
  #hm-speech-overlay[data-hm-phase="processing"] #hm-speech-wave { opacity: .65; }
  html[data-harness-mobile][data-hm-speech] [data-composer-card] { opacity: 0; }
  @media (prefers-reduced-motion: reduce) {
    #hm-speech-wave i { transition: none; }
  }
  html[data-harness-mobile] [data-composer-card] [class*="_primary"] {
    order: 4; width: 40px !important; height: 40px !important; min-width: 40px;
    transform: none; background: var(--hm-blue);
  }
  html[data-harness-mobile]:not([data-hm-draft]) [data-composer-card] [class*="_primary"][aria-label*="发送"]:disabled,
  html[data-harness-mobile]:not([data-hm-draft]) [data-composer-card] [class*="_primary"][aria-label*="Send"]:disabled {
    display: none !important;
  }
  html[data-harness-mobile] [data-composer-seat] [class*="_toolbar"],
  html[data-harness-mobile] [data-composer-seat] [class*="_footer"] {
    flex-wrap: wrap; gap: 6px !important; min-width: 0;
  }
  html[data-harness-mobile] [data-hm-usage-row] > :not(:has(.y0jqnG_root)) {
    display: none !important;
  }
  html[data-harness-mobile] [data-hm-usage-row] .y0jqnG_trigger {
    min-height: 40px; padding-inline: 10px;
  }
  html[data-harness-mobile] [data-hm-center] .d1vkyW_actions > :not(:first-child) {
    display: none !important;
  }
  html[data-harness-mobile] [data-hm-center] .d1vkyW_actions > :first-child {
    min-width: 44px; min-height: 44px;
  }
  html[data-harness-mobile] [data-hm-center] pre {
    max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  html[data-harness-mobile] [data-hm-center] table {
    display: block; max-width: 100%; overflow-x: auto;
  }
  html[data-harness-mobile] [data-hm-center] img { max-width: 100%; height: auto; }
  html[data-harness-mobile] [data-hm-center] p,
  html[data-harness-mobile] [data-hm-center] li { overflow-wrap: anywhere; }
  html[data-harness-mobile] [role="dialog"] {
    min-width: 0 !important; max-width: calc(100vw - 24px) !important;
    max-height: calc(var(--hm-height, 100dvh) - 24px) !important;
  }
  html[data-harness-mobile] [role="menu"],
  html[data-harness-mobile] [role="listbox"] {
    min-width: 0 !important; max-width: calc(100vw - 24px) !important;
    max-height: min(70dvh, 560px) !important; overflow-y: auto; border-radius: 18px;
  }
  html[data-harness-mobile] [role="menuitem"],
  html[data-harness-mobile] [role="option"],
  html[data-harness-mobile] [data-hm-sidebar] button { min-height: 40px !important; }
  html[data-harness-mobile] [data-trigger-menu] {
    border: 1px solid var(--hm-line) !important; background: var(--hm-surface) !important;
    border-radius: 18px !important; box-shadow: 0 4px 20px #0000000d !important;
    backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
  }
  html[data-harness-mobile] [data-trigger-menu] > [aria-hidden="true"],
  html[data-harness-mobile] [data-trigger-menu] [class*="_itemAlias"],
  html[data-harness-mobile] [data-trigger-menu] [class*="_itemDescription"],
  html[data-harness-mobile] [data-trigger-menu] [class*="_sectionTitle"] { display: none !important; }
  html[data-harness-mobile] [data-trigger-menu] [role="listbox"]:has([class*="_itemAlias"]) {
    display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 6px !important; gap: 2px;
    max-height: min(224px, max(88px, calc(var(--hm-height, 100dvh) - var(--hm-toolbar-height) - 180px))) !important;
    overflow-y: auto !important; overscroll-behavior: contain;
  }
  html[data-harness-mobile] [data-trigger-menu] [role="option"] {
    display: flex !important; align-items: center; gap: 10px;
    min-width: 0; min-height: 44px !important; padding: 10px 12px !important; border-radius: 12px;
    font-size: 14px; white-space: nowrap;
  }
  html[data-harness-mobile] [data-trigger-menu] [class*="_itemIcon"] {
    display: inline-flex; width: 20px; flex: none; justify-content: center;
  }
  html[data-harness-mobile] [data-hm-command-icon] > svg,
  html[data-harness-mobile] [data-hm-command-icon] > [data-slot] { display: none !important; }
  html[data-harness-mobile] [data-hm-lucide] { display: inline-flex; }
  html[data-harness-mobile] [data-hm-lucide] svg { width: 19px; height: 19px; }
  html[data-harness-mobile] [data-trigger-menu] [class*="_itemName"] {
    overflow: hidden; text-overflow: ellipsis;
  }
  html[data-harness-mobile] [data-hm-settings] {
    position: fixed !important; inset: 12px 0 0 !important;
    width: 100vw !important; max-width: 100vw !important;
    height: calc(var(--hm-height, 100dvh) - 12px) !important;
    max-height: calc(var(--hm-height, 100dvh) - 12px) !important;
    border-radius: 32px 32px 0 0 !important; margin: 0 !important;
    background: var(--hm-sheet) !important; display: flex !important;
    flex-direction: column !important; box-shadow: none !important;
    padding-top: 80px;
  }
  #hm-settings-heading {
    display: block; position: absolute; top: 27px; left: 65px; right: 65px;
    text-align: center; color: var(--hm-ink); font-size: 18px;
    font-weight: 600; margin: 0; line-height: 24px;
  }
  html[data-harness-mobile] [data-hm-settings-nav] {
    width: 100% !important; min-width: 0 !important; padding: 16px !important;
    overflow-y: auto; gap: 10px !important;
  }
  html[data-harness-mobile] [data-hm-settings-nav] [class*="_navTitle"] {
    color: var(--hm-muted); font-size: 13px; padding: 0 12px 2px;
  }
  html[data-harness-mobile] [data-hm-settings-nav] [class*="_navList"] {
    background: var(--hm-surface); border-radius: 24px; gap: 0; padding: 0 16px;
  }
  html[data-harness-mobile] [data-hm-settings-nav] button {
    min-height: 57px; height: auto; flex: none; white-space: nowrap;
    border-radius: 0; padding: 12px 2px; font-size: 16px; gap: 14px;
    background: transparent !important;
  }
  html[data-harness-mobile] [data-hm-settings-nav] button + button { border-top: 1px solid var(--hm-line); }
  html[data-harness-mobile] [data-hm-settings-nav] button::after {
    content: ''; width: 7px; height: 7px; border-top: 1.5px solid #b7b9be;
    border-right: 1.5px solid #b7b9be; transform: rotate(45deg); margin-right: 4px;
  }
  html[data-harness-mobile] [data-hm-settings-nav] button svg { width: 21px; height: 21px; }
  html[data-harness-mobile] [data-hm-settings-body] {
    flex: 1; min-width: 0 !important; min-height: 0 !important;
    width: 100% !important; overflow: hidden;
  }
  html[data-harness-mobile] [data-hm-settings-body] > [class*="_header"] {
    position: absolute; inset: 0 0 auto; height: 80px; padding: 18px 18px;
    pointer-events: none; justify-content: flex-end; align-items: flex-start;
  }
  html[data-harness-mobile] [data-hm-settings-body] [class*="_close"] {
    pointer-events: auto; width: 42px; height: 42px; border-radius: 50%;
    border: 1px solid var(--hm-line); background: var(--hm-surface); corner-shape: round;
  }
  html[data-harness-mobile] [data-hm-settings-body] [class*="_close"] svg { width: 23px; height: 23px; }
  html[data-harness-mobile] [data-hm-settings-body] > [class*="_options"] {
    padding: 8px 16px 32px; overflow: auto;
  }
  html[data-harness-mobile] [data-hm-settings-view="home"] [data-hm-settings-body] { flex: 0; }
  html[data-harness-mobile] [data-hm-settings-view="home"] [data-hm-settings-body] > [class*="_options"] { display: none; }
  html[data-harness-mobile] [data-hm-settings-view="detail"] [data-hm-settings-nav] { display: none !important; }
  html[data-harness-mobile] [data-hm-settings-view="detail"] #hm-settings-back {
    display: inline-flex; position: absolute; top: 18px; left: 18px;
  }
  html[data-harness-mobile] [data-hm-general] {
    background: var(--hm-surface); border-radius: 24px; padding: 0 16px;
  }
  html[data-harness-mobile] [data-hm-setting-row] {
    min-width: 0; padding: 17px 0 !important; margin: 0 !important;
    border-bottom: 1px solid var(--hm-line);
    align-items: center; gap: 12px !important; flex-wrap: wrap;
  }
  html[data-harness-mobile] [data-hm-setting-row]:last-child { border-bottom: 0; }
  html[data-harness-mobile] [data-hm-setting-row] > :first-child { min-width: 0; flex: 1 1 150px; }
  html[data-harness-mobile] [data-hm-setting-row] [class*="_title"],
  html[data-harness-mobile] [data-hm-setting-row] [class*="_settingTitle"] {
    color: var(--hm-ink); font-size: 15px; line-height: 1.5;
  }
  html[data-harness-mobile] [data-hm-setting-row] [class*="_desc"],
  html[data-harness-mobile] [data-hm-setting-row] [class*="_Description"] {
    color: var(--hm-muted); font-size: 13px; line-height: 1.5; margin-top: 4px;
  }
  html[data-harness-mobile] [data-hm-setting-row] [class*="_selector"] {
    max-width: 100%; min-height: 44px; border: 0; color: var(--hm-muted); font-size: 14px;
  }
  html[data-harness-mobile] [data-hm-setting-row] [class*="_cubeRow"] { width: 100%; gap: 8px; }
  html[data-harness-mobile] [data-hm-setting-row][class*="_group"] > :first-child { flex: none; }
  html[data-harness-mobile] [data-hm-setting-row]:has(> [class*="_cubeRow"]) { align-items: stretch; }
  html[data-harness-mobile] [data-hm-setting-row] [class*="_themeCube"] {
    flex: 1; min-width: 0; min-height: 62px; border-radius: 14px;
  }
  html[data-harness-mobile][data-hm-keyboard] #hm-welcome,
  html[data-harness-mobile][data-hm-keyboard] [data-composer-seat] [class*="_heroWorkspaceRow"],
  html[data-harness-mobile][data-hm-keyboard] [data-hm-usage-row] {
    display: none !important;
  }
  @media (max-width: 359px) {
    #hm-composer-photos, #hm-keyboard-toggle { width: 36px; }
    html[data-harness-mobile] [data-composer-card] button[aria-haspopup="listbox"] { width: 36px !important; min-width: 36px !important; }
  }
  @media (max-height: 520px) { #hm-welcome { top: 25%; gap: 10px; } }
  @media (prefers-reduced-motion: reduce) {
    html[data-harness-mobile] [data-hm-sidebar],
    html[data-harness-mobile] [data-hm-rightbar] { transition: none !important; }
  }
}
`;
