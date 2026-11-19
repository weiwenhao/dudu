// 嘟嘟's own settings pages as the phone opens them (owner, 2026-11-07): the same sections the settings window has, in a web view of their own, one section to a page.
// The plugin serves this bundle as a page of its own (host/phone-pages.mjs), not through DSH's web interface; it asks the plugin for what it needs the way the
// desktop interface does (`api/dudu/<action>`), through the page's own address, which the plugin answers for the few actions its settings pages use.
import { createRoot } from 'react-dom/client';
import { ConnectorsPage } from '../connectors/ConnectorsPage.jsx';
import { ToastProvider } from '../components/toast.jsx';
import { Scope } from '../lib/scope.jsx';
import { setLocale } from '../lib/locale.mjs';
import { CollectorsSection } from '../settings/CollectorsSection.jsx';
import { GeneralSection } from '../settings/GeneralSection.jsx';
import { MemorySection } from '../settings/MemorySection.jsx';
import { RulesSection } from '../settings/RulesSection.jsx';
import { SkillsSection } from '../settings/SkillsSection.jsx';
import { StatusesSection } from '../settings/StatusesSection.jsx';
import { T } from '../strings.js';

const PAGES = {
  general: GeneralSection, statuses: StatusesSection, connectors: ConnectorsPage, collectors: CollectorsSection, rules: RulesSection, memory: MemorySection, skills: SkillsSection,
};

// What the plugin put in the document: which section. The language is the phone's.
const config = window.__DUDU_PHONE__ ?? {};
setLocale(config.locale ?? navigator.language);

/** The plugin's POST helper, as the desktop interface has it, with the header that says this is one of the app's pages. */
async function request(action, body = {}, { signal } = {}) {
  const response = await fetch(new URL(`api/dudu/${action}`, document.baseURI).pathname, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-dudu-page': '1' }, body: JSON.stringify(body), credentials: 'same-origin', signal,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || T.settings.failed);
  return value;
}

function Page() {
  const Section = PAGES[config.section];
  return (
    <Scope>
      <ToastProvider>
        <div className="phone-settings min-h-full px-4 pt-3 pb-10">
          {Section ? <Section request={request} actions={{ phone: true }} onChanged={() => {}} /> : <p className="text-muted-foreground">{T.settings.failed}</p>}
        </div>
      </ToastProvider>
    </Scope>
  );
}

createRoot(document.getElementById('root')).render(<Page />);
// The native page waits for this before it takes its own loading sign away; a page that cannot start says so.
window.addEventListener('error', () => window.__DUDU_NATIVE__?.fail?.('page'));
requestAnimationFrame(() => requestAnimationFrame(() => window.__DUDU_NATIVE__?.ready?.()));
