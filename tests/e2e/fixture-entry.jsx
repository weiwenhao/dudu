// The page the fixture serves: the real interface of the plugin on real React, in a plain document, asking its plugin through a
// function the test provides (window.__request) instead of through DSH. Built by fixture.mjs.
import { createRoot } from 'react-dom/client';
import { css, Page } from '../../host/dudu-plugin/ui/entry.jsx';

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
createRoot(document.getElementById('root')).render(
  <Page request={(action, body) => window.__request(action, body ?? {})} logo="" actions={{ openSession: (target) => window.__opened(target) }} />,
);
