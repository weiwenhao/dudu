import * as React from 'react';
import { getLocale, intlLocale, subscribeLocale } from './locale.mjs';
import { quietScrollbars } from './quiet-scrollbars.js';
import { trackTabbing } from './tab-focus.js';

const ScopeContext = React.createContext(null);

/**
 * The element that carries `.dudu`, which is what our CSS is scoped to. Radix renders menus, popovers and tooltips in a portal
 * on <body> by default, outside this element and so unstyled; every portal is given this element as its container instead.
 * It must not sit inside anything with `transform`, `filter`, `contain` or `container-type`: that would become the containing
 * block of the `position: fixed` overlays.
 * Our utilities are written `.dudu .class`, so a utility on this element itself would never match: it takes no className and
 * fills its parent through inline style; everything that needs classes goes inside it.
 */
const FILL = { width: '100%', height: '100%', minHeight: 0 };

export function Scope({ children, floating = false }) {
  React.useSyncExternalStore(subscribeLocale, getLocale);
  const [element, setElement] = React.useState(null);
  React.useEffect(() => (element ? quietScrollbars(element) : undefined), [element]);
  React.useEffect(() => trackTabbing(), []);
  return (
    <ScopeContext.Provider value={element}>
      <div ref={setElement} className="dudu" lang={intlLocale()} style={floating ? { display: 'contents' } : FILL}>{children}</div>
    </ScopeContext.Provider>
  );
}

export const usePortalContainer = () => React.useContext(ScopeContext);
