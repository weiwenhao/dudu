// A scroll bar is for scrolling: it is not drawn while the content rests, and shows while the content is being scrolled (the CSS in
// styles.css colours the bar of an element marked `data-scrolling` and leaves every other one transparent). One listener on the
// root does it for everything scrollable under it: `scroll` does not bubble, but it can be caught on the way down.
const LINGER_MS = 900;

export function quietScrollbars(root) {
  const timers = new WeakMap();
  const onScroll = (event) => {
    const element = event.target;
    // DSH's own conversation, shown in some of our windows, keeps its own scroll bars.
    if (!(element instanceof Element) || element.closest('.dudu-host-conversation')) return;
    element.setAttribute('data-scrolling', '');
    clearTimeout(timers.get(element));
    timers.set(element, setTimeout(() => element.removeAttribute('data-scrolling'), LINGER_MS));
  };
  root.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => root.removeEventListener('scroll', onScroll, { capture: true });
}
