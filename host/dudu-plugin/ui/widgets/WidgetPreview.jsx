import { useEffect, useMemo, useRef, useState } from 'react';
import { exampleData, inspectWidget } from '../../widget-testing.mjs';
import { Button } from '../components/button.jsx';
import { ServicesProvider, useServices } from '../services.jsx';
import { T } from '../strings.js';

const W = T.settings.widgets;

/** This wraps the ordinary slot; example mode swaps only its read services and opening actions. */
export function WidgetPreview({ widget, editing, resize, children }) {
  const services = useServices();
  const [theme, setTheme] = useState(() => document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light');
  const [sample, setSample] = useState(false);
  const [checks, setChecks] = useState({ fits: true, accessible: true });
  const body = useRef(null);
  const examples = useMemo(() => {
    const data = exampleData();
    const answers = { 'issues/list': data.issues, 'quota/get': data.quota, 'dispatch/state': data.inputs, 'sessions/list': data.sessions,
      'sessions/read': { outcome: 'success', messages: [{ role: 'assistant', text: data.sessions.sessions[0].evidence.text }], nextCursor: null } };
    return { ...services, request: async (action) => answers[action] ?? { outcome: 'no_op' }, openIssue() {}, async openNativeSession() {}, async openIssueSession() {} };
  }, [services]);
  useEffect(() => {
    const element = body.current;
    const check = () => {
      const result = inspectWidget(element);
      setChecks((current) => current.fits === result.fits && current.accessible === result.accessible ? current : result);
    };
    const observer = new ResizeObserver(check);
    observer.observe(element);
    const mutations = new MutationObserver(check);
    mutations.observe(element, { subtree: true, childList: true, characterData: true });
    check();
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, []);
  return <>
    <div className="du-widget-preview" data-theme={theme} ref={body}>
      <ServicesProvider value={sample ? examples : services}>{children}</ServicesProvider>
    </div>
    {editing && <details className="du-widget-inspector" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <summary>{W.inspect}</summary>
      <div className="du-widget-inspector-controls">
        <Button variant="outline" size="sm" onClick={() => resize(widget.min)}>{W.minimum}</Button>
        <Button variant="outline" size="sm" onClick={() => resize(widget.size)}>{W.recommended}</Button>
        <label>{W.theme} <select aria-label={W.theme} value={theme} onChange={(event) => setTheme(event.target.value)}>
          <option value="light">{W.light}</option><option value="dark">{W.dark}</option>
        </select></label>
        <label>{W.data} <select aria-label={W.data} value={sample ? 'example' : 'mine'} onChange={(event) => setSample(event.target.value === 'example')}>
          <option value="mine">{W.mine}</option><option value="example">{W.sample}</option>
        </select></label>
      </div>
      <dl aria-label={W.checks}>
        {[
          [W.metadata, Boolean(widget.label && widget.description && widget.preview)],
          [W.fits, checks.fits], [W.accessible, checks.accessible], [W.healthy, !widget.failed],
        ].map(([label, ok]) => <span key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{ok ? W.pass : W.fail}</dd></span>)}
      </dl>
    </details>}
  </>;
}
